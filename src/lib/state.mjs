import { readFile, writeFile } from 'node:fs/promises';

// Écart minimum entre deux publications Instagram
export const MIN_GAP_HOURS = 3;

// Entrée : { guid, at, mediaId } ; les anciennes entrées « guid » seul restent lisibles
const normalize = (entry) => (typeof entry === 'string' ? { guid: entry, at: null } : entry);

export async function loadState(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8')).map(normalize);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

export async function markPublished(file, guid, mediaId) {
  const state = await loadState(file);
  if (!state.some((e) => e.guid === guid)) state.push({ guid, at: new Date().toISOString(), mediaId });
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`);
}

export const publishedGuids = (state) => new Set(state.map((e) => e.guid));

// Horodatage (ms) à partir duquel une nouvelle publication est permise ; 0 si aucune publication datée
export function nextSlot(state, gapHours = MIN_GAP_HOURS) {
  const last = Math.max(0, ...state.map((e) => Date.parse(e.at) || 0));
  return last ? last + gapHours * 3600e3 : 0;
}
