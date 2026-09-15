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

test('aperçu : échappement HTML, limite de 4000 caractères, boutons', () => {
  const long = 'Texte <b>& très long '.repeat(80);
  const dossier = { rubrique: 'Bordeaux & Co', source: 'ia', nature: 'actu', facebook: { texte: long }, bluesky: { texte: long, hashtag: '#Bordeaux' }, threads: { texte: long }, x: { texte: long } };
  const text = buildPreviewText({ article: { title: 'A < B', link: 'https://x' }, dossier, caption: long, items: [{ channel: 'instagram', status: 'awaiting', dueAt: 0 }], when: () => 'vers 14h' });
  assert.ok(text.length <= 4000);
  assert.ok(text.includes('A &lt; B') && text.includes('Bordeaux &amp; Co') && !text.includes('<b>&'));
  assert.equal(previewButtons('abc', true)[0][0].callback_data, 'v:abc');
  assert.ok(previewButtons('abc', true).flat().every((b) => Buffer.byteLength(b.callback_data) <= 64));
});
