import { readFileSync } from 'node:fs';
import { fromRoot } from '../core/config.mjs';
import { pickRubrique, stripGeoLead, pickHighlight, frenchTypography } from './editorial.mjs';
import { resolvePlace, fold } from './geo.mjs';

const ed = JSON.parse(readFileSync(fromRoot('config/editorial.json'), 'utf8'));

export const toHashtag = (s) =>
  `#${String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('')}`;

export function themeOf(article) {
  const text = fold(`${article.title} ${article.description}`);
  return ed.themes.find((t) => t.match.some((m) => new RegExp(`(^|[^\\p{L}])${fold(m).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(text))) ?? null;
}

const clip = (s, n) => ([...s].length <= n ? s : `${[...s].slice(0, n - 1).join('').replace(/\s+\S*$/, '')}…`);

// Dossier sans IA : règles, lexique géographique et thèmes
export function fallbackDossier(article) {
  const place = resolvePlace(article);
  const theme = themeOf(article);
  const rubrique = place?.name ?? (pickRubrique(article.categories) || theme?.rubrique || ed.defaultRubrique);
  const titre = frenchTypography(stripGeoLead(article.title, rubrique));
  const { highlight } = pickHighlight(titre, { avoid: [rubrique] });
  const description = frenchTypography(article.description);

  const tags = [place?.hashtag ?? (rubrique === ed.defaultRubrique ? null : toHashtag(rubrique)), theme?.hashtag, ed.regionHashtag]
    .filter(Boolean)
    .filter((t, i, all) => all.findIndex((u) => fold(u) === fold(t)) === i);
  for (const extra of ['#Decouverte', '#Patrimoine', '#Voyage']) if (tags.length < 3 && !tags.includes(extra)) tags.push(extra);

  return {
    nature: 'actu',
    sensible: false,
    rubrique,
    visuel: { titre, surlignage: highlight, texte_alternatif: clip(`${rubrique} : ${titre}`, ed.limits.altText) },
    instagram: { texte: description, hashtags: tags.slice(0, 3) },
    facebook: { texte: clip(description, ed.limits.facebook) },
    bluesky: { texte: clip(description, ed.limits.bluesky), hashtag: tags[0] },
    threads: { texte: clip(description, ed.limits.threads) },
    x: { texte: clip(titre, ed.limits.x) },
    source: 'regles',
  };
}
