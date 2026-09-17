import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fusionner } from '../scripts/fusion-etat.mjs';

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
