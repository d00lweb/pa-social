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

// Règles de secours : un emoji du thème en fin de texte, sans point juste avant
const withEmoji = (text, emoji) => (emoji ? `${text.replace(/[.…\s]+$/u, '')} ${emoji}` : text);

const clip = (s, n) => ([...s].length <= n ? s : `${[...s].slice(0, n - 1).join('').replace(/\s+\S*$/, '')}…`);

// Facebook, format « publication avec lien » : la carte d'aperçu affiche déjà le titre de l'article
// juste sous le texte. Répéter ce titre n'apporte rien et n'ajoute aucune raison de cliquer — c'est
// le reproche fait au repli du 23/09/2026. On part donc de la description, en sautant sa première
// phrase quand elle redit le titre, et l'emoji n'est posé que si un thème a été reconnu : un 📍
// générique vaut moins que pas d'emoji du tout.
export function accrocheFacebook({ titre, description, emoji, max }) {
  const phrases = String(description ?? '').split(/(?<=[.!?…])\s+/).map((p) => p.trim()).filter(Boolean);
  const memeQueTitre = (p) => {
    const mots = (s) => new Set(fold(s).split(/[^\p{L}\p{N}]+/u).filter((m) => m.length > 3));
    const t = mots(titre);
    const communs = [...mots(p)].filter((m) => t.has(m)).length;
    return t.size && communs / t.size >= 0.6;
  };
  // parmi les phrases qui ne redisent pas le titre, on garde celle qui accroche : un renversement
  // (« pourtant », « mais »), puis un chiffre ou une date, sinon la première
  const candidates = phrases.filter((p) => !memeQueTitre(p));
  const note = (p) => (/(^|\s)(pourtant|mais|en revanche|sauf|désormais|pour la première fois)(\s|,)/i.test(p) ? 2 : 0) + (/\d/.test(p) ? 1 : 0);
  const utile = candidates.slice().sort((a, b) => note(b) - note(a))[0] ?? phrases[0] ?? titre;
  return withEmoji(clip(frenchTypography(utile), max - (emoji ? 3 : 1)), emoji);
}

// Dossier sans IA : règles, lexique géographique et thèmes
export function fallbackDossier(article) {
  const place = resolvePlace(article);
  const theme = themeOf(article);
  const rubrique = place?.name ?? (pickRubrique(article.categories) || theme?.rubrique || ed.defaultRubrique);
  const titre = frenchTypography(stripGeoLead(article.title, rubrique));
  const { highlight } = pickHighlight(titre, { avoid: [rubrique] });
  const description = frenchTypography(article.description);
  const emoji = ed.fallbackEmojis[theme?.rubrique] ?? ed.fallbackEmojis.default;

  const tags = [place?.hashtag ?? (rubrique === ed.defaultRubrique ? null : toHashtag(rubrique)), theme?.hashtag, ed.regionHashtag]
    .filter(Boolean)
    .filter((t, i, all) => all.findIndex((u) => fold(u) === fold(t)) === i);
  for (const extra of ['#Decouverte', '#Patrimoine', '#Voyage']) if (tags.length < 3 && !tags.includes(extra)) tags.push(extra);

  return {
    nature: 'actu',
    sensible: false,
    rubrique,
    // sans IA, aucune entité n'est identifiable : pas de mention, et le lieu se limite à ce que le lexique donne
    entites: [],
    lieu: { precis: '', ville: '', departement: place?.name ?? '' },
    visuel: { titre, surlignage: highlight, description, texte_alternatif: clip(`${rubrique} : ${titre}`, ed.limits.altText) },
    instagram: { texte: withEmoji(description, emoji), hashtags: tags.slice(0, 3) },
    // Facebook : le texte tient au-dessus de la carte d'aperçu, il ne redit donc pas le titre
    facebook: { texte: accrocheFacebook({ titre, description, emoji: theme ? emoji : null, max: ed.limits.facebook }) },
    bluesky: { texte: withEmoji(clip(description, ed.limits.bluesky - 3), emoji), hashtag: tags[0] },
    threads: { texte: withEmoji(clip(description, ed.limits.threads - 3), emoji), sujet: (place?.name ?? theme?.rubrique ?? rubrique).replace(/[.&#]/g, '') },
    x: { texte: withEmoji(clip(titre, ed.limits.x - 3), emoji) },
    source: 'regles',
  };
}
