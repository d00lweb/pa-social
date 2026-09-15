import { readFileSync } from 'node:fs';
import { config, DRY_RUN, DRY_RUN_LATEST, enabledChannels, fromRoot } from './core/config.mjs';
import { GuardError, DeferError } from './core/errors.mjs';
import { loadHistory, saveHistory, loadQueue, saveQueue, loadJson, saveJson, hasPublished, lastPublishedAt } from './core/state.mjs';
import { planDueAt, recheck, jitter } from './core/scheduler.mjs';
import { NETWORKS, NAMES, shortId, parseCommand, defaultControls, isPaused, needsValidation, targets, applyDecision } from './core/control.mjs';
import { fetchItems } from './sources/rss.mjs';
import { buildDossier } from './brain/dossier.mjs';
import { loadMemory, saveMemory, remember } from './brain/memory.mjs';
import { alert, telegramEnabled, send, sendPhotos, getUpdates, answerCallback, clearButtons } from './channels/telegram.mjs';
import { buildPreviewText, previewButtons, esc } from './channels/preview.mjs';
import * as instagram from './channels/instagram.mjs';

const CHANNELS = { instagram };
const DEFAULT_RSS = 'https://passion-aquitaine.ouest-france.fr/feed/';
const HOUR = 3600e3;
const TZ = config.timezone;
const OPEN = ['awaiting', 'pending'];
const ed = JSON.parse(readFileSync(fromRoot('config/editorial.json'), 'utf8'));

const paris = (ms) => new Date(ms).toLocaleString('fr-FR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' });
const notify = (text) => alert(text).catch((e) => console.error(`Alerte Telegram impossible : ${e.message}`));
const say = (text, extra) => send(text, extra).catch((e) => console.error(`Telegram : ${e.message}`));

