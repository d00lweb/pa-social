import { loadJson, saveJson } from '../core/state.mjs';
import { dayKey } from '../core/scheduler.mjs';
import { config } from '../core/config.mjs';
import { alerteBudget, alerteIa } from '../channels/messages.mjs';

// Ce que l'IA coûte réellement, relevé appel par appel dans state/couts.json.
// Aucune estimation : les jetons viennent de la réponse de l'API, le prix de la grille publique.
// L'entrée pèse le plus lourd (consigne et contexte, ~85 % d'un appel) : c'est elle qu'un calcul
// « à la main » sous-évalue. Pour le montant réellement facturé, voir scripts/couts-console.mjs.
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
    const ligne = releve[jour] ?? { appels: 0, entree: 0, sortie: 0, cacheLu: 0, cacheEcrit: 0, cout: 0, parModele: {}, parUsage: {}, parOrigine: {} };
    // Un appel du robot et un appel lancé depuis un poste n'ont pas le même sens : le premier fait
    // tourner le média, le second est une mise au point. Les confondre fausse la lecture du budget.
    ligne.parOrigine ??= {};
    const origine = process.env.GITHUB_ACTIONS ? 'robot' : 'local';
    const compteur = ligne.parOrigine[origine] ?? { appels: 0, cout: 0 };
    ligne.parOrigine[origine] = { appels: compteur.appels + 1, cout: Math.round((compteur.cout + cout(usage, modele)) * 1e6) / 1e6 };
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

// Budget mensuel : au-delà, le rédacteur n'est plus appelé. C'est un filet, pas un réglage courant —
// au rythme mesuré (un appel par article, 5,6 centimes), un mois ordinaire coûte moins de 2 $.
export const BUDGET_MOIS = config.budgetMensuelUSD ?? 3;
// Au plafond : prévenir seulement, ou couper le rédacteur. Par défaut on prévient — une publication
// dégradée coûte plus cher en qualité que quelques centimes de dépassement.
export const COUPER_AU_PLAFOND = config.couperAuPlafond === true;

// Facturation relevée dans state/couts-console.json : jour par jour quand elle vient de l'API,
// un total de mois quand elle a été saisie à la main depuis la console (comptes individuels).
export function factureDuMois(facture, mois) {
  if (facture?.jours) return Object.entries(facture.jours).filter(([j]) => j.startsWith(mois)).reduce((n, [, v]) => n + v, 0);
  if (facture?.mois === mois && Number.isFinite(facture.total)) return facture.total;
  return null;
}

export function budgetDuMois(releve = {}, now = Date.now(), timeZone = TZ, facture = null) {
  const mois = dayKey(now, timeZone).slice(0, 7);
  const lignes = Object.entries(releve).filter(([j]) => j.startsWith(mois)).map(([, l]) => l);
  // Le budget suit la dépense réelle : tout ce qui passe par la clé est facturé sur le même compte,
  // qu'il vienne du robot ou d'une mise au point. L'origine ne sert qu'à dire d'où vient la dépense.
  const arrondi = (n) => Math.round(n * 1e4) / 1e4;
  const compte = lignes.reduce((n, l) => n + (l.cout ?? 0), 0);
  // Le montant facturé par Anthropic (npm run couts:sync) couvre aussi les jours antérieurs au
  // relevé, mais peut avoir quelques heures de retard. On garde le plus élevé des deux : une alerte
  // de budget doit se tromper du côté prudent.
  const factureMois = factureDuMois(facture, mois);
  const depense = factureMois === null ? compte : Math.max(factureMois, compte);
  const robot = lignes.reduce((n, l) => n + (l.parOrigine?.robot?.cout ?? (l.parOrigine ? 0 : l.cout ?? 0)), 0);
  const local = lignes.reduce((n, l) => n + (l.parOrigine?.local?.cout ?? 0), 0);
  return { depense: arrondi(depense), robot: arrondi(robot), local: arrondi(local), budget: BUDGET_MOIS, part: BUDGET_MOIS ? depense / BUDGET_MOIS : 0, depasse: depense >= BUDGET_MOIS };
}

