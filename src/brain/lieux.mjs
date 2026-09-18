import { readFileSync } from 'node:fs';
import { fromRoot } from '../core/config.mjs';
import { fiche } from '../sources/wikidata.mjs';
import { geo, fold } from './geo.mjs';

// Localisation d'un post : lieu précis nommé dans l'article → ville → département → zone identitaire.
// Meta n'accepte que les identifiants longs ; les courts, hérités de l'ancien Instagram, sont refusés.
const table = JSON.parse(readFileSync(fromRoot('config/lieux.json'), 'utf8'));

export const identifiantValide = (id) => /^\d{13,}$/.test(String(id ?? ''));

// Comparaison tolérante aux accents et aux apostrophes, comme le lexique géographique :
// « Bassin d’Arcachon » du lexique doit retrouver « Bassin d'Arcachon » de la table.
const dansTable = (nom, section) => {
  const valeurs = table[section] ?? {};
  if (!String(nom ?? '').trim()) return null;
  const cle = Object.keys(valeurs).find((k) => fold(k) === fold(nom));
  return cle ? valeurs[cle] : null;
};

// Notre table d'abord (identifiants déjà vérifiés auprès de Meta), puis Wikidata,
// qui ne connaît un identifiant de lieu que pour une poignée de communes notables.
async function identifiant(nom, section) {
  if (!String(nom ?? '').trim()) return null;
  const locale = dansTable(nom, section);
  if (identifiantValide(locale)) return locale;
  const f = await fiche(nom);
  return identifiantValide(f?.lieu) ? f.lieu : null;
}

// « Périgord » ou « Pays basque » ne sont pas des lieux pour Meta : on remonte au département.
// La correspondance vient du lexique géographique, seule source, et accepte ses alias (« Sarlat »).
export function departementDeZone(nom) {
  if (!String(nom ?? '').trim()) return null;
  const cible = fold(nom);
  const zone = geo.zones.find((z) => fold(z.name) === cible || z.match.some((m) => fold(m) === cible));
  return zone?.department ?? null;
}

// Quelques zones ont une ville qui en est réellement le cœur (Saintonge → Saintes, Aunis → La Rochelle).
// Dernier repli seulement. Jamais la préfecture d'un département : taguer Bordeaux pour un article
// du Médoc serait faux, et une localisation fausse est pire que pas de localisation.
export function villeDeZone(nom) {
  return dansTable(nom, 'villesDeZone');
}

// { precis, ville, departement, zone } → { id, nom, niveau } ou null si rien de fiable.
// La zone identitaire arrive soit à part (rubrique du visuel), soit écrite dans le champ département.
export async function resoudreLieu({ precis, ville, departement, zone } = {}) {
  const zones = [...new Set([zone, departement].filter((z) => String(z ?? '').trim()))];
  const etapes = [
    ['precis', precis, 'communes'],
    ['ville', ville, 'communes'],
    ['departement', departement, 'departements'],
    ...zones.map((z) => ['departement', departementDeZone(z), 'departements']),
    ...zones.map((z) => ['zone', z, 'communes']),
    ...zones.map((z) => ['zone', villeDeZone(z), 'communes']),
  ];
  for (const [niveau, nom, section] of etapes) {
    const id = await identifiant(nom, section);
    if (id) return { id, nom, niveau };
  }
  return null;
}
