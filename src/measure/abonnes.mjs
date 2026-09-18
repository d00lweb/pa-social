import { loadJson, saveJson } from '../core/state.mjs';
import { dayKey } from '../core/scheduler.mjs';
import { config } from '../core/config.mjs';

// Abonnés de chaque compte, relevés une fois par jour dans state/abonnes.json.
// Suivi commencé le 18/09/2026, jour où la stratégie de publication a été posée : c'est la ligne de
// départ de toutes les comparaisons (Facebook 42 626, Instagram 10 146, Threads 1 144, Bluesky 1).
// X n'a pas d'API gratuite : ses abonnés sont saisis à la main (voir MANUELS). Lecture seule, rien n'est publié.
const V = () => process.env.GRAPH_VERSION || 'v23.0';

async function lire(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  return json;
}

export const LECTEURS = {
  instagram: async () => (await lire(`https://graph.facebook.com/${V()}/${process.env.IG_USER_ID}?fields=followers_count&access_token=${process.env.IG_TOKEN}`)).followers_count,
  facebook: async () => (await lire(`https://graph.facebook.com/${V()}/${process.env.FB_PAGE_ID}?fields=followers_count&access_token=${process.env.FB_TOKEN}`)).followers_count,
  bluesky: async () => (await lire(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(process.env.BLUESKY_HANDLE ?? '')}`)).followersCount,
  threads: async () => (await lire(`https://graph.threads.net/v1.0/${process.env.THREADS_USER_ID}/threads_insights?metric=followers_count&access_token=${process.env.THREADS_TOKEN}`)).data?.[0]?.total_value?.value,
};
// X n'a pas d'API gratuite : son nombre d'abonnés est saisi à la main, par la commande Telegram
// /x 2940, et rangé au jour de la saisie. Entre deux saisies, la dernière valeur connue fait foi.
export const MANUELS = ['x'];
export const SUIVIS = [...Object.keys(LECTEURS), ...MANUELS];

// « 2 940 », « 2940 », « 2.940 » → 2940 ; null si ce n'est pas un nombre plausible
export function lireNombre(texte) {
  const chiffres = String(texte ?? '').replace(/[\s.  ,']/g, '');
  if (!/^\d{1,9}$/.test(chiffres)) return null;
  return Number(chiffres);
}

export async function saisirAbonnes(id, n, { now = Date.now(), timeZone = config.timezone } = {}) {
  const releves = await loadJson('abonnes.json', {});
  const jour = dayKey(now, timeZone);
  const avant = valeurAu(releves, id, jour);
  releves[jour] = { ...releves[jour], [id]: n };
  await saveJson('abonnes.json', releves);
  return { jour, avant };
}

// Un relevé par jour, au premier passage de la journée. Un réseau illisible ce jour-là reste vide :
// les comparaisons prennent la valeur disponible la plus proche, rien n'est inventé.
// Une saisie manuelle faite plus tôt dans la journée ne dispense pas du relevé automatique.
export async function releverAbonnes({ now = Date.now(), log = console.log, timeZone = config.timezone } = {}) {
  const releves = await loadJson('abonnes.json', {});
  const jour = dayKey(now, timeZone);
  if (Object.keys(LECTEURS).every((id) => id in (releves[jour] ?? {}))) return releves;
  const ligne = {};
  for (const [id, lecteur] of Object.entries(LECTEURS)) {
    try {
      const n = await lecteur();
      ligne[id] = Number.isFinite(n) ? n : null;
    } catch (e) {
      ligne[id] = null;
      log(`   Abonnés ${id} : lecture impossible (${e.message})`);
    }
  }
  releves[jour] = { ...releves[jour], ...ligne };
  await saveJson('abonnes.json', releves);
  log(`Abonnés du ${jour} : ${Object.entries(ligne).map(([k, v]) => `${k} ${v ?? '?'}`).join(' · ')}`);
  return releves;
}

const jours = (releves, id) => Object.keys(releves).filter((j) => Number.isFinite(releves[j]?.[id])).sort();

// Valeur la plus récente disponible au plus tard ce jour-là
export function valeurAu(releves, id, jour) {
  const j = jours(releves, id).filter((x) => x <= jour).at(-1);
  return j ? { jour: j, n: releves[j][id] } : null;
}

// Première valeur disponible à partir de ce jour-là : le début d'une période
export function valeurDepuis(releves, id, jour) {
  const j = jours(releves, id).find((x) => x >= jour);
  return j ? { jour: j, n: releves[j][id] } : null;
}

// Évolution d'un compte entre deux jours (aaaa-mm-jj), ou null si la période n'a pas de relevé
export function evolution(releves, id, debut, fin) {
  const a = valeurDepuis(releves, id, debut);
  const b = valeurAu(releves, id, fin);
  if (!a || !b || a.jour > b.jour) return null;
  const gain = b.n - a.n;
  return { debut: a.n, fin: b.n, gain, pct: a.n ? Math.round((gain / a.n) * 1000) / 10 : null, depuis: a.jour, au: b.jour };
}

// Gain des 7 derniers jours pour chaque compte — ou depuis le début du suivi s'il a moins d'une semaine
export function resumeSemaine(releves, now = Date.now(), timeZone = config.timezone) {
  const aujourdhui = dayKey(now, timeZone);
  const ilYaSept = dayKey(now - 7 * 86400e3, timeZone);
  return Object.fromEntries(SUIVIS.map((id) => [id, evolution(releves, id, ilYaSept, aujourdhui)]));
}
