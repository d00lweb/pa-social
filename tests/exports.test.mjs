import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromRoot } from '../src/core/config.mjs';
import { champs, joursDunExport, fusionnerExports, modelesDunExport } from '../src/brain/exports.mjs';

// 23/09/2026 : le rapport de coûts de l'API est fermé aux comptes individuels. Restent les deux
// exports CSV de la console, qui disent la vérité — à condition de n'y lire que la clé du projet :
// le même compte porte aussi « dash » et « Module Media PA », sans rapport avec Passion Aquitaine.
const couts = readFileSync(fromRoot('tests/fixtures/export-couts.csv'), 'utf8');
const jetons = readFileSync(fromRoot('tests/fixtures/export-jetons.csv'), 'utf8');

test('découpage CSV : les champs entre guillemets ne sont pas coupés', () => {
  assert.deepEqual(champs('a,b,c'), ['a', 'b', 'c']);
  assert.deepEqual(champs('2026-09-15,"Opus 5, rapide",0.12'), ['2026-09-15', 'Opus 5, rapide', '0.12']);
  assert.deepEqual(champs('x,"il a dit ""oui""",y'), ['x', 'il a dit "oui"', 'y']);
});

test('export des coûts : les autres clés du compte sont écartées', () => {
  const jours = joursDunExport(couts, 'pa-social');
  assert.equal(jours['2026-09-13'], undefined, '13/09 n’appartient qu’à la clé « dash »');
  assert.equal(Math.round(jours['2026-09-15'] * 100) / 100, 3.1, 'entrée + sortie du même jour');
  assert.equal(Math.round(jours['2026-09-23'] * 100) / 100, 1.28);
  // sans filtre, tout le compte est compté
  assert.ok(joursDunExport(couts, null)['2026-09-13'] > 0);
});

test('export des jetons : le coût est recalculé à la grille, modèle daté compris', () => {
  const jours = joursDunExport(jetons, 'pa-social');
  // 306 825 × 5 $ + 62 728 × 25 $ par million
  assert.equal(Math.round(jours['2026-09-15'] * 1e4) / 1e4, 3.1023);
  // ce jour-là, trois modèles sur la même clé, dont « claude-haiku-4-5-20251001 »
  assert.equal(Math.round(jours['2026-09-23'] * 1e4) / 1e4, 1.9042);
  const modeles = modelesDunExport(jetons, 'pa-social');
  assert.equal(Math.round(modeles['claude-haiku-4-5'] * 1e4) / 1e4, 0.009, 'Haiku au tarif Haiku, pas à celui d’Opus');
  assert.ok(modeles['claude-opus-5'] > modeles['claude-sonnet-5']);
});

test('deux exports fusionnés : le montant le plus élevé l’emporte, jour par jour', () => {
  const jours = fusionnerExports([couts, jetons], 'pa-social');
  // l'export des coûts a quelques heures de retard : le 23/09 il annonce 1,28 $ quand les jetons,
  // eux, en valent déjà 1,90. Une dépense ne doit jamais être annoncée plus basse qu'elle n'est.
  assert.equal(Math.round(jours['2026-09-23'] * 1e4) / 1e4, 1.9042);
  assert.equal(Math.round(jours['2026-09-18'] * 100) / 100, 0.47, 'les deux exports tombent d’accord');
  const total = Object.values(jours).reduce((n, v) => n + v, 0);
  assert.equal(Math.round(total * 100) / 100, 6.88, 'septembre 2026 sur la clé du projet');
});

test('un fichier aux colonnes inconnues est refusé, pas deviné', () => {
  assert.throws(() => joursDunExport('a,b\n1,2', 'pa-social'), /Colonnes inconnues/);
  assert.deepEqual(joursDunExport('', 'pa-social'), {});
});
