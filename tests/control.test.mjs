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
  const post = 'Le matrimoine revient à #Bordeaux 🎭\n➡️ https://site.fr/un-tres-long-lien-d-article';
  const url = new URL(intentUrl(post));
  assert.equal(url.origin + url.pathname, 'https://x.com/intent/post');
  assert.equal(url.searchParams.get('text'), post);
  // 34 caractères + emoji (2) + saut de ligne (1) + ➡️ (2) + espace (1) + lien (23)
  assert.equal(xLength(post), 34 + 2 + 1 + 2 + 1 + 23);
  const msgs = kitMessages({ article: { title: 'A & B' }, mode: 'image', text: 'Texte <ok>\n➡️ https://site.fr/a', link: 'https://site.fr/a' });
  assert.equal(msgs.length, 2, 'consignes + texte, rien d’autre à copier');
  assert.ok(msgs[0].includes('A &amp; B'));
  assert.ok(msgs[1].includes('<code>Texte &lt;ok&gt;\n➡️ https://site.fr/a</code>'));

  // chaque élément dans son propre message, pour être copié indépendamment
  const kit = kitMessages({
    article: { title: 'T' },
    mode: 'reponse',
    text: 'Texte seul',
    replyText: '📖 L’article : https://site.fr/a',
    dossier: { comptes: { x: [{ nom: 'Musée', handle: 'MuseeAquitaine' }] }, lieu: { nom: 'Bordeaux' } },
  });
  assert.equal(kit.length, 5, 'consignes, texte, réponse, compte, lieu');
  assert.ok(kit[1].includes('<code>Texte seul</code>'));
  assert.ok(kit[2].includes('<code>📖 L’article : https://site.fr/a</code>'));
  assert.ok(kit[3].includes('<code>@MuseeAquitaine</code>') && kit[3].includes('Musée'));
  assert.ok(kit[4].includes('<code>Bordeaux</code>'));
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
