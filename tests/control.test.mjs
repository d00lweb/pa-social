import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, applyDecision, shortId, needsValidation, targets, isPaused } from '../src/core/control.mjs';
import { buildPreviewText, previewButtons } from '../src/channels/preview.mjs';

const item = (guid, channel, status) => ({ guid, channel, status, dueAt: 0, article: { title: 'T', link: 'https://x' } });

test('commandes : nom, mention du bot, arguments', () => {
  assert.deepEqual(parseCommand('/pause Instagram'), { name: 'pause', args: ['instagram'] });
  assert.deepEqual(parseCommand('/statut@PA_aquibot'), { name: 'statut', args: [] });
  assert.deepEqual(parseCommand('/validation instagram off'), { name: 'validation', args: ['instagram', 'off'] });
  assert.equal(parseCommand('bonjour'), null);
  assert.deepEqual(targets('tout').length, 5);
  assert.deepEqual(targets('myspace'), []);
});

test('décisions : valider, refuser, régénérer, déjà traité', () => {
  const id = shortId('g1');
  const queue = [item('g1', 'instagram', 'awaiting'), item('g2', 'instagram', 'awaiting')];
  queue[0].dossier = { x: 1 };
  assert.equal(applyDecision(queue, id, 'v').done, true);
  assert.equal(queue[0].status, 'pending');
  assert.equal(queue[1].status, 'awaiting');
  assert.equal(applyDecision(queue, id, 'v').done, false);
  assert.equal(applyDecision(queue, id, 'g').done, true);
  assert.equal(queue[0].dossier, undefined);
  assert.equal(queue[0].previewSent, false);
  assert.equal(applyDecision(queue, id, 'n').done, true);
  assert.equal(queue[0].status, 'refused');
  assert.equal(applyDecision(queue, id, 'n').done, false);
  assert.equal(applyDecision(queue, 'inconnu', 'v').done, false);
});

test('réglages : Telegram prioritaire sur la configuration', () => {
  const channel = { id: 'instagram', validation: true };
  assert.equal(needsValidation({ validation: {} }, channel), true);
  assert.equal(needsValidation({ validation: { instagram: false } }, channel), false);
  assert.equal(isPaused({ paused: { instagram: true } }, 'instagram'), true);
});

test('kit X : lien de rédaction pré-remplie, longueur comptée comme X', async () => {
  const { intentUrl, xLength } = await import('../src/channels/x.mjs');
  const post = 'Le matrimoine revient à #Bordeaux 🎭\n➡️ https://site.fr/un-tres-long-lien-d-article';
  const url = new URL(intentUrl(post));
  assert.equal(url.origin + url.pathname, 'https://x.com/intent/post');
  assert.equal(url.searchParams.get('text'), post);
  assert.equal(new URL(intentUrl(`
${post}
`)).searchParams.get('text'), post, 'jamais de blanc de bordure : le post commencerait par une ligne vide');
  // 34 caractères + emoji (2) + saut de ligne (1) + ➡️ (2) + espace (1) + lien (23)
  assert.equal(xLength(post), 34 + 2 + 1 + 2 + 1 + 23);

  const dossier = { rubrique: 'R', source: 'ia', facebook: { texte: 'f' }, bluesky: { texte: 'b', hashtag: '#R' }, threads: { texte: 't' }, x: { texte: 'x' } };
  const text = buildPreviewText({ article: { guid: 'g', title: 'T', link: 'https://x' }, dossier, caption: 'c', items: [{ channel: 'x', status: 'awaiting', dueAt: 0 }], published: ['instagram'], when: () => 'vers 9h' });
  assert.ok(text.includes('<b>Instagram</b> · <i>déjà publié</i>') && text.includes('kit Telegram'));
});

