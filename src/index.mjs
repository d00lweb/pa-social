import { readFileSync } from 'node:fs';
import { config, DRY_RUN, DRY_RUN_LATEST, enabledChannels, fromRoot } from './core/config.mjs';
import { GuardError, DeferError } from './core/errors.mjs';
import { loadHistory, saveHistory, loadQueue, saveQueue, loadJson, saveJson, hasPublished, lastPublishedAt } from './core/state.mjs';
import { planDueAt, recheck, countToday, nextDay, passageDe, ordonnerFile } from './core/scheduler.mjs';
import { NETWORKS, NAMES, shortId, parseCommand, defaultControls, isPaused, needsValidation, targets, applyDecision } from './core/control.mjs';
import { fetchItems, matchArticle } from './sources/rss.mjs';
import { buildDossier } from './brain/dossier.mjs';
import { resoudreComptes } from './brain/comptes.mjs';
import { resoudreLieu, lieuNomme } from './brain/lieux.mjs';
import { recolterLieux } from './measure/recolte.mjs';
import { collecter } from './measure/collect.mjs';
import { releverAbonnes } from './measure/abonnes.mjs';
import { diffuser } from './measure/diffusion.mjs';
import { ecrire as ecrirePilotage } from './measure/pilotage.mjs';
import { publierPublic } from './measure/public.mjs';
import { verifier as verifierJetons } from './measure/jetons.mjs';
import { capturer as capturerApercu } from './measure/apercus.mjs';
import { loadMemory, saveMemory, remember } from './brain/memory.mjs';
import { alert, telegramEnabled, send, sendPhotos, getUpdates, answerCallback, clearButtons } from './channels/telegram.mjs';
import { buildPreviewText, previewButtons, esc } from './channels/preview.mjs';
import * as instagram from './channels/instagram.mjs';
import * as x from './channels/x.mjs';
import * as bluesky from './channels/bluesky.mjs';
import * as facebook from './channels/facebook.mjs';
import * as threads from './channels/threads.mjs';

const CHANNELS = { instagram, x, bluesky, facebook, threads };
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
  // révèle quels réseaux sont réellement configurés, sans rien publier
  console.log(`Canaux actifs : ${enabledChannels().map((c) => c.id).join(', ') || 'aucun'}`);
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
  const dossier = await enrichir(await buildDossier(items[0].article, { memory: ctx.memory }), items[0].article);
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
    const mode = `${ch.manual ? 'kit Telegram, ' : ''}${needsValidation(controls, { id, ...ch }) ? 'validation' : 'automatique'}`;
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

// Comptes à mentionner et lieu à taguer : résolus une seule fois par article, réutilisés par tous les réseaux.
// Le lieu brut de l'IA est conservé ; `dossier.lieu` devient le lieu vérifié, ou null si rien de fiable.
async function enrichir(dossier, article = null) {
  dossier.lieuSource ??= dossier.lieu ?? null;
  // la rubrique porte la zone identitaire (« Périgord ») quand le champ département porte le nom administratif
  const source = { ...(dossier.lieuSource ?? {}), zone: dossier.rubrique ?? '' };
  // Nom du lieu, indépendant de tout identifiant Meta : ce qu'on tape pour taguer à la main (story, kit X),
  // et la commune que Threads et Bluesky acceptent telle quelle. Calculés aussi pour les dossiers déjà en file.
  dossier.lieuNom ??= lieuNomme(source);
  dossier.commune ??= String(dossier.lieuSource?.ville ?? '').trim() || null;
  if (dossier.comptes) return dossier;
  // l'image de l'article sert à faire confirmer par Meta l'existence d'un compte trouvé
  dossier.comptes = await resoudreComptes(dossier.entites ?? [], { image: article?.image ?? null, log: console.log });
  dossier.lieu = await resoudreLieu(source);
  return dossier;
}

