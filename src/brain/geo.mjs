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
// Zones d'identité que les données de l'article justifient vraiment.
//
// 25/09/2026 : un article sur l'Ultra Trail de Pons est parti sur Instagram avec « Saintonge » en
// rubrique. La liste proposée au rédacteur était ["Île de Ré", "Oléron", "La Rochelle", "Royan",
// "Saintonge"] : toutes les zones du département cité, alors qu'aucune ne contient Pons. Le
// rédacteur a choisi la moins fausse ; il aurait pu répondre « Île de Ré ».
//
// Une zone n'est donc retenue que si l'un de ses mots (son nom, ou une commune de sa liste) figure
// dans le titre, la description ou les catégories. Sans cela, la liste est vide et la rubrique
// retombe sur la commune ou le département, qui sont dans les données, eux.
export function candidateZones(article, place) {
  const texte = fold([article.title, article.description, ...(article.categories ?? [])].filter(Boolean).join(' '));
  const mot = (m) => new RegExp(`(^|[^\\p{L}])${fold(m).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'u').test(texte);
  const names = geo.zones.filter((z) => [z.name, ...(z.match ?? [])].some(mot)).map((z) => z.name);
  if (place) names.unshift(place.name);
  return [...new Set(names)];
}

export const placeNames = () => [geo.region, ...geo.departments, ...geo.zones.flatMap((z) => [z.name, ...z.match])];
