import { test } from 'node:test';
import assert from 'node:assert/strict';
test('post disparu chez le réseau : le jalon est clos, pas retenté sans fin', async () => {
  const { collecter, aRelever } = await import('../src/measure/collect.mjs');
  const { parPost } = await import('../src/measure/rapport.mjs');
  // 24/09/2026 : « Object with ID '18071283440738292' does not exist » repartait à chaque passage.
  const mesures = [
    { guid: 'g', channel: 'instagram', jalon: 1, publieLe: '2026-09-20T10:00:00Z', likes: 12 },
    { guid: 'disparu', channel: 'instagram', jalon: 1, publieLe: '2026-09-20T10:00:00Z', introuvable: true },
  ];
  const history = [
    { guid: 'g', channel: 'instagram', mediaId: '1', at: '2026-09-20T10:00:00Z' },
    { guid: 'disparu', channel: 'instagram', mediaId: '2', at: '2026-09-20T10:00:00Z' },
  ];
  const restant = aRelever(history, mesures, Date.parse('2026-09-24T10:00:00Z')).filter((r) => r.jalon === 1);
  assert.equal(restant.length, 0, 'le jalon clos ne revient pas');
  // et il ne pèse pas sur les moyennes : aucun chiffre à en tirer
  assert.deepEqual(parPost(mesures).map((m) => m.guid), ['g']);
  assert.equal(typeof collecter, 'function');
});
