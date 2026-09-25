import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fromRoot } from '../core/config.mjs';

const DEFAULT_DIR = fromRoot('state');

// { angleIndex, recent: { réseau: [débuts des dernières accroches] } }
export async function loadMemory(dir = DEFAULT_DIR) {
  try {
    return JSON.parse(await readFile(join(dir, 'memory.json'), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return { angleIndex: 0, recent: {} };
    throw e;
  }
}

export async function saveMemory(memory, dir = DEFAULT_DIR) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'memory.json'), `${JSON.stringify(memory, null, 2)}\n`);
}

// Un angle différent par réseau, décalé d'un cran à chaque article
export function nextAngles(memory, angles, networks) {
  const start = (memory.angleIndex ?? 0) % angles.length;
  memory.angleIndex = start + 1;
  return Object.fromEntries(networks.map((net, i) => [net, angles[(start + i) % angles.length]]));
}

// Placement de l'emoji : différent d'un réseau à l'autre, décalé à chaque article (après nextAngles).
// Facebook est tenu à l'écart de la position « en tête » : sur ce réseau, le texte est coupé vers
// 125 caractères et les premiers mots doivent porter le fait, pas un pictogramme.
// Facebook ne tient qu'en une phrase, posée au-dessus de la carte d'aperçu : l'emoji la referme,
// toujours. Placé en tête il mange les premiers mots, placé au milieu il coupe la lecture
// (« Ils seront plus de 💃 200 danseurs… »).
const PLACEMENT_IMPOSE = { facebook: 'en fin de texte' };
export function nextEmojiPositions(memory, positions, networks) {
  const start = ((memory.angleIndex ?? 1) * 3) % positions.length;
  return Object.fromEntries(networks.map((net, i) => [net, PLACEMENT_IMPOSE[net] ?? positions[(start + i) % positions.length]]));
}

// Comptes de référence déjà mentionnés, du plus ancien au plus récent. C'est cette mémoire qui
// fait tourner les viviers : sans elle, chaque article sur le trail mentionnerait les deux mêmes
// comptes, et parlerait chaque fois aux abonnés déjà touchés.
export function retenirMentions(memory, comptes = [], taille = 40) {
  const handles = comptes.filter((c) => c.thematique).map((c) => c.handle);
  if (!handles.length) return memory;
  memory.mentions = [...(memory.mentions ?? []), ...handles].slice(-taille);
  return memory;
}

export function remember(memory, dossier, networks, size) {
  memory.recent ??= {};
  memory.emojis ??= {};
  for (const net of networks) {
    const text = dossier[net]?.texte;
    if (!text) continue;
    memory.recent[net] = [...(memory.recent[net] ?? []), text.slice(0, 160)].slice(-size);
    const emojis = (text.match(/\p{Extended_Pictographic}/gu) ?? []);
    memory.emojis[net] = [...(memory.emojis[net] ?? []), emojis].slice(-2);
  }
}