// Nouveaux articles → dossier éditorial (une fois) → file, avec une heure prévue par canal
// forcedGuid : article relancé à la main, quel que soit son âge, publié dès que les règles le permettent
async function plan(items, { history, queue, memory, controls, now, forcedGuid }) {
  const fresh = items.filter((a) => a.guid === forcedGuid || now - a.date <= config.maxAgeHours * HOUR).sort((a, b) => a.date - b.date);
  for (const article of fresh) {
    const channels = enabledChannels().filter((c) => !hasPublished(history, article.guid, c.id) && !queue.some((q) => q.guid === article.guid && q.channel === c.id));
    if (!channels.length) continue;
    const dossier = queue.find((q) => q.guid === article.guid)?.dossier ?? (await buildDossier(article, { memory }));
    await enrichir(dossier, article);
    remember(memory, dossier, ed.networks, ed.memorySize);
    for (const channel of channels) {
      const lastPlannedAt = Math.max(0, ...queue.filter((q) => q.channel === channel.id && OPEN.includes(q.status)).map((q) => q.dueAt));
      const dueAt = article.guid === forcedGuid ? now : planDueAt({ now, lastAt: lastPublishedAt(history, channel.id), lastPlannedAt, channel, timeZone: TZ, nature: dossier.nature });
      const status = telegramEnabled() && needsValidation(controls, channel) ? 'awaiting' : 'pending';
      queue.push({ guid: article.guid, channel: channel.id, dueAt, status, attempts: 0, article, dossier, previewSent: false, nouveau: true });
      console.log(`Planifié ${channel.id} (${status}) : ${article.title} → ${paris(dueAt)} [${dossier.source}]`);
    }
  }
}

