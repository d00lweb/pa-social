import { readFileSync } from 'node:fs';
import { fromRoot } from '../core/config.mjs';
import { enParallele } from '../core/parallele.mjs';
import { fold, motsCles, correspond, suspect, couverture, CIVIQUES } from './annuaire.mjs';
import { PREUVE, parleDu, retenir, semblFrancais, surInstagram, formesCommune, SEUILS_LOCAUX } from './decouverte.mjs';
import { domaine, libelle } from '../sources/site.mjs';

export { couverture };

// Identité : de « Musée d'Aquitaine » ou « Bergerac » à leurs comptes réels, réseau par réseau.
//
// Chaque source est interrogée de la plus sûre à la moins sûre, et la première qui répond clôt la
// recherche. Ce qui compte n'est pas qu'un pseudo existe — Meta le confirme pour n'importe quel
// homonyme — mais qu'on sache **qui** le tient. D'où l'ordre :
//  1. ce que l'entité déclare : table vérifiée, fiche Wikidata, liens de son site officiel ;
//  2. ce que le compte déclare : un compte dont le site web est celui de l'entité est le sien ;
//  3. ce qu'on construit : le nom porté par le domaine du site, puis les formes bâties sur le nom.

// Tables vérifiées à la main : la seule source qui prouve l'identité sans rien demander à personne.
export const TABLES = JSON.parse(readFileSync(fromRoot('config/comptes.json'), 'utf8'));
const { institutions = {}, territoires = {} } = TABLES;

const PREFIXE = /^(?:le\s+)?(?:département|departement|conseil départemental|conseil departemental)\s+(?:de\s+la\s+|de\s+l[’']|de\s+|des\s+|du\s+|d[’'])?/i;
const dansTable = (table, nom) => {
  const cle = fold(String(nom ?? '').replace(PREFIXE, '').trim());
  const trouvee = Object.keys(table).find((k) => fold(k) === cle);
  return trouvee ? table[trouvee] : null;
};
export const depuisTable = (nom) => dansTable(institutions, nom) ?? dansTable(territoires, nom);
export const territoireDe = (departement) => (departement ? dansTable(territoires, departement) : null);

export const VIDE = { insta: [], x: [], facebook: [], bluesky: [], threads: [] };
const compact = (s) => fold(s).replace(/[^a-z0-9]+/g, '');
const uniques = (liste) => [...new Set(liste.filter(Boolean).map((h) => String(h).toLowerCase()))];

// Un pseudo porte le nom d'une entité s'il s'écrit avec ses mots, à « officiel » ou « France » près :
// @ultratraildepons_officiel pour « Ultra Trail de Pons », @moulinrougeofficiel pour « Moulin Rouge ».
// Et il les porte **tous** : @en_nouvelle_aquitaine s'écrit presque entièrement avec « TER
// Nouvelle-Aquitaine », mais sans « TER » c'est la marque touristique de la région, pas le train.
export const porteLeNom = (handle, nom) => couverture(handle, `${nom} officiel official off fr france`) >= 0.8
  && motsCles(nom).every((m) => compact(handle).includes(m));

// Tous les comptes Instagram des tables. Un compte déjà vérifié peut être celui d'une entité que
// l'article nomme autrement : « TER Nouvelle-Aquitaine » est @sncf.ter.nouvelle.aquitaine, inscrit
// dans le vivier du train. Sans ce rapprochement, un compte personnel @ternouvelleaquitaine, dont
// on ignore qui le tient, était retenu à sa place le 25/09/2026.
const COMPTES_DE_LA_TABLE = uniques([
  ...Object.values(institutions).flatMap((e) => [e.instagram, ...(e.lies ?? [])]),
  ...Object.values(territoires).flatMap((e) => [e.instagram, ...[e.tourisme ?? []].flat()]),
  ...Object.values(TABLES.thematiques ?? {}).flatMap((e) => e.instagram ?? []),
]);

