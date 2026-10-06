import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fromRoot } from '../core/config.mjs';
import { fold } from './geo.mjs';

const ed = JSON.parse(readFileSync(fromRoot('config/editorial.json'), 'utf8'));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Transforme en hashtag la première occurrence du mot du hashtag ; null s'il n'est pas dans le texte
function inlineTag(text, tag) {
  const word = String(tag ?? '').replace(/^#/, '');
  if (!word) return null;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}#])(${escapeRe(word)})(?![\\p{L}\\p{N}])`, 'iu');
  const match = text.match(re);
  if (!match || fold(match[2]) !== fold(word)) return null;
  const at = match.index + match[1].length;
  return `${text.slice(0, at)}#${match[2]}${text.slice(at + match[2].length)}`;
}

// Hashtag d'une commune, à la façon des hashtags de lieu du projet : sans accents, en CamelCase
// (« Saint-Émilion » → #SaintEmilion).
export function hashtagCommune(nom) {
  const mots = String(nom ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return mots.length ? `#${mots.map((m) => m[0].toUpperCase() + m.slice(1)).join('')}` : null;
}

// La commune nommée par l'article, en hashtag à sa place dans le texte : plus précise que la rubrique.
// Seulement si elle y figure telle quelle — jamais ajoutée en fin de texte, ce qui évite toute
// orthographe inventée (« Périgueux » accentué ne devient pas #Perigueux) — et jamais collée à une
// apostrophe : « piment d'#Espelette » est illisible, la rubrique reprend alors la main.
function avecCommune(texte, dossier) {
  const tag = dossier?.commune ? hashtagCommune(dossier.commune) : null;
  const resultat = tag ? inlineTag(texte, tag) : null;
  return resultat && !/['’]#/.test(resultat) ? resultat : null;
}

// Bluesky : trois hashtags au plus, tous posés sur des mots du texte — jamais une ligne de hashtags
// en plus (choix de l'équipe, 06/10/2026). Le lieu d'abord : la commune, puis le territoire
// (« au Pays basque » → « au #PaysBasque ») et le département ; le thème ensuite (« le patrimoine »
// → « le #patrimoine »). Sur Bluesky, les fils thématiques et la recherche se nourrissent des
// hashtags : c'est le moyen d'être vu au-delà de ses abonnés. Si aucun mot ne s'y prête, le hashtag
// de lieu de l'IA ferme le texte, comme avant.
export const MAX_HASHTAGS_BLUESKY = 3;
const THEMES_RUBRIQUES = new Set(ed.themes.map((t) => fold(t.rubrique)));
const motsDe = (s) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
export const nombreHashtags = (t) => (String(t ?? '').match(/(^|[^\p{L}\p{N}_#@/])#[\p{L}\p{N}_]+/gu) ?? []).length;

// Les valeurs à chercher dans le texte, dans l'ordre : la commune, le lieu choisi par l'IA
// (« #PaysBasque » se lit « Pays Basque »), la rubrique de lieu, le département, puis le thème.
function candidatsHashtags(dossier) {
  const rubrique = dossier?.rubrique ?? '';
  const theme = THEMES_RUBRIQUES.has(fold(rubrique));
  const deCamel = (tag) => String(tag ?? '').replace(/^#/, '').replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2');
  const valeurs = [
    dossier?.commune, deCamel(dossier?.bluesky?.hashtag), theme ? null : rubrique,
    dossier?.lieuSource?.departement, dossier?.lieu?.departement,
    theme ? rubrique : null, ...(dossier?.domaines ?? []).slice(0, 3),
  ];
  const vus = new Set();
  return valeurs.filter((v) => {
    const cle = motsDe(v).join(' ');
    if (cle.length < 3 || vus.has(cle)) return false;
    vus.add(cle);
    return true;
  });
}

// Pose un hashtag sur la première occurrence de `valeur` dans le texte, telle qu'elle y est écrite
// (à la casse et aux accents près, mots séparés par une espace ou un tiret). Jamais sur un mot collé
// à une apostrophe (« d'#Espelette » est illisible) ou à un tiret (« Haute-#Vienne »), ni déjà en
// hashtag ou en mention, ni dans un nom protégé — celui d'une entité que la mention remplacera.
// Un mot garde son orthographe (« #Périgueux », jamais un « #Perigueux » inventé) ; plusieurs mots
// s'assemblent, sans accents (« #PaysBasque », « #CharenteMaritime »). null si rien ne s'y prête.
export function taguerDansLeTexte(texte, valeur, { proteges = [] } = {}) {
  const t = String(texte ?? '');
  const cibles = motsDe(valeur);
  if (!cibles.length) return null;
  const jetons = [...t.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ debut: m.index, fin: m.index + m[0].length, cle: fold(m[0]) }));
  const lie = (i, k) => k === 0 || /^[\s  -]+$/u.test(t.slice(jetons[i + k - 1].fin, jetons[i + k].debut));
  const trouve = (mots, i) => i + mots.length <= jetons.length && mots.every((m, k) => jetons[i + k].cle === m && lie(i, k));
  const interdits = new Set();
  for (const nom of proteges) {
    const mots = motsDe(nom);
    for (let i = 0; mots.length && i < jetons.length; i++) if (trouve(mots, i)) mots.forEach((_, k) => interdits.add(i + k));
  }
  for (let i = 0; i < jetons.length; i++) {
    if (!trouve(cibles, i) || cibles.some((_, k) => interdits.has(i + k))) continue;
    const debut = jetons[i].debut;
    const fin = jetons[i + cibles.length - 1].fin;
    if (/[#@'’\p{L}\p{N}_./-]$/u.test(t.slice(0, debut)) || /^[\p{L}\p{N}_'’-]/u.test(t.slice(fin))) continue;
    const ecrit = t.slice(debut, fin);
    return t.slice(0, debut) + (cibles.length === 1 ? `#${ecrit}` : hashtagCommune(ecrit)) + t.slice(fin);
  }
  return null;
}

export function composeBluesky(dossier, { max = MAX_HASHTAGS_BLUESKY } = {}) {
  const { bluesky } = dossier;
  // Les noms que la mention remplacera ne reçoivent pas de hashtag : « Le #Hasparren Athletic Club »
  // (29/09/2026) aurait empêché la mention du club s'il avait eu un compte Bluesky.
  const proteges = (dossier.comptes?.bluesky ?? []).filter((c) => !c.thematique).map((c) => c.nom).filter(Boolean);
  let t = bluesky.texte;
  for (const valeur of candidatsHashtags(dossier)) {
    if (nombreHashtags(t) >= max) break;
    t = taguerDansLeTexte(t, valeur, { proteges }) ?? t;
  }
  return nombreHashtags(t) || !bluesky.hashtag ? t : `${t} ${bluesky.hashtag}`;
}

// X : hashtag de lieu seulement s'il figure déjà dans le texte (jamais ajouté), puis « ➡️ lien » à la ligne
export const composeXText = (dossier) => avecCommune(dossier.x.texte, dossier) ?? inlineTag(dossier.x.texte, dossier.bluesky?.hashtag) ?? dossier.x.texte;
export const composeX = (dossier, link) => `${composeXText(dossier)}\n➡️ ${link}`;

// Commentaire Facebook : formule choisie en rotation à la création du dossier, sinon stable par article, + lien
export function facebookComment(article, dossier) {
  const leads = ed.facebookCommentLeads;
  const lead = dossier?.facebook?.commentLead ?? leads[parseInt(createHash('sha1').update(String(article.guid)).digest('hex').slice(0, 6), 16) % leads.length];
  return `${lead} ${article.link}`;
}

// Formule avant le lien (réponse Bluesky, réponse X) : en rotation, stable par article et par réseau
export const linkLead = (guid, net) => {
  const leads = ed.facebookCommentLeads;
  return leads[parseInt(createHash('sha1').update(`${net}:${guid}`).digest('hex').slice(0, 6), 16) % leads.length];
};

export const nextCommentLead = (memory) => ed.facebookCommentLeads[(memory.angleIndex ?? 0) % ed.facebookCommentLeads.length];
