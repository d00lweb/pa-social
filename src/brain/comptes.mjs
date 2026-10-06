import { fold, choisir, nomExploitable } from './annuaire.mjs';
import { PREUVE, SEUILS_LOCAUX, surInstagram, formesLocales, sujetTouristique } from './decouverte.mjs';
import {
  TABLES, identifier, identifierCommune, territoireDe, threadsDe, jumeauxBluesky, porteLaCommune,
  variantesHandle, garderLesMeilleurs, AUDIENCE_MINIMALE,
} from './identite.mjs';
import { enParallele } from '../core/parallele.mjs';
import { fiche } from '../sources/wikidata.mjs';
import { handlesFromSite } from '../sources/site.mjs';
import { decrireInstagram, existeSurInstagram } from '../sources/instagram-public.mjs';
import { chercheActeurs, lireProfil } from '../sources/bsky-public.mjs';
import { surThreads } from '../sources/threads.mjs';
import { liensArticle } from '../sources/article.mjs';

export { variantesHandle, garderLesMeilleurs, AUDIENCE_MINIMALE };

// Comptes à taguer et à mentionner pour un article, réseau par réseau.
//
// Quatre échelons, du plus proche du sujet au plus large :
//   sujet       ce que l'article nomme : l'organisateur, le lieu, l'institution en cause ;
//   commune     la ville où cela se passe, et son office de tourisme pour un sujet de visiteurs ;
//   domaine     les références du sujet : le Moulin Rouge pour un French Cancan, un club de surf
//               de la commune pour un championnat, les vins de Bordeaux pour un sujet viticole ;
//   territoire  le Pays basque, le département — l'audience la plus large, donc la dernière servie.
//
// Chaque échelon est une suite de viviers, du plus précis au plus général ; la rotation joue à
// l'intérieur d'un vivier, pour ne pas mentionner deux fois de suite les mêmes comptes.

const RESEAUX = ['instagram', 'x', 'bluesky', 'threads', 'facebook'];

// Version des recherches mémorisées : une entrée d'une autre version est cherchée à nouveau. La 2
// ajoute la fiche Wikidata des communes, le site des comptes, Threads et les jumeaux Bluesky ; la 3,
// les sites probables d'une commune quand sa fiche ne donne rien (Hendaye, 06/10/2026).
const VERSION = 3;

// ── Les outils : tout ce qui interroge l'extérieur, remplaçable dans les tests ──

// Une lecture incertaine (quota, réseau) renvoie undefined et se signale au suivi : un résultat
// obtenu pendant une panne n'est jamais mémorisé comme une absence.
export function outilsReels(suivi = { incertain: false }) {
  const doute = () => { suivi.incertain = true; return undefined; };
  return {
    suivi,
    fiche: (nom, contexte, options) => fiche(nom, contexte, options).catch(() => null),
    site: (url) => handlesFromSite(url),
    decrire: (h) => decrireInstagram(h).catch(doute),
    existe: (h, image) => existeSurInstagram(h, image),
    profilBluesky: (h) => lireProfil(h).catch(doute),
    chercherBluesky: (q) => chercheActeurs(q).catch(() => []),
    surThreads: async (h) => {
      const present = await surThreads(h).catch(() => null);
      if (present === null) doute();
      return present === true;
    },
    liensArticle: (url) => liensArticle(url),
    avecSuivi() { return outilsReels({ incertain: false }); },
    async charger() { const { loadJson } = await import('../core/state.mjs'); return loadJson('comptes-appris.json', {}); },
    async enregistrer(v) { const { saveJson } = await import('../core/state.mjs'); return saveJson('comptes-appris.json', v); },
  };
}

// Ce qui est mémorisé d'un compte : de quoi le mentionner et le départager, rien de plus.
const resumer = (liste = []) => liste.map((c) => ({
  handle: c.handle, nom: c.nom ?? '', abonnes: c.abonnes ?? null, preuve: c.preuve ?? PREUVE.DECLAREE,
}));

