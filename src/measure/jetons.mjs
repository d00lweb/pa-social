import { loadJson, saveJson } from '../core/state.mjs';
import { dayKey } from '../core/scheduler.mjs';
import { alert } from '../channels/telegram.mjs';
import { alerteJeton, alerteFacebookInvisible } from '../channels/messages.mjs';
import { config } from '../core/config.mjs';
import { sansSecret } from '../core/errors.mjs';

// Surveillance des jetons et des connexions : ce qui peut être prolongé automatiquement l'est, le
// reste est annoncé bien avant l'échéance. Un jeton qui meurt sans prévenir, c'est le robot muet du
// jour au lendemain. Le résultat (state/jetons.json) est ce que le dashboard affiche : jamais une
// valeur de jeton, seulement son état, son échéance et ses droits.
const TZ = config.timezone;
const JOUR = 86400e3;

// Version du relevé : un état d'une version antérieure est refait tout de suite, sans attendre demain
export const VERSION_JETONS = 2;

const PREVENIR_A = { meta: 30, threads: 15 }; // jours restants déclenchant l'alerte

const jours = (iso, maintenant) => Math.round((new Date(iso).getTime() - maintenant) / JOUR);
const enIso = (secondes) => new Date(secondes * 1000).toISOString();

// Ce que dit la réponse de debug_token, chez Meta comme chez Threads. Un jeton peut mourir bien
// avant son échéance (mot de passe changé, session coupée par Meta) : l'échéance connue n'a alors
// plus aucun sens, c'est l'invalidité qu'il faut annoncer.
// Deux échéances possibles : celle du jeton (expires_at) et celle de l'accès aux données
// (data_access_expires_at) ; 0 veut dire « aucune ». Le 22/11/2026, l'état annonçait depuis deux
// mois « 86 jours restants, échéance au 16/12 » pour un jeton de Page refait le 23/09, qui n'a
// plus aucune échéance : la réponse sans date était prise pour une réponse vide, et l'ancien état
// restait affiché tel quel.
function etatDebug(json, connu, maintenant, renouvellement) {
  if (json?.error || json?.data?.is_valid === false) {
    const message = sansSecret(json?.error?.message ?? json?.data?.error?.message ?? 'jeton refusé');
    return { expireLe: connu?.expireLe ?? null, restant: 0, renouvellement: 'à refaire', invalide: true, valide: false, message };
  }
  const d = json?.data;
  if (!d) return null;
  const details = { valide: d.is_valid === true, type: d.type ?? null, droits: Array.isArray(d.scopes) ? d.scopes : [], emisLe: Number(d.issued_at) > 0 ? enIso(d.issued_at) : null };
  const fins = [d.expires_at, d.data_access_expires_at].map(Number).filter((s) => s > 0);
  if (!fins.length) {
    // aucune date : seul un jeton déclaré valide est « sans échéance », sinon on ne sait rien
    return d.is_valid === true ? { expireLe: null, restant: null, renouvellement: 'aucun', ...details } : null;
  }
  const expireLe = enIso(Math.min(...fins));
  return { expireLe, restant: jours(expireLe, maintenant), renouvellement, ...details };
}

export const etatMeta = (json, connu, maintenant) => etatDebug(json, connu?.meta, maintenant, 'manuel');
// Threads : prolongé tous les 15 jours par le passage d'entretien (maintenance.yml)
export const etatThreads = (json, connu, maintenant) => etatDebug(json, connu?.threads, maintenant, 'automatique');

// Ce qu'on savait hier, avec un nombre de jours recalculé : un « 86 jours » figé ment chaque jour un peu plus
function repris(jeton, maintenant) {
  if (!jeton) return null;
  return { ...jeton, restant: jeton.invalide ? 0 : jeton.expireLe ? jours(jeton.expireLe, maintenant) : null };
}

async function lire(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  return { ok: res.ok, json: await res.json().catch(() => ({})) };
}

async function meta(maintenant, connu) {
  const token = process.env.FB_TOKEN || process.env.IG_TOKEN;
  if (!token) return null;
  const V = process.env.GRAPH_VERSION || 'v23.0';
  try {
    const { json } = await lire(`https://graph.facebook.com/${V}/debug_token?input_token=${token}&access_token=${token}`);
    return etatMeta(json, connu, maintenant);
  } catch {
    return null;
  }
}

async function threads(maintenant, connu) {
  const token = process.env.THREADS_TOKEN;
  if (!token) return null;
  try {
    const { json } = await lire(`https://graph.threads.net/v1.0/debug_token?input_token=${token}&access_token=${token}`);
    const etat = json?.error ? null : etatThreads(json, connu, maintenant);
    if (etat) return etat;
    // debug_token muet ou en erreur : le profil dit au moins si le jeton est encore accepté
    const profil = await lire(`https://graph.threads.net/v1.0/me?fields=id&access_token=${token}`);
    if (!profil.ok) return { expireLe: null, restant: 0, renouvellement: 'à refaire', invalide: true, valide: false, message: 'jeton refusé par Threads' };
    const connue = connu?.threads?.expireLe && Date.parse(connu.threads.expireLe) > maintenant ? connu.threads.expireLe : null;
    return { expireLe: connue, restant: connue ? jours(connue, maintenant) : null, renouvellement: 'automatique', valide: true };
  } catch {
    return null;
  }
}

