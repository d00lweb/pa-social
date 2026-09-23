import { loadJson, saveJson } from '../core/state.mjs';
import { dayKey } from '../core/scheduler.mjs';
import { config } from '../core/config.mjs';

// Ce que l'IA coûte réellement, relevé appel par appel dans state/couts.json.
// Aucune estimation : les jetons viennent de la réponse de l'API, le prix de la grille publique.
// La réflexion du modèle est facturée avec la sortie — c'est elle qu'un calcul « à la main » oublie.
const TZ = config.timezone;

// $ par million de jetons (grille publique Anthropic, relevée le 23/09/2026)
export const TARIFS = {
  'claude-opus-5': { entree: 5, sortie: 25 },
  'claude-opus-4-8': { entree: 5, sortie: 25 },
  'claude-sonnet-5': { entree: 2, sortie: 10 },
  'claude-haiku-4-5': { entree: 1, sortie: 5 },
};
export const TARIF_DEFAUT = TARIFS['claude-opus-5'];
// Lecture de cache : 10 % du prix d'entrée. Écriture : 125 %.
const CACHE_LU = 0.1;
const CACHE_ECRIT = 1.25;

export const jetons = (usage = {}) => ({
  entree: usage.input_tokens ?? 0,
  sortie: usage.output_tokens ?? 0,
  cacheLu: usage.cache_read_input_tokens ?? 0,
  cacheEcrit: usage.cache_creation_input_tokens ?? 0,
});

// L'API renvoie parfois un identifiant daté (« claude-haiku-4-5-20251001 ») : sans cette
// normalisation, le modèle est inconnu et se voit facturer au tarif Opus, cinq fois trop cher.
export const tarifDe = (modele) => TARIFS[modele] ?? TARIFS[String(modele ?? '').replace(/-\d{8}$/, '')] ?? TARIF_DEFAUT;

// Coût d'un appel, en dollars
export function cout(usage, modele) {
  const t = tarifDe(modele);
  const j = jetons(usage);
  return (j.entree * t.entree + j.cacheLu * t.entree * CACHE_LU + j.cacheEcrit * t.entree * CACHE_ECRIT + j.sortie * t.sortie) / 1e6;
}

// Ajoute un appel au relevé du jour, sans jamais faire échouer la publication
export async function enregistrer({ modele, usage, quoi = 'dossier', now = Date.now(), log = console.error } = {}) {
  try {
    const releve = await loadJson('couts.json', {});
    const jour = dayKey(now, TZ);
    const j = jetons(usage);
    const ligne = releve[jour] ?? { appels: 0, entree: 0, sortie: 0, cacheLu: 0, cacheEcrit: 0, cout: 0, parModele: {}, parUsage: {} };
    ligne.appels += 1;
    ligne.entree += j.entree;
    ligne.sortie += j.sortie;
    ligne.cacheLu += j.cacheLu;
    ligne.cacheEcrit += j.cacheEcrit;
    ligne.cout = Math.round((ligne.cout + cout(usage, modele)) * 1e6) / 1e6;
    ligne.parModele[modele] = (ligne.parModele[modele] ?? 0) + 1;
    ligne.parUsage[quoi] = (ligne.parUsage[quoi] ?? 0) + 1;
    releve[jour] = ligne;
    // un an de relevés suffit largement
    const jours = Object.keys(releve).sort();
    for (const vieux of jours.slice(0, Math.max(0, jours.length - 400))) delete releve[vieux];
    await saveJson('couts.json', releve);
    return ligne;
  } catch (e) {
    log(`   Coût IA non enregistré : ${e.message}`);
    return null;
  }
}

// Rédacteur injoignable (crédit épuisé, panne de l'API, clé refusée) : sans lui, les cinq réseaux
// publient une copie dégradée, sans accroche travaillée ni compte mentionné. Une alerte par jour,
// pas une par passage : la panne dure, le rappel ne doit pas devenir du bruit.
export async function signalerIaIndisponible(message, { now = Date.now(), envoyer } = {}) {
  const etat = await loadJson('ia.json', {});
  const jour = dayKey(now, TZ);
  if (etat.alerte === jour) return false;
  etat.alerte = jour;
  etat.dernierMessage = String(message ?? '').slice(0, 300);
  await saveJson('ia.json', etat);
  const manqueDeCredit = /credit balance|insufficient|quota/i.test(message ?? '');
  const texte = manqueDeCredit
    ? `🧠 <b>Plus de crédit sur la clé Claude</b>\nLe rédacteur ne tourne plus : les publications partent en version de secours, sans accroche travaillée, sans mention de compte.\n\nRecharger sur console.anthropic.com → Plans &amp; Billing. Les articles en attente repartiront ensuite tout seuls.`
    : `🧠 <b>Rédacteur IA injoignable</b>\n${String(message ?? '').slice(0, 200)}\n\nLes publications partent en version de secours en attendant.`;
  const envoi = envoyer ?? (await import('../channels/telegram.mjs')).alert;
  await envoi(texte);
  return true;
}

const vide = { appels: 0, entree: 0, sortie: 0, cout: 0 };
const cumul = (releve, jours) => jours.reduce((n, j) => {
  const l = releve[j];
  if (!l) return n;
  return { appels: n.appels + l.appels, entree: n.entree + l.entree, sortie: n.sortie + l.sortie, cout: n.cout + l.cout };
}, { ...vide });

const decale = (jour, n) => dayKey(Date.parse(`${jour}T12:00:00Z`) + n * 86400e3, 'UTC');

// Vue prête à afficher : aujourd'hui, 7 jours, mois en cours, projection et détail par jour
export function resume(releve = {}, now = Date.now(), timeZone = TZ) {
  const jour = dayKey(now, timeZone);
  const mois = jour.slice(0, 7);
  const tous = Object.keys(releve).sort();
  const septDerniers = Array.from({ length: 7 }, (_, i) => decale(jour, -i));
  const duMois = tous.filter((j) => j.startsWith(mois));

  const moisCumul = cumul(releve, duMois);
  const numeroJour = Number(jour.slice(8));
  const joursDuMois = new Date(Number(mois.slice(0, 4)), Number(mois.slice(5, 7)), 0).getDate();

  return {
    jour: { ...cumul(releve, [jour]), cle: jour },
    semaine: cumul(releve, septDerniers),
    mois: { ...moisCumul, cle: mois },
    // projection linéaire sur le mois entier, à partir de ce qui a été dépensé
    projection: numeroJour ? Math.round((moisCumul.cout / numeroJour) * joursDuMois * 100) / 100 : 0,
    moyenneAppel: moisCumul.appels ? Math.round((moisCumul.cout / moisCumul.appels) * 1e4) / 1e4 : 0,
    parModele: duMois.reduce((acc, j) => {
      for (const [m, n] of Object.entries(releve[j].parModele ?? {})) acc[m] = (acc[m] ?? 0) + n;
      return acc;
    }, {}),
    // 14 derniers jours, du plus ancien au plus récent, pour la courbe
    serie: Array.from({ length: 14 }, (_, i) => decale(jour, i - 13)).map((j) => [j, Math.round((releve[j]?.cout ?? 0) * 1e4) / 1e4]),
    depuis: tous[0] ?? null,
  };
}