// Recherche mémorisée : une commune, un domaine ou un département ne changent pas de compte d'une
// semaine à l'autre, et chaque recherche coûte des appels. Le doute ne se mémorise pas.
async function memorise(cle, { memoire, jours, maintenant, outils }, calcul) {
  const e = memoire.valeurs[cle];
  if (e?.v === VERSION && maintenant - Date.parse(e.cherche ?? 0) < jours * 86400e3) return { ...e, neuf: false };
  const suivis = outils.avecSuivi ? outils.avecSuivi() : outils;
  const resultat = await calcul(suivis);
  if (!suivis.suivi?.incertain) {
    memoire.valeurs[cle] = { v: VERSION, cherche: new Date(maintenant).toISOString(), ...resultat };
    memoire.modifiee = true;
  }
  return { ...resultat, neuf: true };
}

const vide = () => Object.fromEntries(RESEAUX.map((r) => [r, []]));
// `nomFixe` : le nom que l'article emploie, celui que Bluesky et Threads remplacent par la mention.
// Sinon le nom affiché du compte, à défaut celui de la commune, du domaine ou du vivier.
const entree = (c, { nomFixe, nom, ...extra }) => ({ nom: nomFixe ?? (c.nom || nom), handle: c.handle, abonnes: c.abonnes ?? null, preuve: c.preuve, ...extra });
const listeLog = (liste) => liste.map((c) => `@${c.handle}${c.abonnes ? ` (${c.abonnes.toLocaleString('fr-FR')})` : ''}`).join(' ');
const resume = (r) => RESEAUX.filter((n) => r[n]?.length).map((n) => `${n} ${listeLog(r[n])}`).join(' · ') || 'aucun compte';

// ── Sujet ──

// L'entité telle qu'on la cherche. Un lieu ou une organisation nommés d'un seul mot (« Le Cheverny »)
// se cherchent avec leur commune, comme ils s'écrivent souvent en pseudo (@lechevernylimoges) ;
// le nom écrit dans l'article reste celui que Bluesky et Threads remplacent par la mention.
export function aChercher(entite, commune = null) {
  const nom = String(entite.nom ?? '').trim();
  const avecCommune = commune && !fold(nom).includes(fold(commune)) && ['lieu', 'organisation'].includes(entite.type)
    && !nomExploitable(nom) ? `${nom} ${commune}` : nom;
  // un artiste se cherche sous son nom seul : ses formes propres (official, band…) le départagent
  const seul = entite.type === 'artiste' ? false : !nomExploitable(avecCommune);
  return { ...entite, nom: avecCommune, nomFixe: nom, seul };
}

async function comptesDesSujets(entites, { max, texte, liens, image, commune, outils, log }) {
  // Un nom d'un seul mot — « Belem », « Hermione » — ne permet aucune devinette : @lebelem est un
  // café bar. Il reste exploitable par la seule voie sûre, la fiche départagée par le contexte.
  const exploitables = entites.map((e) => aChercher(e, commune));
  const retenues = choisir(exploitables.map((e) => ({ ...e, entite: e.nom, handle: e.nom })), { max });
  const resultats = await enParallele(retenues, 3, (entite) => identifier(entite, { contexte: texte ?? '', liens, image, outils, log })
    .catch((e) => { log(`   Comptes « ${entite.nom} » : ${e.message}`); return null; }));
  const viviers = vide();
  retenues.forEach((entite, i) => {
    const r = resultats[i];
    log(`   Sujet « ${entite.nom} » (${entite.role}${entite.type ? `, ${entite.type}` : ''}) : ${r ? resume(r) : 'aucun compte'}`);
    if (!r) return;
    for (const reseau of RESEAUX) {
      for (const c of r[reseau] ?? []) viviers[reseau].push(entree(c, { nomFixe: entite.nomFixe ?? entite.nom, role: entite.role, echelon: 'sujet' }));
    }
  });
  return Object.fromEntries(RESEAUX.map((r) => [r, [viviers[r]]]));
}