// Des publications que personne ne voit. Le 22/11/2026 : 88 publications Facebook à 0 vue depuis
// deux mois, parce que l'application Meta était restée en mode développement — ce qu'elle publie
// n'est alors montré qu'à ses administrateurs. Les likes à zéro ne le disaient pas : il faut les vues.
export const SANS_VUE_MIN = 5;
export function facebookSansVue(mesures, min = SANS_VUE_MIN) {
  const parPost = new Map();
  for (const m of mesures ?? []) {
    if (m.channel !== 'facebook' || m.introuvable || typeof m.vues !== 'number') continue;
    const vu = parPost.get(m.guid);
    if (!vu || m.jalon > vu.jalon) parPost.set(m.guid, m);
  }
  const derniers = [...parPost.values()].sort((a, b) => Date.parse(b.publieLe) - Date.parse(a.publieLe)).slice(0, min);
  if (derniers.length < min) return null; // pas assez de relevés pour juger
  const vues = derniers.reduce((n, m) => n + m.vues, 0);
  return { publications: derniers.length, vues, invisible: vues === 0, depuis: derniers.at(-1).publieLe };
}

const semaineDe = (now) => dayKey(now, TZ).slice(0, 7) + '-S' + Math.ceil(new Date(now).getDate() / 7);

const heureLocale = (now) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(now)));
// Les alertes de jeton et de visibilité ne réveillent personne : elles partent entre 8 h et 21 h.
// La vérification du jour se fait au premier passage après minuit ; l'alerte attend le matin.
export const heureDAlerte = (now) => heureLocale(now) >= 8 && heureLocale(now) < 21;

// Une vérification des jetons par jour suffit ; la visibilité Facebook suit les relevés à chaque
// passage. Le résultat est gardé dans state/jetons.json, lu par le pilotage et par le dashboard.
export async function verifier({ now = Date.now(), log = console.log, mesures = null } = {}) {
  const connu = await loadJson('jetons.json', null);
  // une vérification par jour, sauf tant qu'un jeton est refusé (on veut voir tout de suite qu'il est
  // réparé) et sauf si l'état a été écrit par une version antérieure
  const enPanne = Object.values(connu ?? {}).some((v) => v && typeof v === 'object' && v.invalide);
  const aJour = connu?.v === VERSION_JETONS;
  const duJour = aJour && !enPanne && connu?.verifieLe && dayKey(new Date(connu.verifieLe).getTime(), TZ) === dayKey(now, TZ);
  const visibilite = facebookSansVue(mesures ?? (await loadJson('mesures.json', []))) ?? connu?.facebook ?? null;

  const etat = duJour
    ? { ...connu, facebook: visibilite, alertes: { ...(connu.alertes ?? {}) } }
    : {
      v: VERSION_JETONS,
      verifieLe: new Date(now).toISOString(),
      meta: (await meta(now, connu)) ?? repris(connu?.meta, now),
      threads: (await threads(now, connu)) ?? repris(connu?.threads, now),
      facebook: visibilite,
      alertes: { ...(connu?.alertes ?? {}) },
    };
  const inchange = duJour && JSON.stringify(etat) === JSON.stringify(connu);
  if (!heureDAlerte(now)) {
    if (!inchange) await saveJson('jetons.json', etat);
    return etat;
  }

  const semaine = semaineDe(now);
  for (const [nom, seuil] of Object.entries(PREVENIR_A)) {
    const jeton = etat[nom];
    if (!jeton || jeton.restant === null || jeton.restant === undefined || jeton.restant > seuil) continue;
    // une seule alerte par jeton et par semaine, pour ne pas devenir du bruit
    if (etat.alertes[nom] === semaine) continue;
    etat.alertes[nom] = semaine;
    await alert(alerteJeton(nom, jeton), { type: 'jeton-echeance' }).catch(() => {});
    log(`Alerte jeton ${nom} : ${jeton.restant} jours restants.`);
  }
  if (etat.facebook?.invisible && etat.alertes.facebook !== semaine) {
    etat.alertes.facebook = semaine;
    await alert(alerteFacebookInvisible(etat.facebook.publications), { type: 'facebook-invisible' }).catch(() => {});
    log(`Alerte Facebook : aucune vue sur les ${etat.facebook.publications} dernières publications mesurées.`);
  }

  if (!(duJour && JSON.stringify(etat) === JSON.stringify(connu))) await saveJson('jetons.json', etat);
  return etat;
}