// Le site officiel d'une entité parmi les liens de l'article : celui dont l'adresse épelle son nom.
// ultratraildepons.fr pour « Ultra Trail de Pons » ; jamais inrae.fr pour une étude sur les levures.
export function siteCite(nom, sites = []) {
  let meilleur = null;
  for (const url of sites) {
    const l = libelle(url);
    if (!l || compact(l).length < 5) continue;
    const c = couverture(l, nom);
    if (c >= 0.8 && (!meilleur || c > meilleur.c)) meilleur = { url, c };
  }
  if (!meilleur) return null;
  try {
    return `${new URL(meilleur.url).origin}/`;
  } catch {
    return null;
  }
}

// Mots qui désignent en propre : ni les petits mots, ni ceux qu'une institution ajoute à son nom
const motsPropres = (nom) => motsCles(nom).filter((m) => m.length >= 4 && !CIVIQUES.has(m));

// Le même organisme sous deux noms d'affichage : « Ville de Bergerac » et « Ville de Bergerac »,
// « visitbordeaux » et « Visit Bordeaux ». Un mot propre de l'un doit se lire dans l'autre.
export function memeEntite(a, b) {
  const [ca, cb] = [compact(a), compact(b)];
  return motsPropres(a).some((m) => cb.includes(m)) || motsPropres(b).some((m) => ca.includes(m));
}

// ── Formes bâties sur le nom exact ──

// Pseudos dérivés du nom exact. Chacun est ensuite décrit par Meta, ou confirmé par un essai
// d'identification : un commerce absent de Wikidata devient ainsi trouvable, sans rien inventer.
//
// 25/09/2026 : « Ultra Trail de Pons » n'a produit que ultratrailpons, ultra_trail_pons et
// ultra.trail.pons. Le compte réel est @ultratraildepons_officiel — il garde le « de » et ajoute
// « _officiel ». Chaque candidat est bâti sur **tous** les mots distinctifs du nom, et un nom d'un
// seul mot est refusé en amont : on ne cherche jamais « pons », seulement « ultratraildepons ».
const SUFFIXES = ['', '_officiel', 'officiel', '.officiel', '_off'];

// L'« Opéra National de Bordeaux » est @operadebordeaux : les adjectifs d'institution tombent
// souvent du pseudo. On essaie donc aussi le nom sans eux.
const ADJECTIFS = new Set(['national', 'nationale', 'international', 'internationale', 'municipal', 'municipale', 'departemental', 'departementale', 'regional', 'regionale', 'officiel', 'officielle']);

export const variantesHandle = (nom) => {
  const forts = motsCles(nom);                                             // sans les petits mots
  if (forts.length < 2) return [];
  const tous = fold(nom).split(/[^a-z0-9]+/).filter(Boolean);              // « de », « du », « la » compris
  const allege = tous.filter((m) => !ADJECTIFS.has(m));
  const formes = [tous, ...(allege.length < tous.length && allege.filter((m) => motsCles(m).length).length >= 2 ? [allege] : []), ...(tous.length > forts.length ? [forts] : [])];
  const bases = [];
  for (const mots of formes) {
    for (const lien of ['', '_', '.']) bases.push(mots.join(lien));
  }
  // Les formes les plus courantes d'abord : le premier pseudo confirmé arrête la recherche.
  const sortie = [];
  for (const suffixe of SUFFIXES) for (const base of bases) sortie.push(base + suffixe);
  // Au-delà des douze formes les plus courantes, on paierait cher un gain marginal.
  return [...new Set(sortie)].filter((h) => h.length <= 30).slice(0, 12); // 30 = limite d'Instagram
};

// Le nom que porte le domaine du site officiel, en pseudo Instagram : bdangouleme.com → @bdangouleme,
// huitres-arcachon-capferret.fr → @huitresarcachoncapferret. Les organisations choisissent souvent
// le même nom partout.
export const pseudosDuDomaine = (site) => {
  const l = libelle(site);
  if (!l) return [];
  const parties = l.split(/[.-]+/).filter(Boolean);
  return [...new Set([parties.join(''), parties.join('_'), parties.join('.')])].filter((h) => h.length >= 5 && h.length <= 30);
};

