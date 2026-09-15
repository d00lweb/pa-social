import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const fromRoot = (...parts) => join(ROOT, ...parts);

export const config = JSON.parse(readFileSync(fromRoot('config/channels.json'), 'utf8'));

// DRY_RUN=1 : rendu + dépôt FTP, sans publication ni état ; DRY_RUN_LATEST=n : les n derniers articles
export const DRY_RUN = ['1', 'true'].includes(process.env.DRY_RUN);
export const DRY_RUN_LATEST = Number(process.env.DRY_RUN_LATEST) || 0;

export const enabledChannels = () =>
  Object.entries(config.channels)
    .filter(([, channel]) => channel.enabled)
    .map(([id, channel]) => ({ id, ...channel }));
