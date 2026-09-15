import { config, DRY_RUN, DRY_RUN_LATEST, enabledChannels } from './core/config.mjs';
import { GuardError, DeferError } from './core/errors.mjs';
import { loadHistory, saveHistory, loadQueue, saveQueue, hasPublished, lastPublishedAt } from './core/state.mjs';
import { planDueAt, recheck } from './core/scheduler.mjs';
import { fetchItems } from './sources/rss.mjs';
import { alert } from './channels/telegram.mjs';
import * as instagram from './channels/instagram.mjs';

const CHANNELS = { instagram };
const DEFAULT_RSS = 'https://passion-aquitaine.ouest-france.fr/feed/';
const HOUR = 3600e3;

const paris = (ms) => new Date(ms).toLocaleString('fr-FR', { timeZone: config.timezone, dateStyle: 'short', timeStyle: 'short' });
const notify = (text) => alert(text).catch((e) => console.error(`Alerte Telegram impossible : ${e.message}`));

function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Variables manquantes : ${missing.join(', ')}`);
}

// À blanc : rendu + dépôt FTP des derniers articles, sans publication ni état
async function dryRun(items) {
  console.log('Mode DRY_RUN : rien ne sera publié ni enregistré.');
  const newest = [...items].sort((a, b) => b.date - a.date).slice(0, DRY_RUN_LATEST || 1);
  let failed = 0;
  for (const article of newest) {
    try {
      const pkg = await instagram.prepare(article);
      const urls = await instagram.stage(pkg);
      console.log(`   En ligne :\n     ${urls.join('\n     ')}`);
      console.log(`   Légende prévue :\n${pkg.caption.replace(/^/gm, '     | ')}`);
    } catch (err) {
      failed++;
      console.error(err instanceof GuardError ? err.message : err.stack);
    }
  }
  if (failed) process.exitCode = 1;
}

// Nouveaux articles → file, avec une heure prévue par canal
function plan(items, history, queue, now) {
  const fresh = items.filter((a) => now - a.date <= config.maxAgeHours * HOUR).sort((a, b) => a.date - b.date);
  for (const channel of enabledChannels()) {
    for (const article of fresh) {
      const known = hasPublished(history, article.guid, channel.id) || queue.some((q) => q.guid === article.guid && q.channel === channel.id);
      if (known) continue;
      const lastPlannedAt = Math.max(0, ...queue.filter((q) => q.channel === channel.id && q.status === 'pending').map((q) => q.dueAt));
      const dueAt = planDueAt({ now, lastAt: lastPublishedAt(history, channel.id), lastPlannedAt, channel, timeZone: config.timezone });
      queue.push({ guid: article.guid, channel: channel.id, dueAt, status: 'pending', attempts: 0, article });
      console.log(`Planifié ${channel.id} : ${article.title} → ${paris(dueAt)}`);
    }
  }
}

// Articles bloqués ou en échec conservés quelques jours pour information
function prune(queue, now) {
  const limit = now - config.queueRetentionDays * 24 * HOUR;
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].status !== 'pending' && queue[i].dueAt < limit) queue.splice(i, 1);
  }
}

// Au plus une publication due par canal
async function execute(history, queue, now) {
  let failed = 0;
  for (const channel of enabledChannels()) {
    const item = queue
      .filter((q) => q.channel === channel.id && q.status === 'pending' && q.dueAt <= now)
      .sort((a, b) => a.dueAt - b.dueAt)[0];
    if (!item) continue;

    if (hasPublished(history, item.guid, channel.id)) {
      queue.splice(queue.indexOf(item), 1);
      continue;
    }
    const later = recheck({ now, lastAt: lastPublishedAt(history, channel.id), channel, timeZone: config.timezone });
    if (later) {
      item.dueAt = later;
      console.log(`Reporté ${channel.id} : ${item.article.title} → ${paris(later)}`);
      continue;
    }

    try {
      const impl = CHANNELS[channel.id];
      const pkg = await impl.prepare(item.article);
      const { mediaId } = await impl.publish(pkg, { channel });
      history.push({ guid: item.guid, channel: channel.id, at: new Date().toISOString(), mediaId });
      queue.splice(queue.indexOf(item), 1);
      await Promise.all([saveHistory(history), saveQueue(queue)]);
      console.log(`Publié ${channel.id} : ${mediaId}`);
    } catch (err) {
      if (err instanceof DeferError) {
        item.dueAt = now + HOUR;
        console.log(`Reporté ${channel.id} (${err.message}) → ${paris(item.dueAt)}`);
        continue;
      }
      failed++;
      item.attempts += 1;
      item.lastError = err.message;
      if (err instanceof GuardError) {
        item.status = 'blocked';
        await notify(err.message);
      } else {
        console.error(err.stack ?? err.message);
        const final = item.attempts >= config.retry.maxAttempts;
        if (final) item.status = 'failed';
        else item.dueAt = now + config.retry.delayMinutes * 60e3 * item.attempts;
        if (item.attempts === 1 || final) {
          await notify(`❌ ${channel.id} : échec ${item.attempts}/${config.retry.maxAttempts}${final ? ', abandon' : ', nouvel essai prévu'}\n${item.article.title}\n${err.message}`);
        }
      }
    }
  }
  return failed;
}

async function main() {
  requireEnv(['IG_USER_ID', 'IG_TOKEN', 'SFTP_HOST', 'SFTP_USER', 'SFTP_PASS', 'SFTP_DIR']);
  const items = await fetchItems(process.env.RSS_URL || DEFAULT_RSS);
  if (DRY_RUN) return dryRun(items);

  const now = Date.now();
  const [history, queue] = await Promise.all([loadHistory(), loadQueue()]);
  let failed = 0;
  try {
    plan(items, history, queue, now);
    prune(queue, now);
    failed = await execute(history, queue, now);
  } finally {
    await Promise.all([saveHistory(history), saveQueue(queue)]);
  }
  const pending = queue.filter((q) => q.status === 'pending');
  console.log(pending.length ? `File : ${pending.map((q) => `${q.channel} ${paris(q.dueAt)}`).join(' · ')}` : 'File vide.');
  if (failed) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err.stack ?? err.message);
  if (!DRY_RUN) await notify(`❌ Échec pa-social\n${err.message}`);
  process.exitCode = 1;
});
