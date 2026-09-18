import { readFileSync } from 'node:fs';
import { fromRoot } from '../core/config.mjs';
import { fiche } from '../sources/wikidata.mjs';

// Localisation d'un post : lieu précis nommé dans l'article → ville → département → rien.
// Meta n'accepte que les identifiants longs ; les courts, hérités de l'ancien Instagram, sont refusés.
const table = JSON.parse(readFileSync(fromRoot('config/lieux.json'), 'utf8'));

export const identifiantValide = (id) => /^\d{13,}$/.test(String(id ?? ''));

const depuisTable = (nom, section) => {
  const valeurs = table[section] ?? {};
  const cle = Object.keys(valeurs).find((k) => k.toLowerCase() === String(nom ?? '').trim().toLowerCase());
  return cle ? valeurs[cle] : null;
};

// Wikidata d'abord (couvre les villes et beaucoup de lieux), puis notre table
async function identifiant(nom, section) {
  if (!nom) return null;
  const locale = depuisTable(nom, section);
  if (identifiantValide(locale)) return locale;
  const f = await fiche(nom);
  return identifiantValide(f?.lieu) ? f.lieu : null;
}

// « Périgord » ou « Pays basque » ne sont pas des lieux pour Meta : on les traduit en département
export function departementDeZone(nom) {
  const zones = table.zones ?? {};
  const cle = Object.keys(zones).find((z) => z.toLowerCase() === String(nom ?? '').trim().toLowerCase());
  return cle ? zones[cle] : null;
}

// { precis, ville, departement } → { id, nom, niveau } ou null si rien de fiable.
// Du plus précis au plus large : lieu nommé, ville, département, puis le département
// correspondant à la zone identitaire employée comme rubrique.
export async function resoudreLieu({ precis, ville, departement } = {}) {
  const zone = departementDeZone(departement);
  for (const [niveau, nom, section] of [
    ['precis', precis, 'communes'],
    ['ville', ville, 'communes'],
    ['departement', departement, 'departements'],
    ['departement', zone, 'departements'],
  ]) {
    const id = await identifiant(nom, section);
    if (id) return { id, nom, niveau };
  }
  return null;
}