// Audience en dessous de laquelle un compte bâti sur le nom n'apporte rien : un squatteur, un
// compte abandonné, un homonyme minuscule. Un compte personnel, muet, garde sa chance.
export const AUDIENCE_MINIMALE = 100;
// Deux comptes au plus pour une même entité : la troisième place revient à un autre échelon.
export const HOMONYMES_MAX = 2;

export async function garderLesMeilleurs(handles, nom, log = () => {}, mesurer = async () => null) {
  const mesures = await Promise.all(handles.map(async (h) => ({ handle: h, abonnes: await mesurer(h) })));
  const utiles = mesures.filter((m) => m.abonnes === null || m.abonnes >= AUDIENCE_MINIMALE);
  const ecartes = mesures.filter((m) => !utiles.includes(m));
  // les plus suivis d'abord ; les muets ensuite, dans l'ordre des candidats
  const classe = [...utiles].sort((a, b) => (b.abonnes ?? -1) - (a.abonnes ?? -1));
  const preferes = classe.some((m) => m.abonnes !== null) ? classe : rangerLesOfficiels(utiles);
  const retenus = preferes.slice(0, HOMONYMES_MAX).map((m) => m.handle);
  if (!retenus.length) return [handles[0]];
  log(`   « ${nom} » : ${handles.length} pseudos existent, retenus ${retenus.map((h) => `@${h}`).join(', ')}`
    + `${ecartes.length ? ` — écartés ${ecartes.map((m) => `@${m.handle} (${m.abonnes} abonnés)`).join(', ')}` : ''}`);
  return retenus;
}

// Aucun compte ne publie ses abonnés : celui qui se déclare officiel passe devant.
const rangerLesOfficiels = (mesures) => [...mesures].sort((a, b) => Number(/offici|_off$/.test(b.handle)) - Number(/offici|_off$/.test(a.handle)));

// ── Instagram ──

// Parmi les comptes affichés sur un site, ceux de l'entité : le pseudo porte son nom ou celui du
// site. Un seul compte affiché est le sien ; plusieurs sans indice, le premier, comme en pied de page.
function surLeSite(pseudos, { nom, site }) {
  const liste = uniques(pseudos);
  if (liste.length <= 1) return liste;
  const l = libelle(site) ?? '';
  const portent = liste.filter((h) => couverture(h, nom) >= 0.6 || couverture(h, l.replace(/[.-]+/g, ' ')) >= 0.6);
  return portent.length ? portent : liste.slice(0, 1);
}

