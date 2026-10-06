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

// Bluesky : hashtag de la commune s'il se place dans le texte, sinon celui du lieu de la rubrique
// dans le texte s'il y figure, sinon ajouté à la fin
export const composeBluesky = (dossier) => {
  const { bluesky } = dossier;
  return avecCommune(bluesky.texte, dossier) ?? inlineTag(bluesky.texte, bluesky.hashtag) ?? `${bluesky.texte} ${bluesky.hashtag}`;
};

// Bluesky : jusqu'à deux hashtags de plus que celui du lieu, sur une ligne à part — le territoire
// (Pays basque, département) et le thème (patrimoine, festival…). Sur Bluesky, les fils
// thématiques et la recherche se nourrissent des hashtags : avec quelques abonnés seulement,
// c'est le moyen d'être vu au-delà d'eux. Jamais un hashtag déjà présent dans le texte.
const THEMES_RUBRIQUES = new Set(ed.themes.map((t) => fold(t.rubrique)));
export function hashtagsBluesky(dossier, texte = '') {
  const presents = new Set([...String(texte).matchAll(/#([\p{L}\p{N}]+)/gu)].map((m) => fold(m[1])));
  const rubriqueLieu = dossier?.rubrique && !THEMES_RUBRIQUES.has(fold(dossier.rubrique)) ? dossier.rubrique : null;
  const rubriqueTheme = dossier?.rubrique && THEMES_RUBRIQUES.has(fold(dossier.rubrique)) ? dossier.rubrique : null;
  const commune = fold(dossier?.commune ?? '');
  const tags = [];
  // un candidat par rôle, le premier qui ne fait pas doublon : territoire, puis thème
  for (const candidats of [
    [rubriqueLieu, dossier?.lieuSource?.departement, dossier?.lieu?.departement],
    [rubriqueTheme, ...(dossier?.domaines ?? []).slice(0, 2)],
  ]) {
    for (const valeur of candidats) {
      const tag = valeur ? hashtagCommune(valeur) : null;
      const cle = tag ? fold(tag.slice(1)) : null;
      if (!tag || tag.length < 4 || cle === commune || presents.has(cle) || tags.some((t) => fold(t.slice(1)) === cle)) continue;
      tags.push(tag);
      break;
    }
  }
  return tags;
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