// Prévient à 70 % du budget, puis refuse d'appeler au-delà de 100 %. Une alerte par jour et par seuil.
export async function verifierBudget({ now = Date.now(), envoyer } = {}) {
  const releve = await loadJson('couts.json', {});
  const etat = budgetDuMois(releve, now, TZ, await loadJson('couts-console.json', null));
  const seuil = etat.depasse ? 'plafond' : etat.part >= 0.7 ? 'alerte' : null;
  if (!seuil) return etat;
  const memo = await loadJson('ia.json', {});
  const cle = `${seuil}-${dayKey(now, TZ)}`;
  if (memo.budget !== cle) {
    memo.budget = cle;
    await saveJson('ia.json', memo);
    const texte = alerteBudget(etat, { couperAuPlafond: COUPER_AU_PLAFOND });
    const envoi = envoyer ?? (await import('../channels/telegram.mjs')).alert;
    await envoi(texte).catch(() => {});
  }
  return etat;
}

// Point hebdomadaire sur la dépense : le dimanche, au premier passage après 19 h.
// C'est le suivi ordinaire ; les alertes de seuil, elles, signalent un écart.
export async function resumeHebdoCouts({ now = Date.now(), envoyer } = {}) {
  const jour = dayKey(now, TZ);
  if (jourSemaine(now) !== 'Sun' || localHeure(now) < 19) return null;
  const memo = await loadJson('ia.json', {});
  if (memo.resume === jour) return null;

  const releve = await loadJson('couts.json', {});
  const septJours = Array.from({ length: 7 }, (_, i) => dayKey(now - i * 86400e3, TZ));
  const semaine = septJours.reduce((n, j) => {
    const l = releve[j];
    if (!l) return n;
    const robot = l.parOrigine?.robot ?? (l.parOrigine ? { appels: 0, cout: 0 } : { appels: l.appels, cout: l.cout });
    return { appels: n.appels + robot.appels, cout: n.cout + robot.cout };
  }, { appels: 0, cout: 0 });
  const etat = budgetDuMois(releve, now, TZ, await loadJson('couts-console.json', null));
  memo.resume = jour;
  await saveJson('ia.json', memo);

  const euros = (n) => `${n.toFixed(2).replace('.', ',')} $`;
  const numeroJour = Number(jour.slice(8));
  const joursDuMois = new Date(Number(jour.slice(0, 4)), Number(jour.slice(5, 7)), 0).getDate();
  const projection = numeroJour ? (etat.depense / numeroJour) * joursDuMois : 0;
  const lignes = [
    '💶 <b>Rédacteur IA — la semaine</b>',
    semaine.appels ? `7 derniers jours : ${semaine.appels} article${semaine.appels > 1 ? 's' : ''} rédigé${semaine.appels > 1 ? 's' : ''}, ${euros(semaine.cout)}` : '7 derniers jours : aucun article rédigé',
    `Ce mois-ci : <b>${euros(etat.depense)}</b> sur ${euros(etat.budget)} (${Math.round(etat.part * 100)} %)`,
    `Fin de mois au rythme actuel : ${euros(projection)}`,
    etat.local ? `<i>Dont ${euros(etat.robot)} de publications et ${euros(etat.local)} de mises au point lancées depuis un poste.</i>` : '',
  ];
  const envoi = envoyer ?? (await import('../channels/telegram.mjs')).send;
  await envoi(lignes.filter(Boolean).join('\n')).catch(() => {});
  return { semaine, depense: etat.depense, projection };
}

const jourSemaine = (ms, timeZone = TZ) => new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' }).format(new Date(ms));

const localHeure = (ms, timeZone = TZ) => Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms)));

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
  const texte = alerteIa(message, { manqueDeCredit });
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
