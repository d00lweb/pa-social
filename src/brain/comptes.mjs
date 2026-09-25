import { fold, choisir, nomExploitable } from './annuaire.mjs';
import { PREUVE, SEUILS_LOCAUX, retenir, surInstagram, surBluesky, formesLocales, sujetTouristique } from './decouverte.mjs';
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
// ajoute la fiche Wikidata des communes, le site des comptes, Threads et les jumeaux Bluesky.
const VERSION = 2;

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
async function comptesDesSujets(entites, { max, texte, liens, image, outils, log }) {
  // Un nom d'un seul mot — « Belem », « Hermione » — ne permet aucune devinette : @lebelem est un
  // café bar. Il reste exploitable par la seule voie sûre, la fiche départagée par le contexte.
  const exploitables = entites.map((e) => ({ ...e, seul: !nomExploitable(e.nom) }));
  const retenues = choisir(exploitables.map((e) => ({ ...e, entite: e.nom, handle: e.nom })), { max });
  const resultats = await enParallele(retenues, 3, (entite) => identifier(entite, { contexte: texte ?? '', liens, image, outils, log })
    .catch((e) => { log(`   Comptes « ${entite.nom} » : ${e.message}`); return null; }));
  const viviers = vide();
  retenues.forEach((entite, i) => {
    const r = resultats[i];
    log(`   Sujet « ${entite.nom} » (${entite.role}) : ${r ? resume(r) : 'aucun compte'}`);
    if (!r) return;
    for (const reseau of RESEAUX) {
      for (const c of r[reseau] ?? []) viviers[reseau].push(entree(c, { nomFixe: entite.nom, role: entite.role, echelon: 'sujet' }));
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

// Une recherche par domaine. Instagram par pseudos plausibles, Bluesky par sa recherche d'acteurs,
// et le pont entre les deux : la recherche Bluesky donne le **nom** d'une organisation, son
// identité donne ses pseudos. Un pseudo fabriqué depuis le mot du domaine ne trouvera jamais
// l'Office français de la biodiversité (@ofbiodiversite) ni la LPO (@lpo_officiel).
async function chercherDomaine(domaine, { outils }) {
  const [devines, trouves] = await Promise.all([
    surInstagram(domaine, { decrire: outils.decrire, reference: true }),
    surBluesky(domaine, { chercher: outils.chercherBluesky, lireProfil: async (h) => (await outils.profilBluesky(h)) ?? null, reference: true }),
  ]);
  const ponts = [];
  for (const org of trouves.slice(0, 4)) {
    const r = await identifier({ nom: org.nom, role: 'theme', seul: !nomExploitable(org.nom) }, { outils }).catch(() => null);
    for (const c of r?.instagram ?? []) {
      if (c.abonnes && retenir(c, { domaine, reseau: 'instagram', reference: true }).garde) ponts.push(c);
    }
  }
  const instagram = parFamille([...devines, ...ponts].filter((c, i, t) => t.findIndex((x) => fold(x.handle) === fold(c.handle)) === i))
    .slice(0, 3).map((c) => ({ ...c, preuve: c.preuve ?? PREUVE.CONSTRUITE }));
  // Bluesky : les organisations trouvées, puis les jumeaux des comptes Instagram qui n'y sont pas déjà
  const dejaSurBluesky = (c) => trouves.some((b) => racine(b.handle) === racine(c.handle) || fold(b.nom) === fold(c.nom));
  const [threads, jumeaux] = await Promise.all([
    threadsDe(instagram, { outils }),
    jumeauxBluesky(instagram.filter((c) => !dejaSurBluesky(c)), outils, { plancher: SEUILS_LOCAUX.bluesky }),
  ]);
  return {
    instagram: resumer(instagram),
    bluesky: resumer(parFamille([...trouves.map((c) => ({ ...c, preuve: PREUVE.TROUVEE })), ...jumeaux])).slice(0, 3),
    threads: resumer(threads),
  };
}

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
  const nationaux = vide();
  for (const domaine of domaines.slice(0, 3)) {
    if (ville) {
      const e = await memorise(`locale:${fold(ville)}:${fold(domaine)}`, { ...ctx, jours: 90 }, (outils) => chercherLocal(ville, domaine, { outils }));
      if (e.neuf && (e.instagram ?? []).length) ctx.log(`   « ${domaine} » à ${ville} : ${resume(e)}`);
      for (const reseau of RESEAUX) for (const c of e[reseau] ?? []) locaux[reseau].push(entree(c, { nom: domaine, role: 'theme', echelon: 'domaine', thematique: true }));
    }
    const e = await memorise(`domaine:${fold(domaine)}`, { ...ctx, jours: 30 }, (outils) => chercherDomaine(domaine, { outils }));
    if (e.neuf) ctx.log(`   Domaine « ${domaine} » : ${resume(e)}`);
    for (const reseau of RESEAUX) for (const c of e[reseau] ?? []) nationaux[reseau].push(entree(c, { nom: domaine, role: 'theme', echelon: 'domaine', thematique: true }));
  }
  // Du plus précis au plus général : un vivier ancré dans le lieu de l'article (le cognac à
  // Cognac), les comptes du domaine dans la commune, les viviers de la table, la découverte.
  for (const v of table.filter((t) => t.specifique)) ajouter(v);
  ajouter(locaux);
  for (const v of table.filter((t) => !t.specifique)) ajouter(v);
  ajouter(nationaux);
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

// L'équilibre, déclaré en tours. Le sujet prend ce qu'il lui faut ; la commune puis le domaine
// reçoivent une place chacun ; s'il en reste, la commune puis le domaine complètent ; le
// territoire ne vient qu'en dernier. Ainsi le French Cancan de Bordeaux tague le festival, la
// ville et le Moulin Rouge ; l'escale de l'Hermione à Bayonne tague le navire, @bayonnemaville
// et @visitbayonne avant tout compte du Pays basque ou du département.
export const TOURS = [
  ['sujet', Infinity],
  ['commune', 1],
  ['domaine', 1],
  ['commune', Infinity],
  ['domaine', Infinity],
  ['territoire', Infinity],
];

export function selectionner(echelons, { max = 3, recents = [] } = {}) {
  const plan = vide();
  for (const reseau of RESEAUX) {
    const liste = plan[reseau];
    for (const [nom, combien] of TOURS) {
      let pris = 0;
      for (const vivier of echelons[nom]?.[reseau] ?? []) {
        const place = Math.min(max - liste.length, combien - pris);
        if (place <= 0) break;
        const libres = vivier.filter((c) => !liste.some((x) => fold(x.handle) === fold(c.handle)));
        // le sujet n'est pas en rotation : c'est lui que le lecteur cherche, chaque fois
        const choisis = nom === 'sujet' ? libres.slice(0, place) : rotation(libres, recents, place);
        liste.push(...choisis);
        pris += choisis.length;
      }
    }
  }
  return plan;
}

// Trois mentions au plus par réseau : c'est le levier le plus efficace pour être découvert — un
// compte mentionné est notifié, et va voir. Au-delà, la publication ressemble à du démarchage.
export async function resoudreComptes(entites = [], {
  max = 3, image = null, texte = null, domaines = [], commune = null, departement = null, lien = null,
  categories = [], recents = [], log = () => {}, outils = outilsReels(), maintenant = Date.now(),
} = {}) {
  const valeurs = await outils.charger().catch(() => ({}));
  // les recherches d'une version précédente sont abandonnées : elles seront refaites
  const memoire = { valeurs: Object.fromEntries(Object.entries(valeurs).filter(([, e]) => e?.v === VERSION)), modifiee: Object.keys(valeurs).some((k) => valeurs[k]?.v !== VERSION) };
  const ctx = { outils, memoire, maintenant, log };
  const touristique = sujetTouristique(texte, categories);
  const liens = lien ? await outils.liensArticle(lien).catch(() => ({ sites: [], instagram: [] })) : { sites: [], instagram: [] };

  const echelons = {
    sujet: await comptesDesSujets(entites, { max, texte, liens, image, outils, log }),
    commune: await comptesDeLaCommune(commune, { departement, touristique, texte, ...ctx }).catch((e) => { log(`   Commune : ${e.message}`); return {}; }),
    domaine: await comptesDuDomaine(domaines, { ville: commune, texte, touristique, ...ctx }).catch((e) => { log(`   Domaine : ${e.message}`); return {}; }),
    territoire: await comptesDuTerritoire(departement, { touristique, texte, ...ctx }).catch((e) => { log(`   Territoire : ${e.message}`); return {}; }),
  };
  if (memoire.modifiee) await outils.enregistrer(memoire.valeurs).catch((e) => log(`   Comptes appris non enregistrés : ${e.message}`));

  const plan = selectionner(echelons, { max, recents });
  for (const reseau of ['instagram', 'bluesky', 'threads', 'x']) {
    if (plan[reseau].length) log(`   Mentions ${reseau} : ${plan[reseau].map((c) => `@${c.handle} (${c.echelon})`).join(' · ')}`);
  }
  return plan;
}