function when(ms, now) {
  if (ms <= now) return 'dès que possible';
  const d = new Date(ms);
  const day = (x) => new Date(x).toLocaleDateString('fr-FR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
  return day(ms) === day(now) ? `vers ${time}` : `le ${day(ms)} vers ${time}`;
}

function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Variables manquantes : ${missing.join(', ')}`);
}

// À blanc : dossier IA + rendu + dépôt FTP des derniers articles, sans publication ni état
async function dryRun(items) {
  console.log('Mode DRY_RUN : rien ne sera publié ni enregistré.');
  const memory = await loadMemory();
  const newest = [...items].sort((a, b) => b.date - a.date).slice(0, DRY_RUN_LATEST || 1);
  let failed = 0;
  for (const article of newest) {
    try {
      const dossier = await buildDossier(article, { memory, useCache: true });
      const pkg = await instagram.prepare(article, { dossier });
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

// ── Telegram : boutons et commandes lus à chaque passage ──

async function onCallback(cb, ctx) {
  if (String(cb.message?.chat?.id) !== String(process.env.TELEGRAM_CHAT_ID)) return answerCallback(cb.id, 'Non autorisé');
  const [action, id] = String(cb.data ?? '').split(':');
  const messageId = cb.message?.message_id;
  const { items, done } = applyDecision(ctx.queue, id, action);
  await clearButtons(messageId);
  if (!done) return answerCallback(cb.id, 'Déjà traité');

  const title = esc(items[0].article.title);
  const reply = { reply_to_message_id: String(messageId) };
  if (action === 'v') {
    await answerCallback(cb.id, 'Validé');
    return say(`✅ <b>Validé</b>\n${title}\n${items.map((i) => `${NAMES[i.channel]} : ${when(i.dueAt, ctx.now)}`).join('\n')}`, reply);
  }
  if (action === 'n') {
    await answerCallback(cb.id, 'Refusé');
    return say(`❌ <b>Refusé</b>, ne sera pas publié\n${title}`, reply);
  }
  await answerCallback(cb.id, 'Nouvelle version en préparation');
  const dossier = await buildDossier(items[0].article, { memory: ctx.memory });
  for (const i of items) i.dossier = dossier;
  return say(`🔁 <b>Textes régénérés</b>, nouvel aperçu ci-dessous\n${title}`, reply);
}

function statusText({ controls, queue, history }) {
  const lines = ['📊 <b>Statut</b>'];
  for (const id of NETWORKS) {
    const ch = config.channels[id];
    if (!ch?.enabled) {
      lines.push(`<b>${NAMES[id]}</b> : pas encore actif`);
      continue;
    }
    const state = isPaused(controls, id) ? '⏸ en pause' : '▶️ actif';
    const mode = needsValidation(controls, { id, ...ch }) ? 'validation' : 'automatique';
    const last = lastPublishedAt(history, id);
    lines.push(`<b>${NAMES[id]}</b> : ${state} · ${mode}${last ? ` · dernier post ${paris(last)}` : ''}`);
  }
  const count = (s) => queue.filter((q) => q.status === s).length;
  lines.push('', `À valider : ${count('awaiting')} · Programmés : ${count('pending')}`, '<i>Commandes lues toutes les 20 min environ.</i>');
  return lines.join('\n');
}

function fileText({ queue, now }) {
  const open = queue.filter((q) => OPEN.includes(q.status)).sort((a, b) => a.dueAt - b.dueAt);
  if (!open.length) return '📭 File vide.';
  return ['📋 <b>File</b>', ...open.slice(0, 15).map((q) => `${q.status === 'awaiting' ? '⏳ à valider' : `🕒 ${when(q.dueAt, now)}`} · ${NAMES[q.channel]} · ${esc(q.article.title)}`)].join('\n');
}

const HELP = [
  '🤖 <b>Commandes</b>',
  '/statut : état des réseaux et de la file',
  '/file : posts à valider et programmés',
  '/pause instagram (ou /pause tout)',
  '/reprise instagram (ou /reprise tout)',
  '/validation instagram on|off',
  '',
  'Sous chaque aperçu : ✅ Valider, ❌ Refuser, 🔁 Régénérer les textes.',
  '<i>Le bot lit tes messages à chaque passage, toutes les 20 min environ.</i>',
].join('\n');

async function onCommand(text, ctx) {
  const cmd = parseCommand(text);
  if (!cmd) return;
  const { controls } = ctx;
  switch (cmd.name) {
    case 'pause':
    case 'reprise': {
      const nets = targets(cmd.args[0]);
      if (!nets.length) return say('Réseau inconnu. Exemple : /pause instagram');
      for (const n of nets) {
        if (cmd.name === 'pause') controls.paused[n] = true;
        else delete controls.paused[n];
      }
      return say(`${cmd.name === 'pause' ? '⏸' : '▶️'} ${nets.map((n) => NAMES[n]).join(', ')} : ${cmd.name === 'pause' ? 'en pause' : 'reprise'}`);
    }
    case 'validation': {
      const [net, value] = cmd.args;
      if (!NETWORKS.includes(net) || !['on', 'off'].includes(value)) return say('Exemple : /validation instagram off');
      controls.validation[net] = value === 'on';
      return say(`Validation ${NAMES[net]} : ${value === 'on' ? 'activée, chaque post attend ton ✅' : 'désactivée, publication automatique'}`);
    }
    case 'statut':
      return say(statusText(ctx));
    case 'file':
      return say(fileText(ctx));
    case 'start':
    case 'aide':
    case 'help':
      return say(HELP);
    default:
      return say('Commande inconnue. Envoie /aide');
  }
}

async function handleTelegram(ctx) {
  if (!telegramEnabled()) return;
  let updates;
  try {
    updates = await getUpdates(ctx.tg.offset ?? 0);
  } catch (e) {
    console.error(`Telegram (lecture) : ${e.message}`);
    return;
  }
  for (const u of updates) {
    ctx.tg.offset = u.update_id + 1;
    try {
      if (u.callback_query) await onCallback(u.callback_query, ctx);
      else if (u.message?.text && String(u.message.chat.id) === String(process.env.TELEGRAM_CHAT_ID)) await onCommand(u.message.text, ctx);
    } catch (e) {
      console.error(`Telegram (mise à jour ${u.update_id}) : ${e.stack ?? e.message}`);
    }
  }
}

// ── Planification, aperçus, publication ──

// Nouveaux articles → dossier éditorial (une fois) → file, avec une heure prévue par canal
async function plan(items, { history, queue, memory, controls, now }) {
  const fresh = items.filter((a) => now - a.date <= config.maxAgeHours * HOUR).sort((a, b) => a.date - b.date);
  for (const article of fresh) {
    const channels = enabledChannels().filter((c) => !hasPublished(history, article.guid, c.id) && !queue.some((q) => q.guid === article.guid && q.channel === c.id));
    if (!channels.length) continue;
    const dossier = queue.find((q) => q.guid === article.guid)?.dossier ?? (await buildDossier(article, { memory }));
    remember(memory, dossier, ed.networks, ed.memorySize);
    for (const channel of channels) {
      const lastPlannedAt = Math.max(0, ...queue.filter((q) => q.channel === channel.id && OPEN.includes(q.status)).map((q) => q.dueAt));
      const dueAt = planDueAt({ now, lastAt: lastPublishedAt(history, channel.id), lastPlannedAt, channel, timeZone: TZ });
      const status = telegramEnabled() && needsValidation(controls, channel) ? 'awaiting' : 'pending';
      queue.push({ guid: article.guid, channel: channel.id, dueAt, status, attempts: 0, article, dossier, previewSent: false });
      console.log(`Planifié ${channel.id} (${status}) : ${article.title} → ${paris(dueAt)} [${dossier.source}]`);
    }
  }
}

// Un aperçu Telegram par article (visuels + textes + boutons) ; réessayé au passage suivant en cas d'échec
async function sendPreviews({ queue, memory, now }) {
  if (!telegramEnabled()) return;
  const groups = new Map();
  for (const q of queue) if (OPEN.includes(q.status) && !q.previewSent) groups.set(q.guid, [...(groups.get(q.guid) ?? []), q]);
  for (const [guid, items] of groups) {
    const article = items[0].article;
    try {
      const dossier = items.find((i) => i.dossier)?.dossier ?? (await buildDossier(article, { memory }));
      for (const i of items) i.dossier = dossier;
      const pkg = await instagram.prepare(article, { dossier, log: () => {} });
      await sendPhotos([pkg.files[0].buffer, pkg.files[1].buffer]);
      const awaiting = items.some((i) => i.status === 'awaiting');
      const text = buildPreviewText({ article, dossier, caption: pkg.caption, items, when: (ms) => when(ms, now) });
      await send(text, { reply_markup: JSON.stringify({ inline_keyboard: previewButtons(shortId(guid), awaiting) }) });
      for (const i of items) i.previewSent = true;
      console.log(`Aperçu Telegram envoyé : ${article.title}`);
    } catch (err) {
      if (err instanceof GuardError) {
        for (const i of items) {
          i.status = 'blocked';
          i.lastError = err.message;
        }
        await notify(err.message);
      } else {
        console.error(`Aperçu Telegram impossible (${article.title}) : ${err.message}`);
      }
    }
  }
}

// Non validé à temps : l'article est trop ancien pour être publié
async function expire({ queue, now }) {
  const expired = queue.filter((q) => q.status === 'awaiting' && now - q.article.date > config.maxAgeHours * HOUR);
  for (const q of expired) q.status = 'expired';
  if (expired.length) await say(`⌛ <b>Non validé à temps</b>, abandonné :\n${[...new Set(expired.map((q) => esc(q.article.title)))].join('\n')}`);
}

// Articles terminés conservés quelques jours pour information
function prune(queue, now) {
  const limit = now - config.queueRetentionDays * 24 * HOUR;
  for (let i = queue.length - 1; i >= 0; i--) {
    if (!OPEN.includes(queue[i].status) && queue[i].dueAt < limit) queue.splice(i, 1);
  }
}

// Au plus une publication due par canal actif et non en pause
async function execute({ history, queue, memory, controls, now }) {
  let failed = 0;
  for (const channel of enabledChannels()) {
    if (isPaused(controls, channel.id)) continue;
    const item = queue.filter((q) => q.channel === channel.id && q.status === 'pending' && q.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt)[0];
    if (!item) continue;

    if (hasPublished(history, item.guid, channel.id)) {
      queue.splice(queue.indexOf(item), 1);
      continue;
    }
    const later = recheck({ now, lastAt: lastPublishedAt(history, channel.id), channel, timeZone: TZ });
    if (later) {
      item.dueAt = later;
      console.log(`Reporté ${channel.id} : ${item.article.title} → ${paris(later)}`);
      continue;
    }

    try {
      item.dossier ??= await buildDossier(item.article, { memory });
      const impl = CHANNELS[channel.id];
      const pkg = await impl.prepare(item.article, { dossier: item.dossier });
      // délai aléatoire : les publications ne tombent pas pile sur les minutes du cron
      if (channel.publishDelayMinutes) {
        const wait = jitter(channel.publishDelayMinutes);
        console.log(`Attente aléatoire avant publication : ${Math.round(wait / 1000)} s`);
        await new Promise((r) => setTimeout(r, wait));
      }
      const { mediaId } = await impl.publish(pkg, { channel });
      history.push({ guid: item.guid, channel: channel.id, at: new Date().toISOString(), mediaId });
      queue.splice(queue.indexOf(item), 1);
      await Promise.all([saveHistory(history), saveQueue(queue)]);
      console.log(`Publié ${channel.id} : ${mediaId}`);
      await say(`📣 <b>Publié sur ${NAMES[channel.id]}</b>\n${esc(item.article.title)}`);
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
      } else if (config.restriction.codes.includes(err.code) || config.restriction.subcodes.includes(err.subcode)) {
        // coupe-circuit : limite ou restriction du réseau → pause automatique, reprise manuelle
        controls.paused[channel.id] = true;
        item.dueAt = now + HOUR;
        await notify(`🛑 ${NAMES[channel.id]} mis en pause automatiquement : le réseau signale une limite ou une restriction.\n${err.message}\nVérifie le compte dans l'app, puis envoie /reprise ${channel.id}`);
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

  const [history, queue, memory, controls, tg] = await Promise.all([
    loadHistory(), loadQueue(), loadMemory(), loadJson('controls.json', defaultControls()), loadJson('telegram.json', { offset: 0 }),
  ]);
  controls.paused ??= {};
  controls.validation ??= {};
  const ctx = { now: Date.now(), history, queue, memory, controls, tg };
  let failed = 0;
  try {
    await handleTelegram(ctx);
    await plan(items, ctx);
    await sendPreviews(ctx);
    await expire(ctx);
    prune(queue, ctx.now);
    failed = await execute(ctx);
  } finally {
    await Promise.all([saveHistory(history), saveQueue(queue), saveMemory(memory), saveJson('controls.json', controls), saveJson('telegram.json', tg)]);
  }
  const open = queue.filter((q) => OPEN.includes(q.status));
  console.log(open.length ? `File : ${open.map((q) => `${q.channel} ${q.status} ${paris(q.dueAt)}`).join(' · ')}` : 'File vide.');
  if (failed) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err.stack ?? err.message);
  if (!DRY_RUN) await notify(`❌ Échec pa-social\n${err.message}`);
  process.exitCode = 1;
});
