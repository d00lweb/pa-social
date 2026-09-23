import { loadJson, saveJson } from '../core/state.mjs';
import { dayKey } from '../core/scheduler.mjs';
import { alert } from '../channels/telegram.mjs';
import { config } from '../core/config.mjs';

// Surveillance des jetons : ce qui peut être prolongé automatiquement l'est, le reste est annoncé
// bien avant l'échéance. Un jeton qui meurt sans prévenir, c'est le robot muet du jour au lendemain.
const TZ = config.timezone;
const JOUR = 86400e3;

const PREVENIR_A = { meta: 30, threads: 15 }; // jours restants déclenchant l'alerte

const jours = (iso, maintenant) => Math.round((new Date(iso).getTime() - maintenant) / JOUR);

// Ce que dit la réponse de debug_token. Un jeton peut mourir bien avant son échéance (mot de passe
// changé, session coupée par Meta) : l'échéance connue n'a alors plus aucun sens, c'est l'invalidité
// qu'il faut annoncer — sans quoi le pilotage affiche « 86 jours restants » sur un jeton mort.
export function etatMeta(json, connu, maintenant) {
  if (json?.error || json?.data?.is_valid === false) {
    const message = json?.error?.message ?? json?.data?.error?.message ?? 'jeton refusé';
    return { expireLe: connu?.meta?.expireLe ?? null, restant: 0, renouvellement: 'à refaire', invalide: true, message };
  }
  const fin = json?.data?.data_access_expires_at;
  if (!fin) return null;
  const expireLe = new Date(fin * 1000).toISOString();
  return { expireLe, restant: jours(expireLe, maintenant), renouvellement: 'manuel' };
}

// Meta : « n'expire jamais », mais l'accès aux données s'arrête à une date fixe qu'aucune API ne prolonge
async function meta(maintenant, connu) {
  const token = process.env.FB_TOKEN || process.env.IG_TOKEN;
  if (!token) return null;
  const V = process.env.GRAPH_VERSION || 'v23.0';
  try {
    const res = await fetch(`https://graph.facebook.com/${V}/debug_token?input_token=${token}&access_token=${token}`);
    const json = await res.json().catch(() => ({}));
    return etatMeta(json, connu, maintenant);
  } catch {
    return null;
  }
}

// Threads : prolongeable par API, mais la nouvelle valeur doit être enregistrée à la main
// (le dépôt est public, le secret ne peut pas être réécrit depuis une exécution).
async function threads(maintenant, connu) {
  if (!process.env.THREADS_TOKEN) return null;
  try {
    const res = await fetch(`https://graph.threads.net/v1.0/me?fields=id&access_token=${process.env.THREADS_TOKEN}`);
    if (!res.ok) return { expireLe: null, restant: 0, renouvellement: 'à refaire', invalide: true, message: 'jeton refusé par Threads' };
  } catch {
    return connu?.threads ?? null;
  }
  // l'échéance connue vient de la dernière mise en service ; à défaut, 60 jours à partir d'aujourd'hui
  const expireLe = connu?.threads?.expireLe ?? new Date(maintenant + 60 * JOUR).toISOString();
  return { expireLe, restant: jours(expireLe, maintenant), renouvellement: 'commande npm run threads:refresh' };
}

// Une vérification par jour suffit : le résultat est gardé dans state/jetons.json, lu par le pilotage
export async function verifier({ now = Date.now(), log = console.log } = {}) {
  const connu = await loadJson('jetons.json', null);
  // une vérification par jour, sauf tant qu'un jeton est refusé : on veut voir tout de suite qu'il est réparé
  const enPanne = Object.values(connu ?? {}).some((v) => v && typeof v === 'object' && v.invalide);
  if (!enPanne && connu?.verifieLe && dayKey(new Date(connu.verifieLe).getTime(), TZ) === dayKey(now, TZ)) return connu;

  const etat = {
    verifieLe: new Date(now).toISOString(),
    meta: (await meta(now, connu)) ?? connu?.meta ?? null,
    threads: (await threads(now, connu)) ?? null,
    alertes: connu?.alertes ?? {},
  };

  for (const [nom, seuil] of Object.entries(PREVENIR_A)) {
    const jeton = etat[nom];
    if (!jeton || jeton.restant === null || jeton.restant > seuil) continue;
    // une seule alerte par jeton et par semaine, pour ne pas devenir du bruit
    const semaine = dayKey(now, TZ).slice(0, 7) + '-S' + Math.ceil(new Date(now).getDate() / 7);
    if (etat.alertes[nom] === semaine) continue;
    etat.alertes[nom] = semaine;
    const quoi = nom === 'meta'
      ? `Jeton Meta (Facebook + Instagram) : accès aux données jusqu'au ${new Date(jeton.expireLe).toLocaleDateString('fr-FR')}.\nÀ refaire dans les paramètres Meta, ou passer à un jeton d'utilisateur système, qui n'expire jamais.`
      : `Jeton Threads : ${jeton.restant} jours restants.\nLance « npm run threads:refresh -- --ecrire » puis « gh secret set SOCIAL < .env » depuis Git Bash.`;
    await alert(`🔑 ${quoi}`).catch(() => {});
    log(`Alerte jeton ${nom} : ${jeton.restant} jours restants.`);
  }

  await saveJson('jetons.json', etat);
  return etat;
}