async function instagramDe(entite, { table, fiche, site, scan, liens, image, outils, log }) {
  const nom = entite.nom;
  const dSite = domaine(site);
  const renvoieAuSite = (c) => Boolean(dSite && c?.site && domaine(c.site) === dSite);
  const decrire = (h) => outils.decrire(h);

  // 1. Ce que l'entité déclare
  const declares = uniques([
    table.instagram,
    fiche?.insta,
    // un compte que la rédaction cite dans l'article, si son pseudo porte le nom de l'entité
    ...(liens.instagram ?? []).filter((h) => porteLeNom(h, nom)),
    ...surLeSite(scan.insta, { nom, site }),
    // un compte des tables qui porte ce nom
    ...(entite.seul ? [] : COMPTES_DE_LA_TABLE.filter((h) => porteLeNom(h, nom))),
  ]);
  if (declares.length) {
    const verifies = await enParallele(declares, 4, async (h) => {
      const c = await decrire(h);
      if (c) return { ...c, preuve: PREUVE.DECLAREE };
      // Muet : compte personnel (l'Ultra Trail de Pons en est un), ou pseudo abandonné depuis que
      // la fiche l'a enregistré. L'essai d'identification tranche ; sans image pour l'essayer, la
      // déclaration fait foi — Instagram retirera le tag à la publication s'il n'existe plus.
      if (!image || (await outils.existe(h, image))) return { handle: h, nom, abonnes: null, preuve: PREUVE.DECLAREE };
      log(`   @${h} déclaré pour « ${nom} » mais introuvable sur Instagram`);
      return null;
    });
    const trouves = verifies.filter(Boolean);
    if (trouves.length) {
      // comptes voisins inscrits à la main : le Mondrian Bordeaux héberge le restaurant Morimoto
      for (const h of table.lies ?? []) trouves.push({ handle: h, nom, abonnes: null, preuve: PREUVE.DECLAREE, lie: true });
      return trouves;
    }
  }

  // 2 et 3. Ce qu'on construit, décrit par l'API puis jugé
  const candidats = [
    ...pseudosDuDomaine(site).map((handle) => ({ handle, source: 'domaine' })),
    // un nom d'un seul mot ne permet aucune devinette : @lebelem est un café bar
    ...(entite.seul ? [] : variantesHandle(nom).map((handle) => ({ handle, source: 'nom' }))),
  ].filter((c, i, t) => t.findIndex((x) => x.handle === c.handle) === i);
  const decrits = await enParallele(candidats, 4, async (c) => ({ ...c, compte: await decrire(c.handle) }));
  const retenus = [];
  for (const { source, compte } of decrits) {
    if (!compte) continue;
    // le compte renvoie lui-même au site officiel : il se déclare, c'est une preuve
    if (renvoieAuSite(compte)) {
      retenus.push({ ...compte, preuve: PREUVE.DECLAREE });
      continue;
    }
    // Bâti sur le nom : le compte doit le porter. Depuis le domaine, deux mots propres en commun —
    // « Festival de la BD d'Angoulême » en partage deux avec le nom officiel du festival ; un
    // quelconque @hermione n'en partagerait qu'un.
    const porte = source === 'nom'
      ? correspond(nom, compte)
      : motsPropres(nom).filter((m) => compact(compte.nom).includes(m)).length >= 2;
    const motif = !porte ? `ne porte pas le nom « ${nom} »`
      : suspect(compte) ? 'compte de fans, d’actualité ou vide'
        : (compte.abonnes ?? 0) < AUDIENCE_MINIMALE ? `${compte.abonnes} abonnés`
          : !semblFrancais(compte.description, { local: true }) ? 'biographie étrangère' : null;
    if (motif) log(`   @${compte.handle} écarté pour « ${nom} » : ${motif}`);
    else retenus.push({ ...compte, preuve: PREUVE.CONSTRUITE });
  }
  const surs = retenus.filter((c) => c.preuve >= PREUVE.DECLAREE);
  if (surs.length) return surs.slice(0, 1);
  if (retenus.length) return retenus.sort((a, b) => (b.abonnes ?? 0) - (a.abonnes ?? 0)).slice(0, HOMONYMES_MAX);

  // 4. Comptes personnels, muets : seul l'essai d'identification prouve qu'ils existent. Réservé
  // aux formes bâties sur le nom exact, et limité : chaque essai crée un conteneur chez Meta.
  if (entite.seul || !image) return [];
  // Seuls les pseudos restés muets sont essayés : un compte décrit puis écarté (43 abonnés, un
  // compte de fans) existe aussi, et l'essai le ferait revenir par la petite porte.
  const muets = new Set(decrits.filter((d) => d.source === 'nom' && d.compte === null).map((d) => d.handle));
  const essais = variantesHandle(nom).filter((h) => muets.has(h)).slice(0, 6);
  const existent = (await enParallele(essais, 2, async (h) => ((await outils.existe(h, image)) ? h : null))).filter(Boolean);
  if (!existent.length) return [];
  // Plusieurs comptes pour la même entité : deux au plus. Aucune API ne dit lequel est l'officiel
  // quand tous sont personnels ; ils sont bâtis sur le nom, donc aucun n'est étranger au sujet.
  const gardes = await garderLesMeilleurs(existent, nom, log);
  return gardes.map((handle) => ({ handle, nom, abonnes: null, preuve: PREUVE.CONSTRUITE }));
}

