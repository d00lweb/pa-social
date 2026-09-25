import { fold } from './geo.mjs';

// Découverte de comptes de référence sur un domaine, sans table écrite à la main.
//
// Mesuré le 25/09/2026, sur quatre domaines, pour choisir la méthode :
//
//  · Fabriquer des pseudos depuis le mot du domaine et les soumettre à Instagram ne suffit pas.
//    « apiculture » donne 153 et 21 abonnés ; « féminisme » ne donne rien ; « patrimoine » donne
//    une boutique indonésienne à 1 300 abonnés. Un bon résultat sur quatre — et le mauvais est
//    pire que l'absence, puisqu'il paraît crédible.
//  · La recherche d'acteurs de Bluesky, elle, est une vraie recherche : « féminisme » renvoie
//    Osez le Féminisme, les Archives du féminisme, le Musée des féminismes ; « patrimoine »
//    renvoie la Fondation du patrimoine et la Fondation des sciences du patrimoine.
//
// D'où cette conception : les deux sources alimentent les candidats, et c'est le **filtre** qui
// décide. Un compte n'est retenu que s'il est identifiable, français, du domaine, et suivi. Tout
// ce qui ne franchit pas ces quatre portes est écarté — l'absence de mention ne coûte rien, une
// mention à côté du sujet coûte la crédibilité du média.

// Audience minimale d'un compte de référence. Un compte à 150 abonnés n'apporte aucune découverte ;
// il signale surtout un homonyme ou un compte abandonné. Bluesky étant un réseau jeune, son seuil
// est plus bas : 500 abonnés y valent plusieurs milliers ailleurs.
export const SEUILS = { instagram: 3000, bluesky: 300 };

// Marques d'une autre langue dans une biographie. Relevées sur les cas réels : la boutique
// indonésienne (« Order via WA only: +628… »), les associations américaines et britanniques
// d'Alzheimer, un collectif norvégien de féminisme.
// Un nom français ne garantit rien : « Gastronomie France » (17 698 abonnés) est une agence de
// recrutement espagnole — « 10 AÑOS DE EXPERIENCIA, +900 candidatos ». C'est la **biographie**
// qui dit la langue, pas l'enseigne.
const ETRANGER = /\b(the|and|we|our|your|with|for|order|shop|worldwide|dementia|disease|society|beekeeping|bli med|vi bygger|inkluderende|años|experiencia|candidatos|establecimientos|nuestro|para|más|anos|nosso|unsere|wir)\b|\+\d{2,3}\s?\d{6,}/i;
// Marques de langue française. La présence d'au moins une suffit : les biographies sont courtes.
const FRANCAIS = /\b(le|la|les|des|du|de|au|aux|une|un|et|pour|avec|sur|dans|notre|nos|vous|votre|française?|france|par)\b|[éèêàçùôîï]/i;

// Francophone ne veut pas dire français : @sante.quebec a franchi les portes le 25/09/2026. Le
// média parle de Nouvelle-Aquitaine à un public de France ; une audience québécoise ou suisse ne
// se convertit pas en abonnés.
const HORS_DE_FRANCE = /\b(quebec|québec|canada|canadien|suisse|belgique|belge|luxembourg|maroc|tunisie|senegal|sénégal)\b/i;

export const semblFrancais = (texte) => {
  const t = String(texte ?? '');
  if (!t.trim()) return false;
  return FRANCAIS.test(t) && !ETRANGER.test(t) && !HORS_DE_FRANCE.test(t);
};

// Le compte est-il **du** domaine, ou seulement quelqu'un qui en parle ? Le mot doit figurer dans
// son **nom**, pas seulement dans sa biographie. C'est la porte qui sépare une institution d'un
// particulier : « Osez le Féminisme », « Fondation du patrimoine », « France Alzheimer » la
// franchissent ; « Elisa Rojas », « Tonton Alberto », « La meuf là » — des comptes personnels dont
// la biographie cite le domaine — ne la franchissent pas. Mesuré le 25/09/2026 : sans cette règle,
// la recherche « gastronomie » proposait trois particuliers sur quatre résultats.
export function parleDu(domaine, compte) {
  const mots = fold(domaine).split(/[^a-z0-9]+/).filter((m) => m.length > 3);
  if (!mots.length) return false;
  const nom = fold(compte.nom ?? '');
  // racine de 4 lettres : « féminisme » reconnaît « féministe », « apiculture » reconnaît « apiculteur »
  return mots.every((m) => nom.includes(m.slice(0, Math.max(4, m.length - 3))));
}

// Les quatre portes, dans l'ordre où elles coûtent le moins cher à franchir.
export function retenir(compte, { domaine, reseau }) {
  const abonnes = compte.abonnes ?? null;
  if (abonnes === null) return { garde: false, motif: 'audience inconnue' };
  if (abonnes < (SEUILS[reseau] ?? 1000)) return { garde: false, motif: `${abonnes} abonnés, sous le seuil de ${SEUILS[reseau]}` };
  if (!parleDu(domaine, compte)) return { garde: false, motif: `« ${compte.nom} » n’est pas une institution du domaine` };
  // la langue se juge sur la biographie seule : une enseigne peut se dire « France » et écrire
  // en espagnol. Une biographie vide ne prouve rien, donc elle ne passe pas.
  if (!semblFrancais(compte.description)) return { garde: false, motif: 'biographie non française ou absente' };
  return { garde: true, motif: null };
}

// Pseudos plausibles d'une organisation française du domaine. Ils ne sont que des candidats :
// chacun est ensuite décrit par Instagram, puis passé aux quatre portes.
export const formesInstagram = (domaine) => {
  const mot = fold(domaine).replace(/[^a-z0-9]+/g, '');
  if (mot.length < 4) return [];
  return [mot, `france${mot}`, `${mot}france`, `${mot}_france`, `${mot}.fr`, `${mot}_fr`, `${mot}officiel`, `les${mot}`, `le${mot}`];
};

// Découverte sur Instagram : pseudos fabriqués, décrits par l'API, filtrés.
export async function surInstagram(domaine, { decrire, log = () => {} }) {
  const trouves = [];
  for (const handle of formesInstagram(domaine)) {
    const b = await decrire(handle);
    if (!b) continue;
    const compte = { handle: b.username ?? handle, nom: b.name ?? '', description: b.biography ?? '', abonnes: b.followers_count ?? null };
    const { garde, motif } = retenir(compte, { domaine, reseau: 'instagram' });
    if (garde) trouves.push(compte);
    else log(`   @${compte.handle} écarté : ${motif}`);
  }
  return trouves;
}

// Découverte sur Bluesky : vraie recherche d'acteurs, profils lus, filtrés.
export async function surBluesky(domaine, { chercher, lireProfil, log = () => {} }) {
  const trouves = [];
  for (const a of (await chercher(domaine)) ?? []) {
    const p = (await lireProfil(a.handle)) ?? {};
    const compte = {
      handle: a.handle,
      nom: p.nom ?? a.nom ?? '',
      description: p.description ?? a.description ?? '',
      abonnes: p.abonnes ?? a.abonnes ?? null,
    };
    const { garde, motif } = retenir(compte, { domaine, reseau: 'bluesky' });
    if (garde) trouves.push(compte);
    else log(`   @${compte.handle} écarté : ${motif}`);
  }
  return trouves;
}
