import { readFileSync } from 'node:fs';
import { fromRoot } from '../core/config.mjs';

export const geo = JSON.parse(readFileSync(fromRoot('config/geo.json'), 'utf8'));

// Comparaison sans accents, apostrophes unifiées, minuscules
export const fold = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'").toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const TERMS = geo.zones
  .flatMap((zone) => zone.match.map((term) => ({ zone, term, re: new RegExp(`(^|[^\\p{L}])${escapeRe(fold(term))}([^\\p{L}]|$)`, 'u') })))
  .sort((a, b) => b.term.length - a.term.length);

// Zone identitaire citée dans un texte (terme le plus long d'abord : « Saint-Jean-de-Luz » avant « Luz »)
export function findZone(text) {
  const folded = fold(text);
  return TERMS.find((t) => t.re.test(folded))?.zone ?? null;
}

// Lieu d'un article : titre, puis description, puis catégories
export function resolvePlace(article) {
  return findZone(article.title) ?? findZone(article.description) ?? findZone((article.categories ?? []).join(' | '));
}

// Noms de zones utiles au prompt : celles des départements cités + la zone détectée
export function candidateZones(article, place) {
  const cats = (article.categories ?? []).map(fold);
  const names = geo.zones.filter((z) => cats.includes(fold(z.department))).map((z) => z.name);
  if (place) names.unshift(place.name);
  return [...new Set(names)];
}

export const placeNames = () => [geo.region, ...geo.departments, ...geo.zones.flatMap((z) => [z.name, ...z.match])];