// Un aperçu Telegram par article (visuels + textes + boutons) ; réessayé au passage suivant en cas d'échec
async function sendPreviews({ queue, memory, history, now }) {
  // aperçus désactivés par défaut (publication automatique, décision du 15/09/2026)
  if (!telegramEnabled() || !config.telegram?.previews) return;
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
      const published = NETWORKS.filter((n) => hasPublished(history, guid, n));
      const text = buildPreviewText({ article, dossier, caption: pkg.caption, items, published, when: (ms) => when(ms, now) });
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

// La file toujours vraie : revalidée en entier à chaque passage, minute exacte fixée à l'avance
function ordonner({ queue, history, controls }) {
  const canaux = Object.fromEntries(enabledChannels().filter((c) => !isPaused(controls, c.id)).map((c) => [c.id, c]));
  const changements = ordonnerFile({ items: queue.filter((q) => q.status === 'pending'), historique: history, canaux, now: Date.now(), timeZone: TZ });
  for (const c of changements) console.log(`Heure recalculée ${c.channel} (${c.raison}) : « ${c.titre} » ${paris(c.avant)} → ${paris(c.apres)}`);
}

// Posts de ce passage : au plus un par réseau actif et non en pause, publiés dans l'ordre de leur
// minute de départ, fixée à l'avance par ordonnerFile. Le robot attend cette minute, puis publie.
async function execute({ history, queue, memory, controls, now }) {
  let failed = 0;
  const aPublier = enabledChannels()
    .filter((channel) => !isPaused(controls, channel.id))
    .map((channel) => ({ channel, item: queue.filter((q) => q.channel === channel.id && q.status === 'pending' && passageDe(q.dueAt) <= now).sort((a, b) => a.dueAt - b.dueAt)[0] }))
    .filter(({ item }) => item)
    .sort((a, b) => a.item.dueAt - b.item.dueAt);
  for (const { channel, item } of aPublier) {

    if (hasPublished(history, item.guid, channel.id)) {
      queue.splice(queue.indexOf(item), 1);
      continue;
    }
    // Plafond du jour atteint : l'article reste en réserve et passe au premier créneau de demain.
    // Rien n'est perdu — la file s'écoule d'elle-même sur les jours suivants.
    // filets de sécurité : la file est déjà en ordre (ordonnerFile), ces cas ne devraient plus survenir
    const dejaAujourdhui = countToday(history, channel.id, Date.now(), TZ);
    if (channel.maxPerDay && dejaAujourdhui >= channel.maxPerDay) {
      item.dueAt = planDueAt({ now: nextDay(Date.now(), channel.quietHours, TZ), channel, timeZone: TZ, nature: item.dossier?.nature });
      console.log(`Réserve ${channel.id} : ${dejaAujourdhui}/${channel.maxPerDay} publiés aujourd'hui, « ${item.article.title} » → ${paris(item.dueAt)}`);
      continue;
    }

    const later = recheck({ now: Date.now(), lastAt: lastPublishedAt(history, channel.id), channel, timeZone: TZ, nature: item.dossier?.nature });
    if (later) {
      item.dueAt = later;
      console.log(`Reporté ${channel.id} : ${item.article.title} → ${paris(later)}`);
      continue;
    }

    try {
      item.dossier ??= await buildDossier(item.article, { memory });
      await enrichir(item.dossier, item.article);
      const impl = CHANNELS[channel.id];
      const pkg = await impl.prepare(item.article, { dossier: item.dossier });
      // minute de départ fixée à l'avance par ordonnerFile : on l'attend, les visuels déjà prêts
      const attente = item.dueAt - Date.now();
      if (attente > 0) {
        console.log(`Départ ${channel.id} à ${paris(item.dueAt)} : attente de ${Math.round(attente / 1000)} s`);
        await new Promise((r) => setTimeout(r, attente));
      }
      const { mediaId, lien: lienPost = null } = await impl.publish(pkg, { channel });
      // format tiré, mentions, et aperçu réel : c'est ce qui rend la mesure comparable
      // d'un post à l'autre et ce que la page de pilotage affiche.
      history.push({
        guid: item.guid,
        channel: channel.id,
        at: new Date().toISOString(),
        mediaId,
        titre: item.article.title,
        lien: item.article.link,
        lienPost,
        format: pkg.mode ?? null,
        mention: (item.dossier.comptes?.[channel.id] ?? []).length > 0,
        apercu: await capturerApercu(pkg, channel.id).catch(() => null),
      });
      queue.splice(queue.indexOf(item), 1);
      await Promise.all([saveHistory(history), saveQueue(queue)]);
      console.log(`Publié ${channel.id} : ${mediaId}`);
      if (impl.publishedLabel) console.log(`Kit ${channel.id} envoyé`);
      else if (config.telegram?.publishedNotice) {
        // le lien part dans un bouton : une URL noyée dans un texte ne se clique pas d'un geste
        const bouton = lienPost
          ? { reply_markup: JSON.stringify({ inline_keyboard: [[{ text: `👁️ Voir sur ${NAMES[channel.id]}`, url: lienPost }]] }) }
          : undefined;
        await say(`📣 <b>Publié sur ${NAMES[channel.id]}</b>\n${esc(item.article.title)}`, bouton);
      }
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
      } else if (err.restriction || config.restriction.codes.includes(err.code) || config.restriction.subcodes.includes(err.subcode)) {
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

  // RELANCE=mots du titre : remet un ancien article dans la file (déclenchement manuel du workflow)
  const relance = process.env.RELANCE?.trim();
  if (relance) {
    const forced = matchArticle(items, relance);
    if (!forced) throw new Error(`Relance : aucun article du flux ne correspond à « ${relance} »`);
    ctx.forcedGuid = forced.guid;
    console.log(`Relance : ${forced.title} (article du ${paris(forced.date)})`);
  }

  let failed = 0;
  try {
    await handleTelegram(ctx);
    await plan(items, ctx);
    ordonner(ctx);
    await sendPreviews(ctx);
    await expire(ctx);
    prune(queue, ctx.now);
    failed = await execute(ctx);
    // ce qui a été reporté pendant le passage (échec, quota) retrouve aussitôt une heure valable
    ordonner(ctx);

    // Mesure : relevé des interactions, rapports dus, puis instantané pour la page de pilotage.
    // Lecture seule côté réseaux, et aucun réglage n'est modifié automatiquement.
    const mesures = await collecter({ log: console.log, maintenant: ctx.now });
    // abonnés de chaque compte, une fois par jour : suivi commencé le 18/09/2026
    await releverAbonnes({ now: ctx.now, log: console.log }).catch((e) => console.error(`Abonnés : ${e.message}`));
    await diffuser({ history, mesures, now: ctx.now });
    await verifierJetons({ now: ctx.now });
    // Lieux tagués sur la page Facebook, à la main ou par le robot : appris une fois, réutilisés partout.
    // Le support des vérifications est une image déjà publiée, donc publique et hébergée chez nous.
    if (!DRY_RUN) {
      const image = [...history].reverse().find((e) => e.apercu?.image)?.apercu.image ?? null;
      const appris = await recolterLieux({ now: ctx.now, image, log: console.log }).catch((e) => {
        console.error(`Récolte des lieux : ${e.message}`);
        return [];
      });
      if (appris.length) {
        const noms = appris.map((l) => l.nom);
        const liste = noms.slice(0, 15).join(', ') + (noms.length > 15 ? ` et ${noms.length - 15} autres` : '');
        await say(`📍 <b>${appris.length} lieu${appris.length > 1 ? 'x' : ''} appris</b> depuis la page Facebook\n${esc(liste)}\n\nDésormais tagué${appris.length > 1 ? 's' : ''} automatiquement sur Instagram et Facebook quand un article les nomme.`);
      }
    }
    await ecrirePilotage({ history, queue, controls, now: ctx.now });
    // page publique de l'équipe : données filtrées par liste blanche, déposées sur le site
    await publierPublic({ history, queue, controls, articles: items, maintenant: ctx.now }).catch((e) => console.error(`Page équipe : ${e.message}`));
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