// ── Commune ──
async function comptesDeLaCommune(ville, { departement, touristique, texte, ...ctx }) {
  const echelon = Object.fromEntries(RESEAUX.map((r) => [r, []]));
  if (!ville) return echelon;
  // La mairie parle de tout ce qui arrive sur son territoire ; l'office de tourisme ne parle
  // qu'aux visiteurs. Il n'est donc cherché que pour un sujet qui s'adresse à eux.
  const natures = touristique ? ['mairie', 'tourisme'] : ['mairie'];
  const trouves = vide();
  for (const nature of natures) {
    const e = await memorise(`commune:${nature}:${fold(ville)}`, { ...ctx, jours: 90 }, async (outils) => {
      const r = await identifierCommune(ville, { departement, nature, outils, log: () => {} });
      return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, resumer(v)]));
    });
    if (e.neuf) ctx.log(`   Commune « ${ville} » (${nature}) : ${resume(e)}`);
    for (const reseau of RESEAUX) {
      for (const c of e[reseau] ?? []) trouves[reseau].push(entree(c, { nom: ville, role: 'commune', echelon: 'commune', thematique: true, nature }));
    }
  }
  for (const reseau of RESEAUX) echelon[reseau].push(trouves[reseau]);
  // viviers de la table rattachés à la commune (La Rochelle), après ses comptes officiels
  for (const v of await viviersDeLaTable(texte, 'commune', { touristique, ...ctx })) {
    for (const reseau of RESEAUX) echelon[reseau].push(v[reseau] ?? []);
  }
  return echelon;
}

// ── Viviers de la table ──

