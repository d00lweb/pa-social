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
const table = JSON.parse(readFileSync(fromRoot('config/lieux.json'), 'utf8'));

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

// Notre table d'abord (identifiants déjà confirmés par Meta), puis Wikidata,
// qui ne connaît un identifiant que pour une poignée de communes notables.
async function identifiant(nom, section) {
  if (!propre(nom)) return null;
  const locale = dansTable(nom, section);
  if (identifiantValide(locale)) return locale;
  const f = await fiche(nom);
  return identifiantValide(f?.lieu) ? f.lieu : null;
}

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
    ['precis', propre(precis), 'communes'],
    ['ville', propre(ville), 'communes'],
    ['departement', propre(departement), 'departements'],
    ...zones.map((z) => ['departement', propre(departementDeZone(z)), 'departements']),
  ];
  // Le nom de la zone n'est tenté comme commune que si l'article ne nomme aucune ville.
  // Sinon on taguerait une autre commune que la sienne : un article sur Pessac, dont la ville
  // n'a pas d'identifiant, ne doit pas se retrouver tagué « Bordeaux ».
  if (!propre(ville)) liste.push(...zones.map((z) => ['zone', z, 'communes']));
  return liste.filter(([, nom]) => nom);
}

// { precis, ville, departement, zone } → { id, nom, niveau } ou null si rien de fiable.
// La zone identitaire arrive soit à part (rubrique du visuel), soit écrite dans le champ département.
export async function resoudreLieu(source = {}) {
  for (const [niveau, nom, section] of etapes(source)) {
    const id = await identifiant(nom, section);
    if (id) return { id, nom, niveau };
  }
  return null;
}
