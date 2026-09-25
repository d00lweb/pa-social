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

test('kit X : lien de rédaction pré-remplie, message copiable, statut « déjà publié »', async () => {
  const { intentUrl, kitMessages, xLength } = await import('../src/channels/x.mjs');
  const { aCopier } = await import('../src/channels/messages.mjs');
  const post = 'Le matrimoine revient à #Bordeaux 🎭\n➡️ https://site.fr/un-tres-long-lien-d-article';
  const url = new URL(intentUrl(post));
  assert.equal(url.origin + url.pathname, 'https://x.com/intent/post');
  assert.equal(url.searchParams.get('text'), post);
  assert.equal(new URL(intentUrl(`
${post}
`)).searchParams.get('text'), post, 'jamais de blanc de bordure : le post commencerait par une ligne vide');
  // 34 caractères + emoji (2) + saut de ligne (1) + ➡️ (2) + espace (1) + lien (23)
  assert.equal(xLength(post), 34 + 2 + 1 + 2 + 1 + 23);
  // Un message à copier ne contient QUE ce qu'il faut copier : l'étiquette est sur le bouton.
  // Avec le titre dans le message, une copie le ramenait avec ; l'effacer laissait une ligne vide,
  // et le post partait sur X en commençant par un saut de ligne.
  const texteX = `Texte <ok>\n➡️ https://site.fr/a`;
  const kit1 = kitMessages({ article: { title: 'A & B' }, mode: 'image', text: texteX, link: 'https://site.fr/a', intent: intentUrl(texteX) });
  assert.ok(kit1.sommaire.includes('A &amp; B'));
  assert.equal(kit1.elements.length, 1, 'un seul élément à copier : le texte du post');
  assert.equal(kit1.elements[0].valeur, texteX);
  assert.match(kit1.elements[0].etiquette, /^Copier le texte \(\d+\/280\)$/);
  // le bouton « Publier sur X » est contre le texte à coller, pas trois messages plus haut
  const { options: boutonsTexte } = aCopier(kit1.elements[0].etiquette, kit1.elements[0].valeur, { lien: kit1.elements[0].lien });
  const rangee = JSON.parse(boutonsTexte.reply_markup).inline_keyboard[0];
  assert.equal(rangee.length, 2);
  assert.equal(rangee[1].text, '✍️ Publier sur X');
  assert.ok(rangee[1].url.startsWith('https://x.com/intent/post?text='));

  // chaque élément dans son propre message, pour être copié indépendamment
  const kit = kitMessages({
    article: { title: 'T' },
    mode: 'reponse',
    text: 'Texte seul',
    replyText: '📖 L’article : https://site.fr/a',
    dossier: { comptes: { x: [{ nom: 'Musée', handle: 'MuseeAquitaine' }] }, lieu: { nom: 'Bordeaux' }, visuel: { texte_alternatif: 'Une façade' } },
  });
  assert.deepEqual(kit.elements.map((e) => e.valeur), ['Texte seul', '📖 L’article : https://site.fr/a', '@MuseeAquitaine', 'Bordeaux', 'Une façade']);
  assert.ok(kit.sommaire.includes('le compte de Musée'), 'le sommaire annonce l’ordre des messages');

  // le message ne porte que la valeur, échappée ; le bouton copie exactement cette valeur
  const { text: corps, options } = aCopier('Copier le texte du post', kit1.elements[0].valeur);
  assert.equal(corps, `<code>${texteX.replace('<ok>', '&lt;ok&gt;')}</code>`, 'rien que la valeur, échappée');
  assert.equal(JSON.parse(options.reply_markup).inline_keyboard[0][0].copy_text.text, kit1.elements[0].valeur);
  assert.equal(aCopier('x', 'a'.repeat(300)).options.reply_markup, undefined, 'au-delà de 256 caractères, pas de bouton');

  const dossier = { rubrique: 'R', source: 'ia', facebook: { texte: 'f' }, bluesky: { texte: 'b', hashtag: '#R' }, threads: { texte: 't' }, x: { texte: 'x' } };
  const text = buildPreviewText({ article: { guid: 'g', title: 'T', link: 'https://x' }, dossier, caption: 'c', items: [{ channel: 'x', status: 'awaiting', dueAt: 0 }], published: ['instagram'], when: () => 'vers 9h' });
  assert.ok(text.includes('<b>Instagram</b> · <i>déjà publié</i>') && text.includes('kit Telegram'));
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
  const { kitMessages } = await import('../src/channels/x.mjs');
  // X n'a pas d'API gratuite : aucun pseudo n'y est vérifiable. Plutôt que de se taire, le kit
  // donne les organisations confirmées sur les autres réseaux — le nom est sûr, le pseudo non.
  const kit = kitMessages({
    article: { title: 'T' }, mode: 'lien', text: 'Texte',
    dossier: {
      comptes: {
        x: [],
        instagram: [{ nom: 'Parc Zoo du Reynou', handle: 'parczooreynou' }, { nom: 'biodiversité', handle: 'ofbiodiversite', thematique: true }],
        bluesky: [{ nom: 'biodiversité', handle: 'ofbiodiversite.bsky.social', thematique: true }],
      },
    },
  });
  assert.deepEqual(kit.aChercher.map((c) => c.nom), ['Parc Zoo du Reynou', 'biodiversité'], 'une organisation citée une seule fois');
  // un compte déjà connu sur X n'est pas proposé à la recherche
  const avecX = kitMessages({
    article: { title: 'T' }, mode: 'lien', text: 'Texte',
    dossier: { comptes: { x: [{ nom: 'Parc Zoo du Reynou', handle: 'parczooreynou' }], instagram: [{ nom: 'Parc Zoo du Reynou', handle: 'parczooreynou' }] } },
  });
  assert.deepEqual(avecX.aChercher, []);
});
