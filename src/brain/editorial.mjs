import { readFileSync } from 'node:fs';
import { fromRoot } from '../core/config.mjs';

const ed = JSON.parse(readFileSync(fromRoot('config/editorial.json'), 'utf8'));
const geo = JSON.parse(readFileSync(fromRoot('config/geo.json'), 'utf8'));

const fold = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'").toLowerCase().trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const CITIES = ['Bordeaux', 'Limoges', 'Poitiers', 'La Rochelle', 'Pau', 'Bayonne', 'Angoulême', 'Niort', 'Périgueux', 'Agen', 'Biarritz', 'Arcachon'];
const GEO_SET = new Set([...geo.departments, ...CITIES].map(fold));
const GENERIC = new Set(ed.genericCategories.map(fold));
const INTERNAL = new RegExp(ed.internalCategoryPattern, 'i');
const STOP = new Set(ed.stopwords.map(fold));
const DET_INCLUDE = new Set(['le', 'la', 'les', 'un', 'une', 'du', 'des']);
const MAX_HIGHLIGHT = ed.limits.highlight;

// 1. Rubrique issue des catégories : géographie, sinon première catégorie éditoriale ; jamais générique ni interne
export function pickRubrique(categories) {
  const usable = categories.filter((c) => !GENERIC.has(fold(c)) && !INTERNAL.test(c));
  return usable.find((c) => GEO_SET.has(fold(c))) ?? usable[0] ?? '';
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

// 3. Groupe surligné : chiffre > nom propre > fin de titre, jamais bordé d'un petit mot
const SP = '[ \\u00A0\\u202F]';
const NUMBER_GROUP = new RegExp(
  `(?<![\\p{L}\\d])(?:\\d{1,3}(?:${SP}\\d{3})+|\\d+)(?:[.,]\\d+)?(?!\\d)(?:${SP}?(?:°C|%|€|km²|km|kg|m²|ha)(?![\\p{L}])|${SP}([\\p{L}][\\p{L}’'-]{2,}))?`,
  'u',
);
const PUNCT_ONLY = /^[\p{P}\p{S}]+$/u;
const LEAD = /^[«"“(\p{Pi}]+|^[LlDd][’']/u;
const TRAIL = /[»"”),.;:!?…\p{Pf}]+$/u;

export const splitAround = (title, highlight) => {
  const at = highlight ? title.indexOf(highlight) : -1;
  if (at < 0) return { before: title, highlight: '', after: '' };
  return { before: title.slice(0, at), highlight, after: title.slice(at + highlight.length) };
};

// Mot « nu » d'un jeton : sans guillemets, élision ni ponctuation finale, avec ses bornes dans le titre
function bare(token) {
  let text = token[0];
  let start = token.index;
  const lead = text.match(/^[«"“(]+/u)?.[0] ?? '';
  text = text.slice(lead.length);
  start += lead.length;
  const elision = text.match(/^[LlDd][’']/u)?.[0] ?? '';
  const trail = text.match(TRAIL)?.[0] ?? '';
  const core = text.slice(elision.length, text.length - trail.length);
  return { core, start: start + elision.length, end: start + text.length - trail.length, full: text.slice(0, text.length - trail.length), fullStart: start, trail, elided: Boolean(elision) };
}

export function pickHighlight(title, { avoid = [] } = {}) {
  const avoidSet = new Set(avoid.filter(Boolean).map(fold));
  const cut = (start, end) => ({ before: title.slice(0, start), highlight: title.slice(start, end), after: title.slice(end) });
  const tokens = [...title.matchAll(/\S+/gu)];

  // chiffre avec son unité ou son nom (le nom ne doit pas être un petit mot)
  const num = title.match(NUMBER_GROUP);
  if (num) {
    let text = num[0];
    if (num[1] && STOP.has(fold(num[1]))) text = text.slice(0, text.length - num[1].length).trimEnd();
    if ([...text].length <= MAX_HIGHLIGHT) return cut(num.index, num.index + text.length);
  }

  // nom propre hors premier mot, hors début de proposition et hors rubrique
  for (let i = 1; i < tokens.length; i++) {
    const previous = tokens[i - 1][0];
    if (/[:.!?]$/.test(previous)) continue;
    const b = bare(tokens[i]);
    const isProper = (x) => /^\p{Lu}/u.test(x.core) && [...x.core].length >= 3 && !STOP.has(fold(x.core));
    if (!isProper(b) || avoidSet.has(fold(b.core))) continue;
    let end = b.end;
    let j = i;
    while (!b.trail && j + 1 < tokens.length) {
      const next = bare(tokens[j + 1]);
      if (!isProper(next) || next.elided || tokens[j][0].match(TRAIL)) break;
      if ([...title.slice(b.start, next.end)].length > MAX_HIGHLIGHT) break;
      end = next.end;
      j++;
    }
    if (avoidSet.has(fold(title.slice(b.start, end)))) continue;
    let start = b.start;
    if (j === i && !b.elided && DET_INCLUDE.has(fold(previous)) && [...title.slice(tokens[i - 1].index, end)].length <= MAX_HIGHLIGHT) start = tokens[i - 1].index;
    if ([...title.slice(start, end)].length <= MAX_HIGHLIGHT) return cut(start, end);
  }

  // fin de titre : jusqu'à 3 mots pleins consécutifs
  let k = tokens.length - 1;
  while (k >= 0 && (PUNCT_ONLY.test(tokens[k][0]) || STOP.has(fold(bare(tokens[k]).full)))) k--;
  if (k < 0) return { before: title, highlight: '', after: '' };
  const last = bare(tokens[k]);
  let start = last.fullStart;
  let count = 1;
  for (let m = k - 1; m >= 0 && count < 3; m--) {
    const t = tokens[m][0];
    if (PUNCT_ONLY.test(t) || TRAIL.test(t) || STOP.has(fold(bare(tokens[m]).full))) break;
    if ([...title.slice(tokens[m].index, last.end)].length > MAX_HIGHLIGHT) break;
    start = tokens[m].index;
    count++;
  }
  if (count === 1 && k > 0 && DET_INCLUDE.has(fold(tokens[k - 1][0])) && [...title.slice(tokens[k - 1].index, last.end)].length <= MAX_HIGHLIGHT) {
    start = tokens[k - 1].index;
  }
  return cut(start, last.end);
}

// 4. Typographie française
export function frenchTypography(s) {
  return String(s)
    .replace(/(?<!\d)\d{1,3}(?:[   ]\d{3})+(?!\d)/g, (m) => m.replace(/[   ]/g, ' '))
    .replace(/(\d)[   ]?(°C|%|€)/g, '$1 $2')
    .replace(/«[   ]*/g, '« ')
    .replace(/[   ]*»/g, ' »')
    .replace(/(?<=[^\s;:!?])[   ]*([;:!?])(?=\s|$|[»”"’)])/gu, ' $1');
}