// ── X : aucun moyen de vérifier, donc seulement ce qui est déclaré ──
function xDe(nom, { table, fiche, scan, instagram }) {
  if (table.x) return [{ handle: table.x, preuve: PREUVE.DECLAREE }];
  if (fiche?.x) return [{ handle: fiche.x, preuve: PREUVE.DECLAREE }];
  // Un site peut citer d'autres comptes X que le sien (Biarritz affichait @mapbox, sa carte) :
  // on garde celui qui porte le nom de l'entité ou de son compte Instagram, ou le seul affiché.
  const liste = scan.x ?? [];
  const igs = instagram.map((c) => compact(c.handle));
  const porte = liste.find((h) => igs.includes(compact(h)) || couverture(h, nom) >= 0.6);
  const choisi = porte ?? (liste.length === 1 ? liste[0] : null);
  return choisi ? [{ handle: choisi, preuve: PREUVE.DECLAREE }] : [];
}

// ── Threads : même pseudo qu'Instagram, présence vérifiée ──
// Une mention n'y vaut que si le compte y a ouvert un profil : @villedebergerac y est,
// @villedecognac non. La vérification est gratuite.
export async function threadsDe(instagram, { declares = [], outils }) {
  const sortie = uniques(declares).map((handle) => ({ handle, preuve: PREUVE.DECLAREE }));
  const presents = await enParallele(instagram.filter((c) => !c.lie), 3, async (c) => ((await outils.surThreads(c.handle)) ? c : null));
  for (const c of presents) if (c && !sortie.some((x) => x.handle === c.handle)) sortie.push({ ...c });
  return sortie;
}

// ── Bluesky ──

// Pseudos Bluesky plausibles d'un compte Instagram : le même nom sur le domaine par défaut.
// Bluesky n'admet ni « _ » ni « . » dans un nom : @ville_pau y deviendrait ville-pau.bsky.social.
// Un pseudo Instagram en forme de domaine (« ripitup.fr ») peut être son pseudo Bluesky tel quel.
export const pseudosBluesky = (handle) => {
  const h = String(handle ?? '').toLowerCase();
  const tirets = h.replace(/[._]+/g, '-').replace(/^-+|-+$/g, '');
  const colle = h.replace(/[._-]+/g, '');
  return [...new Set([
    ...(/^[a-z0-9-]+\.[a-z]{2,6}$/.test(h) ? [h] : []),
    `${colle}.bsky.social`,
    `${tirets}.bsky.social`,
  ])].filter((x) => !/(^|\.)-|-(\.|$)/.test(x));
};

// Les jumeaux Bluesky de comptes Instagram déjà établis. Mesuré le 25/09/2026 : la recherche ne
// trouvait ni la Ville de Bergerac, ni le Festival de la BD, ni le Département de la Gironde — ils
// y sont, sous le même nom qu'Instagram. Le nom affiché doit être le même organisme, et le compte
// vivant : cinquante abonnés au moins, pour écarter un pseudo réservé et jamais utilisé.
export async function jumeauxBluesky(comptes, outils, { plancher = 50 } = {}) {
  const trouves = await enParallele(comptes.filter((c) => !c.lie), 3, async (ig) => {
    for (const h of pseudosBluesky(ig.handle)) {
      const p = await outils.profilBluesky(h);
      if (!p) continue;
      const c = { handle: p.handle, nom: p.nom, description: p.description, abonnes: p.abonnes, preuve: Math.min(ig.preuve ?? PREUVE.CONSTRUITE, PREUVE.CONSTRUITE) };
      if (memeEntite(ig.nom || ig.handle, p.nom) && (p.abonnes ?? 0) >= plancher && !suspect(c) && semblFrancais(p.description, { local: true })) return c;
    }
    return null;
  });
  return trouves.filter(Boolean);
}

