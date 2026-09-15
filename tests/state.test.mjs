import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadHistory, saveHistory, loadQueue, hasPublished, lastPublishedAt } from '../src/core/state.mjs';

test('historique : anciennes entrées migrées vers le canal instagram', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pa-state-'));
  await writeFile(join(dir, 'published.json'), JSON.stringify(['guid-a', { guid: 'guid-b', at: '2026-09-15T05:56:36.479Z', mediaId: '1' }]));
  const history = await loadHistory(dir);
  assert.deepEqual(history.map((e) => e.channel), ['instagram', 'instagram']);
  assert.equal(hasPublished(history, 'guid-b', 'instagram'), true);
  assert.equal(hasPublished(history, 'guid-b', 'bluesky'), false);
  assert.equal(lastPublishedAt(history, 'instagram'), Date.parse('2026-09-15T05:56:36.479Z'));
  assert.equal(lastPublishedAt(history, 'bluesky'), 0);

  await saveHistory(history, dir);
  assert.equal(JSON.parse(await readFile(join(dir, 'published.json'), 'utf8'))[1].channel, 'instagram');
  assert.deepEqual(await loadQueue(dir), []);
});
