import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { facebookComment } from '../src/brain/compose.mjs';
import { fromRoot } from '../src/core/config.mjs';

const config = JSON.parse(readFileSync(fromRoot('config/channels.json'), 'utf8'));

test('Facebook : inactif tant que le jeton de Page manque', () => {
  const fb = config.channels.facebook;
  assert.deepEqual(fb.requiresEnv, ['FB_PAGE_ID', 'FB_TOKEN'], 'le canal reste hors ligne sans identifiants');
  assert.equal(fb.validation, false, 'publication automatique comme les autres réseaux');
});

test('Facebook : deux posts par jour au plus, espacés d’au moins 3 h, jamais la nuit', () => {
  const fb = config.channels.facebook;
  const [min] = fb.gapHours;
  assert.equal(fb.maxPerDay, 2);
  assert.ok(min >= 3, `écart minimum de ${min} h entre deux posts Facebook`);
  assert.equal(fb.quietHours.start, 22);
  assert.equal(fb.quietHours.end, 8);
  const [tot, tard] = fb.commentDelayMinutes;
  assert.ok(tot >= 1 && tard <= 5, 'le commentaire suit le post de 1 à 3 minutes, jamais instantanément');
});

test('Facebook : le lien est dans le commentaire, précédé d’une formule variable', () => {
  const article = { guid: 'g1', link: 'https://site.fr/a' };
  const commentaire = facebookComment(article, { facebook: { commentLead: '📖 L’article complet :' } });
  assert.equal(commentaire, '📖 L’article complet : https://site.fr/a');
  // sans formule imposée, elle reste stable pour un même article
  const sansDossier = facebookComment(article, {});
  assert.match(sansDossier, /^\S+ .+ https:\/\/site\.fr\/a$/u);
  assert.equal(sansDossier, facebookComment(article, {}));
});

test('Facebook : le texte du dossier tient sans « Voir plus » et ne porte aucun lien', () => {
  const ed = JSON.parse(readFileSync(fromRoot('config/editorial.json'), 'utf8'));
  assert.equal(ed.limits.facebook, 120, 'lu en entier sur mobile');
  assert.deepEqual(ed.limits.emoji.facebook, [1, 2]);
});