// Un compte nommé d'après un domaine a prouvé à Bluesky qu'il possède ce domaine : si c'est le
// site officiel de l'entité, le compte est le sien, sans autre vérification.
async function parDomaine(domaines, outils) {
  for (const d of uniques(domaines)) {
    const p = await outils.profilBluesky(d);
    if (p) return [{ handle: p.handle, nom: p.nom, abonnes: p.abonnes, preuve: PREUVE.DECLAREE }];
  }
  return [];
}

async function blueskyDe(entite, { fiche, scan, site, instagram, outils }) {
  for (const h of uniques([fiche?.bluesky, ...(scan.bluesky ?? [])])) {
    const p = await outils.profilBluesky(h);
    if (p) return [{ handle: p.handle, nom: p.nom, abonnes: p.abonnes, preuve: PREUVE.DECLAREE }];
  }
  const verifie = await parDomaine([domaine(site), ...instagram.map((c) => domaine(c.site))], outils);
  if (verifie.length) return verifie;
  const jumeaux = await jumeauxBluesky(instagram, outils);
  if (jumeaux.length) return jumeaux.slice(0, 1);
  if (entite.seul) return [];
  // Dernier recours, la recherche : le nom doit correspondre mot pour mot, et le profil être sain
  const candidats = ((await outils.chercherBluesky(entite.nom)) ?? []).filter((c) => correspond(entite.nom, c));
  for (const c of candidats) {
    const compte = { ...c, ...((await outils.profilBluesky(c.handle)) ?? {}) };
    if (!suspect(compte) && semblFrancais(compte.description, { local: true })) return [{ handle: compte.handle, nom: compte.nom, abonnes: compte.abonnes, preuve: PREUVE.TROUVEE }];
  }
  return [];
}

// ── Une entité nommée par l'article ──
export async function identifier(entite, { contexte = '', liens = { sites: [], instagram: [] }, image = null, outils, log = () => {} }) {
  const table = depuisTable(entite.nom) ?? {};
  const fiche = await outils.fiche(entite.nom, contexte);
  // le site officiel : celui de la fiche, sinon le lien de l'article dont l'adresse épelle le nom
  const site = fiche?.site ?? siteCite(entite.nom, liens.sites);
  const scan = site ? await outils.site(site) : VIDE;
  const instagram = await instagramDe(entite, { table, fiche, site, scan, liens, image, outils, log });
  const [threads, bluesky] = await Promise.all([
    threadsDe(instagram, { declares: [fiche?.threads, ...(scan.threads ?? [])], outils }),
    table.bluesky ? [{ handle: table.bluesky, preuve: PREUVE.DECLAREE }] : blueskyDe(entite, { fiche, scan, site, instagram, outils }),
  ]);
  return {
    instagram,
    x: xDe(entite.nom, { table, fiche, scan, instagram }),
    threads,
    bluesky,
    // Facebook : fiche officielle seulement. Un site cite souvent d'autres pages que la sienne.
    facebook: fiche?.facebook ? [{ handle: fiche.facebook, preuve: PREUVE.DECLAREE }] : [],
    site,
  };
}

// ── Une commune ──

const TOURISTIQUE = /tourisme|tourism|visit|office|destination/;
export const natureDe = (c) => (TOURISTIQUE.test(compact(`${c.handle} ${c.nom}`)) || /^ot[a-z]/.test(c.handle ?? '') ? 'tourisme' : 'mairie');

// Le compte porte-t-il le nom de la commune ? Dans son nom affiché, ou collé dans son pseudo :
// @visitbordeaux s'affiche « visitbordeaux », sans espace où reconnaître « Bordeaux ».
export const porteLaCommune = (ville, c) => parleDu(ville, c) || [c.handle, c.nom].some((t) => compact(t).includes(compact(ville)));

// Le compte de la ville, pas celui de son opéra : le nom de la commune, et l'allure d'un compte
// municipal — « Ville de… », un pseudo « ville » ou « mairie », ou le nom de la commune seul.
const municipal = (ville, c) => porteLaCommune(ville, c)
  && (/\b(ville|mairie|commune|city)\b/.test(fold(c.nom)) || /ville|mairie|maville|commune/.test(c.handle) || compact(c.nom) === compact(ville));

