import { readFileSync } from 'node:fs';
import { fromRoot } from '../core/config.mjs';
import { fiche } from '../sources/wikidata.mjs';
import { geo, fold } from './geo.mjs';

// Localisation d'un post. Règle unique : on ne peut qu'ÉLARGIR. Un lieu sans identifiant est
// remplacé par le lieu qui le contient — la ville par son département, la zone identitaire par
// le sien — jamais par un voisin ni par un morceau de lui-même. Taguer Bayonne pour un article
// du Pays basque, ou Dax pour un article des Landes, serait faux ; un lieu faux est pire que
// pas de lieu. Meta n'accepte par ailleurs que les identifiants longs ; les courts, hérités de
// l'ancien Instagram, sont systématiquement refusés.

const lire = (chemin, defaut) => {
  try {
    return JSON.parse(readFileSync(fromRoot(chemin), 'utf8'));
  } catch {
    return defaut;
  }
};

const config = lire('config/lieux.json', {});
// Lieux appris en relisant les publications de la page Facebook (src/measure/recolte.mjs).
// Ils vivent dans state/, seul dossier que le robot enregistre en production, et chacun a été
// accepté par Instagram avant d'y entrer : on leur fait confiance tels quels, même quand leur
// identifiant fait moins de 13 chiffres (« Fêtes de Bayonne », « Martell »).
const appris = lire('state/lieux-appris.json', {});
const table = {
  ...config,
  communes: { ...(appris.communes ?? {}), ...(config.communes ?? {}) },
  lieux: { ...(appris.lieux ?? {}), ...(config.lieux ?? {}) },
};
const confiance = new Set([...Object.values(appris.communes ?? {}), ...Object.values(appris.lieux ?? {})].map(String));

export const identifiantValide = (id) => /^\d{13,}$/.test(String(id ?? ''));

const propre = (v) => String(v ?? '').trim();

// Comparaison tolérante aux accents et aux apostrophes, comme le lexique géographique :
// « Bassin d’Arcachon » du lexique doit retrouver « Bassin d'Arcachon » de la table.
const dansTable = (nom, section) => {
  const valeurs = table[section] ?? {};
  if (!propre(nom)) return null;
  const cle = Object.keys(valeurs).find((k) => fold(k) === fold(nom));
  return cle ? valeurs[cle] : null;
};

// Nos tables d'abord (identifiants confirmés par Meta, ou appris), dans l'ordre des sections
// demandées ; Wikidata une seule fois en dernier recours, car il ne connaît qu'une poignée de communes.
async function identifiant(nom, sections) {
  if (!propre(nom)) return null;
  for (const section of [sections].flat()) {
    const locale = dansTable(nom, section);
    if (locale && (identifiantValide(locale) || confiance.has(String(locale)))) return String(locale);
  }
  const f = await fiche(nom);
  return identifiantValide(f?.lieu) ? f.lieu : null;
}

export const estDepartement = (nom) => Boolean(propre(nom)) && geo.departments.some((d) => fold(d) === fold(nom));

// « Périgord » ou « Pays basque » ne sont pas des lieux pour Meta : on remonte au département,
// qui les contient. La correspondance vient du lexique géographique, seule source, et accepte
// ses alias (« Sarlat » → Dordogne).
export function departementDeZone(nom) {
  if (!propre(nom)) return null;
  const cible = fold(nom);
  const zone = geo.zones.find((z) => fold(z.name) === cible || z.match.some((m) => fold(m) === cible));
  return zone?.department ?? null;
}

// Marches de recherche, de la plus précise à la plus large. Chacune contient la précédente.
// Fonction pure : elle décide de ce qu'on a le droit de tenter, sans rien interroger.
export function etapes({ precis, ville, departement, zone } = {}) {
  const zones = [...new Set([zone, departement].map(propre).filter(Boolean))];
  const liste = [
    // un établissement appris (« Dune du Pilat ») d'abord, puis une commune du même nom
    ['precis', propre(precis), ['lieux', 'communes']],
    ['ville', propre(ville), 'communes'],
    ['departement', propre(departement), 'departements'],
    ...zones.map((z) => ['departement', propre(departementDeZone(z)), 'departements']),
  ];
  // Le nom de la zone n'est tenté comme commune que si l'article ne nomme aucune ville.
  // Sinon on taguerait une autre commune que la sienne : un article sur Pessac, dont la ville
  // n'a pas d'identifiant, ne doit pas se retrouver tagué « Bordeaux ».
  // Jamais un nom de département non plus : Corrèze est aussi un village, et un article sur le
  // département ne doit pas se retrouver tagué au village.
  if (!propre(ville)) liste.push(...zones.filter((z) => !estDepartement(z)).map((z) => ['zone', z, 'communes']));
  return liste.filter(([, nom]) => nom);
}

// { precis, ville, departement, zone } → { id, nom, niveau } ou null si rien de fiable.
// La zone identitaire arrive soit à part (rubrique du visuel), soit écrite dans le champ département.
export async function resoudreLieu(source = {}) {
  for (const [niveau, nom, sections] of etapes(source)) {
    const id = await identifiant(nom, sections);
    if (id) return { id, nom, niveau };
  }
  return null;
}

// Nom du lieu le plus précis que l'article donne, indépendamment de tout identifiant Meta :
// c'est ce qu'on tape pour taguer à la main (story Instagram, kit X). La rubrique n'est retenue
// que si c'est un lieu : « Patrimoine » ou « Gastronomie » ne se taguent pas.
export function lieuNomme({ precis, ville, departement, zone } = {}) {
  const z = propre(zone);
  const zoneLieu = z && (departementDeZone(z) || estDepartement(z)) ? z : '';
  return propre(precis) || propre(ville) || zoneLieu || propre(departement) || null;
}

// Lieu tagué sur une publication Facebook → { section, nom, id }, ou null s'il ne faut pas l'apprendre.
// La règle « on ne fait qu'élargir » vaut ici aussi : un établissement est rangé sous son propre nom,
// jamais sous celui de sa commune — sinon « Martell » taguerait tout article sur Cognac.
export function classerLieu(place) {
  const id = propre(place?.id);
  const nom = propre(place?.name);
  if (!/^\d+$/.test(id) || !nom) return null;
  const base = nom.split(',')[0].trim();
  // Un nom de département n'est jamais appris : sur Facebook, la page « Dordogne » est localisée à
  // Die (Drôme) et « Lot-et-Garonne » à Saint-Nicolas-de-la-Grave. Rien ne garantit ce qu'elles désignent.
  if (estDepartement(base)) return null;
  const ville = propre(place.location?.city);
  if (ville && place.location?.country === 'France' && fold(base) === fold(ville)) return { section: 'communes', nom: ville, id };
  return { section: 'lieux', nom, id };
}

// Identifiants déjà posés à la main dans la configuration : la récolte ne les revérifie pas
export const identifiantsConfig = () =>
  [...Object.values(config.communes ?? {}), ...Object.values(config.departements ?? {}), ...Object.values(config.lieux ?? {})].map(String);
