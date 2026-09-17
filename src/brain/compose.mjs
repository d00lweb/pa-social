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

// Bluesky : hashtag du lieu dans le texte s'il y figure, sinon ajouté à la fin
export const composeBluesky = ({ bluesky }) => inlineTag(bluesky.texte, bluesky.hashtag) ?? `${bluesky.texte} ${bluesky.hashtag}`;

// X : hashtag du lieu seulement s'il figure déjà dans le texte (jamais ajouté), puis « ➡️ lien » à la ligne
export const composeXText = ({ x, bluesky }) => inlineTag(x.texte, bluesky?.hashtag) ?? x.texte;
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
