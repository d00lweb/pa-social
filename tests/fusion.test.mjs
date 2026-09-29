import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fusionner, fusionnerCouts } from '../scripts/fusion-etat.mjs';

// Le 17/09/2026, une exécution mise en attente a repris un état périmé, republié un article,
// puis échoué à enregistrer son état sur un conflit. Ces tests protègent les deux bouts.

test('fusion : aucune publication perdue quand deux exécutions se croisent', () => {
  const distant = [{ guid: 'a', channel: 'instagram', at: '2026-09-17T15:05:35.000Z', mediaId: '1' }];
  const local = [
    { guid: 'a', channel: 'instagram', at: '2026-09-17T15:22:09.000Z', mediaId: '2' },
    { guid: 'b', channel: 'bluesky', at: '2026-09-17T15:27:15.000Z', mediaId: 'at://x' },
  ];
  const { historique } = fusionner({ distant, local });
  assert.equal(historique.length, 2, 'un article publié deux fois ne compte qu’une entrée');
  assert.equal(historique[0].mediaId, '1', 'la première publication fait foi');
  assert.equal(historique[1].guid, 'b', 'la publication de l’autre exécution est conservée');
});

test('fusion : la file est purgée de ce qui est déjà publié ailleurs', () => {
  const distant = [{ guid: 'a', channel: 'instagram', at: '2026-09-17T15:05:35.000Z' }];
  const file = [
    { guid: 'a', channel: 'instagram', status: 'pending' },
    { guid: 'c', channel: 'x', status: 'pending' },
  ];
  const { file: restante } = fusionner({ distant, file });
  assert.deepEqual(restante.map((i) => i.guid), ['c'], 'plus jamais republié depuis la file');
});

test('fusion : état distant vide ou identique, rien ne se perd', () => {
  const local = [{ guid: 'a', channel: 'x', at: '2026-09-17T10:00:00.000Z' }];
  assert.deepEqual(fusionner({ distant: [], local }).historique, local);
  assert.deepEqual(fusionner({ distant: local, local }).historique, local);
});

// Le 29/09/2026, un passage du robot parti juste avant l'envoi d'un essai a réenregistré sa propre
// version du relevé des coûts : les 0,64 $ de l'essai en ont disparu, et avec eux du budget.
const jour = (robot, local, parModele) => ({
  appels: robot.appels + (local?.appels ?? 0),
  cout: Math.round((robot.cout + (local?.cout ?? 0)) * 1e6) / 1e6,
  parModele,
  parOrigine: local ? { robot, local } : { robot },
});

test('relevé des coûts : un essai enregistré pendant un passage du robot n’est plus effacé', () => {
  const base = { '2026-09-29': jour({ appels: 2, cout: 0.12197 }, null, { 'claude-opus-5': 2 }) };
  // sur GitHub entre-temps : l'essai lancé depuis le poste
  const distant = { '2026-09-29': jour({ appels: 2, cout: 0.12197 }, { appels: 19, cout: 0.639754 }, { 'claude-opus-5': 2, 'claude-opus-5-5': 7, 'claude-sonnet-5-5': 12 }) };
  // pendant ce temps, le robot rédige un article de plus
  const local = { '2026-09-29': jour({ appels: 3, cout: 0.18197 }, null, { 'claude-opus-5': 2, 'claude-opus-5-5': 1 }) };
  const fusion = fusionnerCouts({ distant, local, base });
  assert.deepEqual(fusion['2026-09-29'], jour({ appels: 3, cout: 0.18197 }, { appels: 19, cout: 0.639754 }, { 'claude-opus-5': 2, 'claude-opus-5-5': 8, 'claude-sonnet-5-5': 12 }));
});

test('relevé des coûts : jours nouveaux gardés des deux côtés, jour purgé par l’exécution retiré', () => {
  const base = { '2025-08-01': jour({ appels: 1, cout: 0.05 }, null, {}), '2026-09-28': jour({ appels: 1, cout: 0.05 }, null, {}) };
  const distant = { ...base, '2026-09-29': jour({ appels: 0, cout: 0 }, { appels: 4, cout: 0.2 }, {}) };
  const local = { '2026-09-28': base['2026-09-28'], '2026-09-30': jour({ appels: 2, cout: 0.1 }, null, {}) };
  const fusion = fusionnerCouts({ distant, local, base });
  assert.deepEqual(Object.keys(fusion).sort(), ['2026-09-28', '2026-09-29', '2026-09-30']);
  assert.deepEqual(fusion['2026-09-29'], distant['2026-09-29'], 'l’essai du poste est gardé');
  assert.deepEqual(fusion['2026-09-30'], local['2026-09-30'], 'la dépense du robot est gardée');
});

test('relevé des coûts : sans état de départ, la version de l’exécution fait foi (comme avant)', () => {
  const local = { '2026-09-29': jour({ appels: 1, cout: 0.05 }, null, {}) };
  assert.deepEqual(fusionnerCouts({ distant: { '2026-09-28': jour({ appels: 9, cout: 1 }, null, {}) }, local }), local);
});
