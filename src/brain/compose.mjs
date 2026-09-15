import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fromRoot } from '../core/config.mjs';
import { fold } from './geo.mjs';

const ed = JSON.parse(readFileSync(fromRoot('config/editorial.json'), 'utf8'));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Bluesky : le hashtag remplace le mot dans le texte s'il y figure déjà, sinon il est ajouté à la fin
export function composeBluesky({ bluesky }) {
  const tag = bluesky.hashtag;
  const word = tag.replace(/^#/, '');
  const re = new RegExp(`(^|[^\\p{L}\\p{N}#])(${escapeRe(word)})(?![\\p{L}\\p{N}])`, 'iu');
  const match = bluesky.texte.match(re);
  if (match && fold(match[2]) === fold(word)) {
    const at = match.index + match[1].length;
    return `${bluesky.texte.slice(0, at)}#${match[2]}${bluesky.texte.slice(at + match[2].length)}`;
  }
  return `${bluesky.texte} ${tag}`;
}

// X : texte puis lien sur la même ligne
export const composeX = ({ x }, link) => `${x.texte} ${link}`;

// Commentaire Facebook : formule choisie en rotation à la création du dossier, sinon stable par article, + lien
export function facebookComment(article, dossier) {
  const leads = ed.facebookCommentLeads;
  const lead = dossier?.facebook?.commentLead ?? leads[parseInt(createHash('sha1').update(String(article.guid)).digest('hex').slice(0, 6), 16) % leads.length];
  return `${lead} ${article.link}`;
}

export const nextCommentLead = (memory) => ed.facebookCommentLeads[(memory.angleIndex ?? 0) % ed.facebookCommentLeads.length];