// Les comptes d'une commune, par nature : la mairie, ou l'office de tourisme.
//
// Mesuré le 25/09/2026 : la fiche Wikidata de la commune déclare @villedebergerac, @villedecognac,
// @ville_pau, @villedebordeaux (204 776 abonnés, que les formes ne trouvaient pas) ; son site
// officiel ajoute @villedesoortshossegor, @ville2biarritz. Aucune forme ne devine ces deux-là.
export async function identifierCommune(ville, { departement = '', nature = 'mairie', outils, log = () => {} }) {
  // « Hossegor » : Wikidata la nomme Soorts-Hossegor. Faute de fiche au nom exact, on accepte un
  // nom composé qui le contient — mais seulement si la description cite le département de l'article.
  const fiche = (await outils.fiche(ville, `commune française ${departement}`.trim()))
    ?? (departement ? await outils.fiche(ville, departement, { partiel: true }) : null);
  const site = fiche?.site ?? null;
  const dSite = domaine(site);
  const scan = site ? await outils.site(site) : VIDE;
  const convient = (c) => natureDe(c) === nature && (nature === 'mairie' ? municipal(ville, c) || (dSite && domaine(c.site) === dSite) : porteLaCommune(ville, c));

  // 1. Déclarés par la commune
  const declares = uniques([fiche?.insta, ...scan.insta]);
  const decrits = (await enParallele(declares, 4, (h) => outils.decrire(h))).filter(Boolean);
  // le compte que la fiche attribue à la commune est le sien, même sous un nom qui ne le dit pas
  // (« La Rochelle Ensemble ») — pourvu qu'il ne soit pas celui de l'office de tourisme
  const deLaFiche = (c) => nature === 'mairie' && natureDe(c) === 'mairie' && c.handle === fiche?.insta?.toLowerCase();
  let instagram = decrits.filter((c) => convient(c) || deLaFiche(c))
    .filter((c) => retenir(c, { preuve: PREUVE.DECLAREE }).garde)
    .map((c) => ({ ...c, preuve: PREUVE.DECLAREE }));

  // 2. Les formes usuelles, en dernier recours
  if (!instagram.length) {
    const trouves = await surInstagram(ville, {
      decrire: (h) => outils.decrire(h),
      formes: (v) => formesCommune(v, nature),
      exigerNom: nature === 'mairie',
      local: true,
      seuil: SEUILS_LOCAUX.instagram,
      log: () => {},
    });
    instagram = trouves.filter(convient).map((c) => ({ ...c, preuve: dSite && domaine(c.site) === dSite ? PREUVE.DECLAREE : PREUVE.CONSTRUITE }));
  }
  instagram = instagram.sort((a, b) => b.preuve - a.preuve || (b.abonnes ?? 0) - (a.abonnes ?? 0)).slice(0, HOMONYMES_MAX);

  const blueskyDeclare = nature === 'mairie' ? uniques([fiche?.bluesky, ...(scan.bluesky ?? [])]) : [];
  let bluesky = [];
  for (const h of blueskyDeclare) {
    const p = await outils.profilBluesky(h);
    if (p) { bluesky = [{ handle: p.handle, nom: p.nom, abonnes: p.abonnes, preuve: PREUVE.DECLAREE }]; break; }
  }
  if (!bluesky.length) bluesky = await parDomaine(nature === 'mairie' ? [dSite] : [], outils);
  if (!bluesky.length) bluesky = await jumeauxBluesky(instagram, outils);

  const threads = await threadsDe(instagram, { declares: nature === 'mairie' ? [fiche?.threads, ...(scan.threads ?? [])] : [], outils });
  const x = nature === 'mairie' && fiche?.x ? [{ handle: fiche.x, preuve: PREUVE.DECLAREE }] : [];
  return { instagram, x, threads, bluesky };
}