test('kit X : un seul message, la consigne, les textes, un bouton par élément à copier', async () => {
  const { intentUrl, kitDonnees } = await import('../src/channels/x.mjs');
  const { kitX, longueurVisible, LEGENDE_MAX } = await import('../src/channels/messages.mjs');
  // 22/11/2026 : jusqu'à neuf messages par article (image, sommaire, un message par élément,
  // comptes à chercher). Désormais l'image et sa légende, avec tous les boutons.
  const pkg = {
    article: { title: 'A & B', guid: 'g' }, mode: 'reponse', text: 'Texte <ok> 🎭', replyText: '📖 L’article : https://site.fr/a', intent: intentUrl('Texte'),
    dossier: { comptes: { x: [{ nom: 'Musée', handle: 'MuseeAquitaine' }], instagram: [{ nom: 'Ville de Bordeaux', handle: 'villedebordeaux' }] }, lieuNom: 'Bordeaux', visuel: { texte_alternatif: 'Une façade' } },
  };
  const m = kitX(kitDonnees(pkg));
  assert.match(m.text.split('\n')[0], /^📌 <b>À publier sur X<\/b> · A &amp; B$/, 'première ligne : quoi, et l’article');
  assert.ok(m.text.includes('<code>Texte &lt;ok&gt; 🎭</code>'), 'le texte, échappé, se lit dans le message');
  assert.ok(m.text.includes('réponds à ton post'), 'la consigne suit le format');
  assert.ok(m.text.includes('Ville de Bordeaux (@villedebordeaux ailleurs)'), 'les comptes à chercher sur X sont nommés');
  const boutons = JSON.parse(m.reply_markup).inline_keyboard.flat();
  assert.equal(boutons[0].text, '✍️ Publier sur X');
  assert.ok(boutons[0].url.startsWith('https://x.com/intent/post?text='));
  assert.deepEqual(boutons.filter((x) => x.copy_text).map((x) => x.copy_text.text), ['Texte <ok> 🎭', '📖 L’article : https://site.fr/a', '@MuseeAquitaine', 'Bordeaux', 'Une façade'], 'le bouton copie la valeur exacte, sans étiquette');
  assert.ok(longueurVisible(m.text) <= LEGENDE_MAX, 'tient dans une légende d’image : un seul message');
  // au-delà de 256 caractères, pas de bouton (Telegram le refuserait) : le texte reste dans le message
  const long = kitX(kitDonnees({ ...pkg, text: 'a'.repeat(300) }));
  assert.ok(!JSON.parse(long.reply_markup).inline_keyboard.flat().some((x) => x.copy_text?.text === 'a'.repeat(300)));
  assert.ok(long.text.includes('a'.repeat(300)));
});

test('aperçu : échappement HTML, limite de 4000 caractères, boutons', () => {
  const long = 'Texte <b>& très long '.repeat(80);
  const dossier = { rubrique: 'Bordeaux & Co', source: 'ia', nature: 'actu', facebook: { texte: long }, bluesky: { texte: long, hashtag: '#Bordeaux' }, threads: { texte: long }, x: { texte: long } };
  const text = buildPreviewText({ article: { title: 'A < B', link: 'https://x' }, dossier, caption: long, items: [{ channel: 'instagram', status: 'awaiting', dueAt: 0 }], when: () => 'vers 14h' });
  assert.ok(text.length <= 4000);
  assert.ok(text.includes('A &lt; B') && text.includes('Bordeaux &amp; Co') && !text.includes('<b>&'));
  assert.equal(previewButtons('abc', true)[0][0].callback_data, 'v:abc');
  assert.ok(previewButtons('abc', true).flat().every((b) => Buffer.byteLength(b.callback_data) <= 64));
});

test('kit X : les comptes à chercher à la main sont proposés, pas devinés', async () => {
  const { kitDonnees } = await import('../src/channels/x.mjs');
  // X n'a pas d'API gratuite : aucun pseudo n'y est vérifiable. Plutôt que de se taire, le kit
  // donne les organisations confirmées sur les autres réseaux — le nom est sûr, le pseudo non.
  const base = { article: { title: 'T', guid: 'g' }, mode: 'lien', text: 'Texte' };
  const kit = kitDonnees({ ...base, dossier: { comptes: {
    x: [],
    instagram: [{ nom: 'Parc Zoo du Reynou', handle: 'parczooreynou' }, { nom: 'biodiversité', handle: 'ofbiodiversite', thematique: true }],
    bluesky: [{ nom: 'biodiversité', handle: 'ofbiodiversite.bsky.social', thematique: true }],
  } } });
  assert.deepEqual(kit.aChercher.map((c) => c.nom), ['Parc Zoo du Reynou', 'biodiversité'], 'une organisation citée une seule fois');
  // un compte déjà connu sur X n'est pas proposé à la recherche
  const avecX = kitDonnees({ ...base, dossier: { comptes: { x: [{ nom: 'Parc Zoo du Reynou', handle: 'parczooreynou' }], instagram: [{ nom: 'Parc Zoo du Reynou', handle: 'parczooreynou' }] } } });
  assert.deepEqual(avecX.aChercher, []);
});
