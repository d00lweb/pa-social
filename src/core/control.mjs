import { createHash } from 'node:crypto';

// Pilotage par Telegram : réseaux, commandes, décisions sur la file (logique pure, testée)
export const NETWORKS = ['instagram', 'facebook', 'bluesky', 'threads', 'x'];
export const NAMES = { instagram: 'Instagram', facebook: 'Facebook', bluesky: 'Bluesky', threads: 'Threads', x: 'X' };
const OPEN = ['awaiting', 'pending'];

export const shortId = (guid) => createHash('sha1').update(String(guid)).digest('hex').slice(0, 10);

export function parseCommand(text = '') {
  const m = String(text).trim().match(/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  return { name: m[1].toLowerCase(), args: (m[2] ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean) };
}

export const defaultControls = () => ({ paused: {}, validation: {} });
export const isPaused = (controls, id) => Boolean(controls.paused?.[id]);
// Réglage Telegram prioritaire sur config/channels.json
export const needsValidation = (controls, channel) => controls.validation?.[channel.id] ?? Boolean(channel.validation);

export function targets(arg) {
  if (!arg || arg === 'tout' || arg === 'all') return NETWORKS;
  return NETWORKS.includes(arg) ? [arg] : [];
}

// v = valider, n = refuser/annuler, g = régénérer ; renvoie les entrées concernées
export function applyDecision(queue, id, action) {
  const open = queue.filter((q) => shortId(q.guid) === id && OPEN.includes(q.status));
  if (!open.length || !['v', 'n', 'g'].includes(action)) return { items: [], done: false };
  if (action === 'v') {
    const awaiting = open.filter((q) => q.status === 'awaiting');
    if (!awaiting.length) return { items: open, done: false };
    for (const q of awaiting) q.status = 'pending';
    return { items: awaiting, done: true };
  }
  if (action === 'n') {
    for (const q of open) q.status = 'refused';
    return { items: open, done: true };
  }
  for (const q of open) {
    delete q.dossier;
    q.previewSent = false;
  }
  return { items: open, done: true };
}
