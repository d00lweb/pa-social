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

// Une date n'est jamais une accroche : « Le 30 septembre 2026, plus de 200 danseurs… » commence par
// l'information la moins engageante, et l'article la donne de toute façon. On retire les jours, les
// mois et les années — jamais les autres nombres, qui font souvent tout l'intérêt (200 danseurs, 29 €).
const MOIS = 'janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre';
export function sansDate(texte) {
  return String(texte ?? '')
    // « mai » ne doit pas manger « mais » : la fin du mois est une frontière de mot
    .replace(new RegExp(`\\b(?:\\d{1,2}(?:er)?\\s+)?(?:${MOIS})\\b(?:\\s+\\d{4})?`, 'gi'), '')
    .replace(/\b(?:en|dès|depuis)\s+(?:19|20)\d{2}\b/gi, '')
    // la préposition laissée seule par la date part avec elle : « À partir du , le musée… »
    // (pas de \b ici : il ne reconnaît pas le « À » accenté en tête de phrase)
    .replace(/(^|[^\p{L}])(?:à partir (?:du|de)|à compter du|dès le|dès|depuis le|depuis la|depuis|le|du)\s*(?=[,.;:])/giu, '$1')
    .replace(/\s*,\s*,/g, ',')
    .replace(/^[\s,;:–—-]+/, '')
    .replace(/\s{2,}/g, ' ')
    // espace en trop devant la virgule ou le point seulement : en français, « ; : ! ? » gardent la leur
    .replace(/\s+([,.])/g, '$1')
    .replace(/^(.)/, (c) => c.toLocaleUpperCase('fr-FR'))
    .trim();
}

// Emoji choisi sur le mot du sujet (danseuses, dauphin, château…), sinon sur le thème, sinon aucun.
// Un 📍 générique ne dit rien : mieux vaut ne rien mettre.
export function emojiPour(article, theme) {
  // l'ordre du tableau fait la priorité : le sujet (danseuses, dauphin) avant l'événement (record)
  const texte = fold(`${article.title ?? ''} ${article.description ?? ''}`);
  const trouve = Object.keys(ed.emojiMots ?? {}).find((m) => texte.includes(fold(m)));
  return trouve ? ed.emojiMots[trouve] : (theme ? ed.fallbackEmojis[theme.rubrique] : null);
}

// Réseaux où le lien devient une carte d'aperçu (Facebook, X) : cette carte affiche déjà le titre
// juste sous le texte. Répéter ce titre n'apporte rien et n'ajoute aucune raison de cliquer — c'est
// le reproche fait au repli du 23/09/2026. On part donc de la description, en sautant sa première
// phrase quand elle redit le titre, et l'emoji n'est posé que si un thème a été reconnu : un 📍
// générique vaut moins que pas d'emoji du tout.
export function accroche({ titre, description, emoji, max }) {
  const phrases = String(description ?? '').split(/(?<=[.!?…])\s+/).map((p) => p.trim()).filter(Boolean);
  const memeQueTitre = (p) => {
    const mots = (s) => new Set(fold(s).split(/[^\p{L}\p{N}]+/u).filter((m) => m.length > 3));
    const t = mots(titre);
    const communs = [...mots(p)].filter((m) => t.has(m)).length;
    return t.size && communs / t.size >= 0.6;
  };
  // parmi les phrases qui ne redisent pas le titre, on garde celle qui accroche : un renversement
  // (« pourtant », « mais »), puis un chiffre ou une date, sinon la première
  const candidates = phrases.filter((p) => !memeQueTitre(p)).map(sansDate).filter(Boolean);
  const note = (p) => (/(^|\s)(pourtant|mais|en revanche|sauf|désormais|pour la première fois)(\s|,)/i.test(p) ? 2 : 0) + (/\d/.test(p) ? 1 : 0);
  // Dernier recours : aucune phrase ne se distingue du titre. Plutôt que de le redire — la carte
  // d'aperçu l'affiche déjà juste en dessous —, on prend la phrase qui apporte le plus de mots
  // nouveaux. Le titre lui-même ne sert que si la description est vide.
  const apport = (p) => {
    const mots = (s) => new Set(fold(s).split(/[^\p{L}\p{N}]+/u).filter((m) => m.length > 3));
    const t = mots(titre);
    return [...mots(p)].filter((m) => !t.has(m)).length;
  };
  const repli = phrases.map(sansDate).filter(Boolean).sort((a, b) => apport(b) - apport(a))[0];
  const utile = candidates.slice().sort((a, b) => note(b) - note(a))[0] ?? repli ?? sansDate(titre);
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
  const emoji = emojiPour(article, theme);

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
    facebook: { texte: accroche({ titre, description, emoji, max: ed.limits.facebook }) },
    bluesky: { texte: withEmoji(clip(description, ed.limits.bluesky - 3), emoji), hashtag: tags[0] },
    threads: { texte: withEmoji(clip(description, ed.limits.threads - 3), emoji), sujet: (place?.name ?? theme?.rubrique ?? rubrique).replace(/[.&#]/g, '') },
    // X affiche lui aussi une carte de lien avec le titre : le texte doit apporter autre chose
    x: { texte: accroche({ titre, description, emoji, max: ed.limits.x }) },
    source: 'regles',
  };
}
