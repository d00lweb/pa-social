import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fromRoot } from './config.mjs';

const DEFAULT_DIR = fromRoot('state');

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}

async function writeJson(dir, name, data) {
  const chemin = join(dir, name);
  // `name` peut contenir un sous-dossier (rapports/2026-09.json) : on le crée aussi
  await mkdir(dirname(chemin), { recursive: true });
  await writeFile(chemin, `${JSON.stringify(data, null, 2)}\n`);
}

// Historique { guid, channel, at, mediaId } ; les entrées d'avant l'étape 1 (sans canal) sont des publications Instagram
export async function loadHistory(dir = DEFAULT_DIR) {
  const raw = await readJson(join(dir, 'published.json'), []);
  return raw.map((e) => (typeof e === 'string' ? { guid: e, channel: 'instagram', at: null } : { channel: 'instagram', ...e }));
}
export const saveHistory = (history, dir = DEFAULT_DIR) => writeJson(dir, 'published.json', history);

// File { guid, channel, dueAt, status: pending | blocked | failed, attempts, lastError, article }
export const loadQueue = (dir = DEFAULT_DIR) => readJson(join(dir, 'queue.json'), []);
export const saveQueue = (queue, dir = DEFAULT_DIR) => writeJson(dir, 'queue.json', queue);

// Petits fichiers d'état (contrôles Telegram, curseur de lecture…)
export const loadJson = (name, fallback, dir = DEFAULT_DIR) => readJson(join(dir, name), fallback);
export const saveJson = (name, data, dir = DEFAULT_DIR) => writeJson(dir, name, data);

export const hasPublished = (history, guid, channel) => history.some((e) => e.guid === guid && e.channel === channel);
export const lastPublishedAt = (history, channel) =>
  Math.max(0, ...history.filter((e) => e.channel === channel).map((e) => Date.parse(e.at) || 0));