// Comptes de référence d'un thème, inscrits à la main dans config/comptes.json : pas des comptes
// cités par l'article, mais des audiences déjà rassemblées autour du sujet.
// Trois garde-fous, parce qu'une mention hors sujet coûte plus qu'elle ne rapporte :
//  · la table est écrite à la main, chaque compte vérifié (nom, bio, abonnés) avant inscription ;
//  · le thème ne s'applique que si l'un de ses mots figure vraiment dans l'article, en mot entier ;
//  · un vivier ancré dans un lieu (`lieux`) ne vaut que là : les huîtres d'Arcachon pas à Marennes.
export function comptesThematiques(texte, reseau = 'instagram', table = TABLES.thematiques ?? {}) {
  const t = fold(texte ?? '');
  const mot = (m) => new RegExp(`(^|[^\\p{L}])${fold(m).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'u').test(t);
  const sortie = [];
  for (const [nom, theme] of Object.entries(table)) {
    if (!(theme.motsCles ?? []).some(mot)) continue;
    if (theme.lieux && !theme.lieux.some(mot)) continue;
    for (const handle of theme[reseau] ?? []) {
      sortie.push({ nom, handle, role: 'theme', thematique: true, echelon: theme.echelon ?? 'domaine', specifique: Boolean(theme.lieux), touristique: Boolean(theme.touristique) });
    }
  }
  return sortie;
}

// Comptes Instagram de la table, complétés sur Threads et Bluesky : un vivier écrit pour Instagram
// sert ainsi les autres réseaux, sans rien inscrire de plus. Le résultat est mémorisé.
async function etablir(handles, { bluesky = [], x = [], outils }) {
  const instagram = await enParallele([...new Set(handles.map((h) => h.toLowerCase()))], 4, async (h) => ({
    ...((await outils.decrire(h)) ?? { handle: h, nom: '', abonnes: null }), preuve: PREUVE.DECLAREE,
  }));
  const [threads, jumeaux] = await Promise.all([
    threadsDe(instagram, { outils }),
    bluesky.length ? [] : jumeauxBluesky(instagram, outils),
  ]);
  return {
    instagram: resumer(instagram),
    threads: resumer(threads),
    bluesky: bluesky.length ? bluesky.map((handle) => ({ handle, nom: '', abonnes: null, preuve: PREUVE.DECLAREE })) : resumer(jumeaux),
    x: x.map((handle) => ({ handle, nom: '', abonnes: null, preuve: PREUVE.DECLAREE })),
  };
}

async function viviersDeLaTable(texte, echelon, { touristique, ...ctx }) {
  const table = TABLES.thematiques ?? {};
  const noms = [...new Set(comptesThematiques(texte, 'instagram', table)
    .filter((c) => c.echelon === echelon && (!c.touristique || touristique))
    .map((c) => c.nom))];
  const sortie = [];
  for (const nom of noms) {
    const theme = table[nom];
    const source = [...(theme.instagram ?? []), ...(theme.bluesky ?? [])].join(',');
    const e = await memorise(`vivier:${fold(nom)}:${source}`, { ...ctx, jours: 30 }, (outils) => etablir(theme.instagram ?? [], { bluesky: theme.bluesky ?? [], outils }));
    const v = vide();
    for (const reseau of RESEAUX) {
      for (const c of e[reseau] ?? []) v[reseau].push(entree(c, { nom, role: 'theme', echelon, thematique: true }));
    }
    sortie.push({ ...v, specifique: Boolean(theme.lieux) });
  }
  return sortie;
}

// ── Domaine ──

// Une organisation, une mention. Le 25/09/2026, « environnement » proposait sur Bluesky @fne.asso.fr,
// @fneidf et @fne85 : la fédération et ses antennes d'Île-de-France et de Vendée, hors sujet sous un
// article de Gironde. Les pseudos d'une même famille commencent pareil ; on garde le plus suivi.
const racine = (h) => String(h ?? '').toLowerCase().split(/[._-]/)[0];
export function parFamille(comptes) {
  const gardes = [];
  for (const c of [...comptes].sort((a, b) => (b.abonnes ?? 0) - (a.abonnes ?? 0))) {
    const r = racine(c.handle);
    const parent = (g) => { const q = racine(g.handle); return r.length >= 3 && q.length >= 3 && (r.startsWith(q) || q.startsWith(r)); };
    if (!gardes.some(parent)) gardes.push(c);
  }
  return gardes;
}

// Plus de recherche nationale par domaine depuis le 06/10/2026. Elle trouvait des comptes réels mais
// étrangers à l'article : @fondationdupatrimoine sous 7 articles sur 14 parce qu'ils relevaient du
// patrimoine, @francemusique (radio classique) sous un festival disco. Ces comptes ne repartagent
// jamais une mention qui ne les concerne pas, et la répétition ressemble à du démarchage. Une
// référence nationale ne vient plus que de la table, inscrite à la main, ou de l'article qui la nomme.

// Le domaine dans la commune : @hossegorsurfclub pour un championnat de surf à Hossegor.
async function chercherLocal(ville, domaine, { outils }) {
  const trouves = await surInstagram(domaine, {
    decrire: outils.decrire, formes: () => formesLocales(ville, domaine), seuil: SEUILS_LOCAUX.instagram, local: true,
  });
  const instagram = trouves.filter((c) => porteLaCommune(ville, c)).slice(0, 2).map((c) => ({ ...c, preuve: PREUVE.CONSTRUITE }));
  const [threads, bluesky] = await Promise.all([threadsDe(instagram, { outils }), jumeauxBluesky(instagram, outils)]);
  return { instagram: resumer(instagram), threads: resumer(threads), bluesky: resumer(bluesky) };
}

async function comptesDuDomaine(domaines, { ville, texte, touristique, ...ctx }) {
  const echelon = Object.fromEntries(RESEAUX.map((r) => [r, []]));
  const ajouter = (v) => { for (const reseau of RESEAUX) echelon[reseau].push(v[reseau] ?? []); };
  const table = await viviersDeLaTable(texte, 'domaine', { touristique, ...ctx });
  const locaux = vide();
  for (const domaine of ville ? domaines.slice(0, 3) : []) {
    const e = await memorise(`locale:${fold(ville)}:${fold(domaine)}`, { ...ctx, jours: 90 }, (outils) => chercherLocal(ville, domaine, { outils }));
    if (e.neuf && (e.instagram ?? []).length) ctx.log(`   « ${domaine} » à ${ville} : ${resume(e)}`);
    for (const reseau of RESEAUX) for (const c of e[reseau] ?? []) locaux[reseau].push(entree(c, { nom: domaine, role: 'theme', echelon: 'domaine', thematique: true }));
  }
  // Du plus précis au plus général : un vivier ancré dans le lieu de l'article (le cognac à
  // Cognac), les comptes du domaine dans la commune, puis les viviers généraux de la table.
  for (const v of table.filter((t) => t.specifique)) ajouter(v);
  ajouter(locaux);
  for (const v of table.filter((t) => !t.specifique)) ajouter(v);
  return echelon;
}

// ── Territoire ──
async function comptesDuTerritoire(departement, { touristique, texte, ...ctx }) {
  const echelon = Object.fromEntries(RESEAUX.map((r) => [r, []]));
  const ajouter = (v) => { for (const reseau of RESEAUX) echelon[reseau].push(v[reseau] ?? []); };
  // le territoire vécu d'abord (Pays basque, Béarn), le département administratif ensuite
  for (const v of await viviersDeLaTable(texte, 'territoire', { touristique, ...ctx })) ajouter(v);
  const t = territoireDe(departement);
  if (!t) return echelon;
  const tourisme = [t.tourisme ?? []].flat();
  const e = await memorise(`territoire:${fold(departement)}:${[t.instagram, ...tourisme].join(',')}`, { ...ctx, jours: 90 }, async (outils) => ({
    conseil: await etablir([t.instagram].filter(Boolean), { bluesky: [t.bluesky].filter(Boolean), x: [t.x].filter(Boolean), outils }),
    tourisme: await etablir(tourisme, { outils }),
  }));
  // l'office de tourisme du département pour un sujet de visiteurs, le conseil départemental toujours
  const parts = touristique ? [e.tourisme, e.conseil] : [e.conseil];
  const v = vide();
  for (const part of parts) {
    for (const reseau of RESEAUX) for (const c of part?.[reseau] ?? []) v[reseau].push(entree(c, { nom: departement, role: 'territoire', echelon: 'territoire', thematique: true }));
  }
  ajouter(v);
  return echelon;
}

// ── Sélection ──

// Rotation : jamais les mêmes comptes deux fois de suite. Mentionner toujours les deux plus gros
// comptes d'un vivier, c'est parler chaque fois aux mêmes abonnés — ceux qui devaient suivre l'ont
// déjà fait. Priorité à ceux qu'on n'a jamais mentionnés, puis aux plus anciennement mentionnés ;
// à égalité, l'ordre du vivier tranche.
export function rotation(candidats, recents = [], combien = 3) {
  const vus = recents.map(fold);
  return candidats
    .map((c, ordre) => ({ c, ordre, vu: vus.lastIndexOf(fold(c.handle)) }))
    .sort((a, b) => a.vu - b.vu || a.ordre - b.ordre)
    .slice(0, Math.max(0, combien))
    .map((x) => x.c);
}

// La sélection, décidée le 06/10/2026 après trois semaines de mentions relues une à une.
//
// Ce qui fait gagner des abonnés, c'est d'être repartagé par un compte que l'article concerne : le
// festival, ses artistes, le lieu, le club, la ville. Eux sont tagués à chaque fois — c'est leur
// actualité, pas du démarchage. Les autres (un compte de thème, le département, le Pays basque)
// ne le sont qu'à la marge : un seul au plus, là où le tag est discret (posé sur l'image Instagram)
// ou laissé au choix (kit X), jamais sur Threads ni Bluesky où il s'écrit dans le texte, jamais
// deux articles de suite, et le moins récemment mentionné d'abord. Mieux vaut une place vide qu'un
// compte hors sujet : sous 7 articles sur 14, la Fondation du patrimoine finissait par lasser.
//
// Plafonds : Instagram accepte vingt tags par image ; cinq laissent la place au sujet entier (un
// festival et ses têtes d'affiche) et à la ville. Ailleurs la mention s'écrit : trois au plus.
export const MAX_MENTIONS = { instagram: 5, x: 3, bluesky: 3, threads: 3, facebook: 3 };
export const AUTRES_MAX = { instagram: 1, x: 1, bluesky: 0, threads: 0, facebook: 0 };

const parReseau = (valeur, reseau) => (Array.isArray(valeur) ? valeur : valeur?.[reseau] ?? []);

// recents : mentions passées, réseau par réseau, de la plus ancienne à la plus récente ;
// dernier : celles de l'article précédent, réseau par réseau.
export function selectionner(echelons, { max = MAX_MENTIONS, autres = AUTRES_MAX, recents = {}, dernier = {} } = {}) {
  const plan = vide();
  for (const reseau of RESEAUX) {
    const plafond = typeof max === 'number' ? max : (max[reseau] ?? 3);
    const liste = plan[reseau];
    const pris = (c) => liste.some((x) => fold(x.handle) === fold(c.handle));
    const ajouter = (candidats, jusqua) => { for (const c of candidats) if (liste.length < jusqua && !pris(c)) liste.push(c); };
    const precedent = new Set(parReseau(dernier, reseau).map(fold));
    const tous = (nom) => (echelons[nom]?.[reseau] ?? []).flat();
    const sujets = tous('sujet');
    // la ville, sauf si elle était déjà taguée à l'article précédent (trois articles bordelais d'affilée)
    const villes = tous('commune').filter((c) => !precedent.has(fold(c.handle)));

    // 1. le sujet, en gardant une place pour la ville quand elle a un compte ; 2. la ville ;
    // 3. le reste du sujet, s'il en reste
    ajouter(sujets, plafond - (villes.some((c) => !pris(c)) ? 1 : 0));
    ajouter(villes, plafond);
    ajouter(sujets, plafond);
    // 4. un compte non directement concerné, au plus, en rotation
    const place = Math.min(plafond - liste.length, autres[reseau] ?? 0);
    const candidats = [...tous('domaine'), ...tous('territoire')].filter((c) => !precedent.has(fold(c.handle)) && !pris(c));
    if (place > 0) liste.push(...rotation(candidats, parReseau(recents, reseau), place));
  }
  return plan;
}

// Les comptes à taguer, réseau par réseau. Un compte mentionné est notifié, et va voir : c'est le
// levier le plus efficace pour être découvert, tant qu'il est concerné.
export async function resoudreComptes(entites = [], {
  max = MAX_MENTIONS, image = null, texte = null, domaines = [], commune = null, departement = null, lien = null,
  categories = [], recents = {}, dernier = {}, log = () => {}, outils = outilsReels(), maintenant = Date.now(),
} = {}) {
  const valeurs = await outils.charger().catch(() => ({}));
  // les recherches d'une version précédente sont abandonnées : elles seront refaites
  const memoire = { valeurs: Object.fromEntries(Object.entries(valeurs).filter(([, e]) => e?.v === VERSION)), modifiee: Object.keys(valeurs).some((k) => valeurs[k]?.v !== VERSION) };
  const ctx = { outils, memoire, maintenant, log };
  const touristique = sujetTouristique(texte, categories);
  const liens = lien ? await outils.liensArticle(lien).catch(() => ({ sites: [], instagram: [] })) : { sites: [], instagram: [] };

  const echelons = {
    // le sujet entier : un festival et ses têtes d'affiche, le lieu qui l'accueille — cinq au plus
    sujet: await comptesDesSujets(entites, { max: 5, texte, liens, image, commune, outils, log }),
    commune: await comptesDeLaCommune(commune, { departement, touristique, texte, ...ctx }).catch((e) => { log(`   Commune : ${e.message}`); return {}; }),
    domaine: await comptesDuDomaine(domaines, { ville: commune, texte, touristique, ...ctx }).catch((e) => { log(`   Domaine : ${e.message}`); return {}; }),
    territoire: await comptesDuTerritoire(departement, { touristique, texte, ...ctx }).catch((e) => { log(`   Territoire : ${e.message}`); return {}; }),
  };
  if (memoire.modifiee) await outils.enregistrer(memoire.valeurs).catch((e) => log(`   Comptes appris non enregistrés : ${e.message}`));

  const plan = selectionner(echelons, { max, recents, dernier });
  for (const reseau of ['instagram', 'bluesky', 'threads', 'x']) {
    if (plan[reseau].length) log(`   Mentions ${reseau} : ${plan[reseau].map((c) => `@${c.handle} (${c.echelon})`).join(' · ')}`);
  }
  return plan;
}
