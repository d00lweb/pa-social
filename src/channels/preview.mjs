import { NAMES } from '../core/control.mjs';
import { composeX } from '../brain/compose.mjs';
import { postText, modeFor } from './bluesky.mjs';

// Un seul échappement pour tout le projet : il vit dans messages.mjs, avec le reste des règles.
export { esc } from './messages.mjs';
import { esc } from './messages.mjs';
const clip = (s, n) => ([...String(s)].length <= n ? String(s) : `${[...String(s)].slice(0, n - 1).join('')}…`);

// Message Telegram d'aperçu : textes de chaque réseau (citations repliables), heure prévue, statut
export function buildPreviewText({ article, dossier, caption, items, published = [], when }) {
  const planned = Object.fromEntries(items.map((i) => [i.channel, i]));
  const awaiting = items.some((i) => i.status === 'awaiting');
  const blocks = [
    ['instagram', caption],
    ['facebook', `${dossier.facebook.texte}\n[carte d’aperçu : ${article.link}]`],
    ['bluesky', `${postText(dossier, modeFor(article.guid))}\n[${{ card: 'carte de lien', image: 'image 4:5, lien sur « Lire l’article »', reply: 'image 4:5, lien en réponse' }[modeFor(article.guid)]}]`],
    ['threads', `${dossier.threads.texte}${dossier.threads.sujet ? `\n[sujet : ${dossier.threads.sujet}]` : ''}`],
    ['x', composeX(dossier, article.link)],
  ];
  for (const limit of [900, 600, 400, 250]) {
    const parts = [
      `${awaiting ? '📰 <b>À valider</b>' : '🗓 <b>Programmé</b>'} · ${esc(dossier.rubrique)}`,
      `<b>${esc(article.title)}</b>`,
      esc(article.link),
      '',
      ...blocks.map(([net, text]) => {
        const item = planned[net];
        const kit = net === 'x' ? 'kit Telegram ' : '';
        const status = item
          ? (item.status === 'awaiting' ? `à valider, puis ${kit}${when(item.dueAt)}` : `${kit}${when(item.dueAt)}`)
          : published.includes(net) ? 'déjà publié' : 'réseau pas encore actif';
        return `<b>${NAMES[net]}</b> · <i>${esc(status)}</i>\n<blockquote expandable>${esc(clip(text, limit))}</blockquote>`;
      }),
      `<i>Rédaction : ${dossier.source === 'ia' ? 'IA' : 'règles de secours'}${dossier.nature ? ` · ${dossier.nature}` : ''}${dossier.sensible ? ' · sujet sensible' : ''}</i>`,
    ];
    const text = parts.join('\n');
    if (text.length <= 4000) return text;
  }
  return `${awaiting ? '📰 <b>À valider</b>' : '🗓 <b>Programmé</b>'}\n<b>${esc(article.title)}</b>\n${esc(article.link)}`;
}

export function previewButtons(id, awaiting) {
  return awaiting
    ? [[{ text: '✅ Valider', callback_data: `v:${id}` }, { text: '❌ Refuser', callback_data: `n:${id}` }], [{ text: '🔁 Régénérer les textes', callback_data: `g:${id}` }]]
    : [[{ text: '❌ Annuler', callback_data: `n:${id}` }, { text: '🔁 Régénérer', callback_data: `g:${id}` }]];
}
