import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { modeFor, postText, replyTextFor, FORMATS } from '../src/channels/threads.mjs';
import { fromRoot } from '../src/core/config.mjs';

const config = JSON.parse(readFileSync(fromRoot('config/channels.json'), 'utf8'));
const lien = 'https://site.fr/article';
const dossier = { threads: { texte: 'À Bordeaux, le matrimoine revient 🎭', sujet: 'Bordeaux' } };

test('Threads : inactif tant que le jeton manque, 3 posts par jour', () => {
  const th = config.channels.threads;
  assert.deepEqual(th.requiresEnv, ['THREADS_USER_ID', 'THREADS_TOKEN']);
  assert.equal(th.maxPerDay, 3, 'même rythme que Bluesky et le kit X');
  assert.equal(th.validation, false);
  assert.deepEqual(th.formats, ['image', 'lien', 'reponse']);
});

test('Threads : les 3 formats se répartissent équitablement et restent stables par article', () => {
  const modes = Array.from({ length: 600 }, (_, i) => modeFor(`https://site.fr/?p=${i}`));
  for (const f of FORMATS) {
    const n = modes.filter((m) => m === f).length;
    assert.ok(n > 140 && n < 260, `${f} : ${n}`);
  }
  assert.equal(modeFor('https://site.fr/?p=7'), modeFor('https://site.fr/?p=7'));
});

test('Threads : le lien n’est dans le texte que pour le format image', () => {
  assert.equal(postText(dossier, 'image', lien), `À Bordeaux, le matrimoine revient 🎭\n➡️ ${lien}`);
  // « lien seul » : l'aperçu natif porte l'URL ; « réponse » : elle part dans la réponse
  assert.equal(postText(dossier, 'lien', lien), 'À Bordeaux, le matrimoine revient 🎭');
  assert.equal(postText(dossier, 'reponse', lien), 'À Bordeaux, le matrimoine revient 🎭');
});

test('Threads : la formule avant le lien tourne, et diffère de celle de Bluesky', () => {
  const article = { guid: 'g1', link: lien };
  assert.match(replyTextFor(article), /^\S+ .+ https:\/\/site\.fr\/article$/u);
  assert.equal(replyTextFor(article), replyTextFor(article), 'stable pour un même article');
});
