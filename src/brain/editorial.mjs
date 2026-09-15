const GEO = [
  'Charente', 'Charente-Maritime', 'Corrèze', 'Creuse', 'Dordogne', 'Gironde',
  'Landes', 'Lot-et-Garonne', 'Deux-Sèvres', 'Pyrénées-Atlantiques',
  'Haute-Vienne', 'Vienne', 'Bordeaux', 'Limoges', 'Poitiers', 'La Rochelle',
  'Pau', 'Bayonne', 'Angoulême', 'Niort', 'Périgueux', 'Agen', 'Biarritz', 'Arcachon',
];
const GENERIC = ['actus', 'actualités'];

const norm = (s) => s.normalize('NFC').trim().toLowerCase();
const GEO_SET = new Set(GEO.map(norm));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 1. Rubrique : géo > première non générique > première
export function pickRubrique(categories) {
  return (
    categories.find((c) => GEO_SET.has(norm(c))) ??
    categories.find((c) => !GENERIC.includes(norm(c))) ??
    categories[0] ??
    ''
  );
}

// 2. « En Haute-Vienne, … » quand la rubrique affiche déjà le lieu
export function stripGeoLead(title, rubrique) {
  if (!rubrique) return title;
  const re = new RegExp(
    `^(?:en|à|a|au|aux|dans|sur|près de|du côté de|autour de)\\s+(?:(?:le|la|les)\\s+|l[’']\\s*)?${escapeRe(rubrique)}\\s*,\\s*`,
    'iu',
  );
  const out = title.replace(re, '');
  if (out === title) return title;
  return out.charAt(0).toLocaleUpperCase('fr-FR') + out.slice(1);
}

// 3. Groupe surligné en fin de titre
const DETS = new Set([
  'le', 'la', 'les', 'l’', 'un', 'une', 'des', 'du', 'de', 'd’',
  'ce', 'cet', 'cette', 'ses', 'son', 'sa', 'leur', 'd’un', 'd’une',
]);
const ELIDED = /^[ld]’\p{L}/u;
const MAX_WORDS = 3;
const MAX_CHARS = 22;

const SP = '[ \\u00A0\\u202F]';
const UNIT = '(?:°C|%|€|km²|km|kg|m²|m|t|ha|h|ans?)';
// nombre + unité = un seul mot : 42°C, 12 km, 3 500 €
const NUM_UNIT =
  `\\d{1,3}(?:${SP}\\d{3})+(?:[.,]\\d+)?(?:${SP}?${UNIT}(?![\\p{L}\\d]))?` +
  `|\\d+(?:[.,]\\d+)?${SP}?${UNIT}(?![\\p{L}\\d])`;
const TOKEN = new RegExp(`(?<!\\S)(?:${NUM_UNIT})|\\S+`, 'gu');

const word = (t) => t.toLowerCase().replace(/'/g, '’');

export function splitHighlight(title) {
  const tail = title.match(/[\s.,;:!?…»"”)]*$/u)[0];
  const body = title.slice(0, title.length - tail.length);
  const tokens = [...body.matchAll(TOKEN)];
  if (!tokens.length) return { before: title, highlight: '', after: '' };

  let start = tokens.length - 1;
  while (start > 0 && tokens.length - start < MAX_WORDS) {
    const head = word(tokens[start][0]);
    if (DETS.has(head) || ELIDED.test(head)) break; // déjà déterminé
    if (!DETS.has(word(tokens[start - 1][0]))) break; // préposition, adverbe…
    if (body.length - tokens[start - 1].index > MAX_CHARS) break;
    start--;
  }

  const at = tokens[start].index;
  return { before: body.slice(0, at), highlight: body.slice(at), after: tail };
}

// 4. Typographie française
export function frenchTypography(s) {
  return s
    .replace(/(?<!\d)\d{1,3}(?:[   ]\d{3})+(?!\d)/g, (m) => m.replace(/[   ]/g, ' '))
    .replace(/(\d)[   ]?(°C|%|€)/g, '$1 $2')
    .replace(/(?<=[^\s;:!?])[   ]*([;:!?])(?=\s|$|[»”"’)])/gu, ' $1');
}
