import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { splitAround } from '../brain/editorial.mjs';
import { composeXText } from '../brain/compose.mjs';
import { loadSource, cropTo, X_FORMAT } from '../media/crop.mjs';
import { createRenderer } from '../media/render.mjs';
import { send, sendDocument } from './telegram.mjs';
import { esc } from './preview.mjs';
import { GuardError } from '../core/errors.mjs';
import { config, fromRoot } from '../core/config.mjs';

// X sans API (payante) : kit envoyé sur Telegram, publication à la main
export const id = 'x';
export const publishedLabel = '📨 <b>Kit X envoyé</b>, à publier depuis Telegram';

// Post natif sans lien (les posts avec lien sont quasi invisibles sur X) ; le lien part en réponse
export const intentUrl = (text) => `https://x.com/intent/post?${new URLSearchParams({ text })}`;

export async function prepare(article, { dossier, renderer: shared, log = console.log } = {}) {
  if (!article.image) throw new GuardError(article, ['aucune image (enclosure) dans le flux']);
  const source = await loadSource(article.image);
  const renderer = shared ?? (await createRenderer());
  let visual;
  try {
    const photo = await cropTo(source, X_FORMAT);
    visual = await renderer.render('x', {
      rubrique: dossier.rubrique,
      ...splitAround(dossier.visuel.titre, dossier.visuel.surlignage),
      photo: photo.buffer,
      darken: photo.darken,
      variant: config.channels.x?.hideOuestFrance ? 'no-of' : '',
    });
  } finally {
    if (!shared) await renderer.close();
  }
  log(`   Visuel X : titre ${visual.title.size}px${visual.title.fits ? '' : ' (NE TIENT PAS)'}`);
  if (!visual.title.fits) throw new GuardError(article, ['titre trop long pour le visuel X (44 px sur 3 lignes)']);

  const stamp = new Date(article.date).toISOString().slice(0, 10).replaceAll('-', '');
  const name = `${stamp}-${createHash('sha1').update(article.guid).digest('hex').slice(0, 8)}-x.jpg`;
  await mkdir(fromRoot('out'), { recursive: true });
  await writeFile(fromRoot('out', name), visual.buffer);

  const text = composeXText(dossier);
  return { article, dossier, files: [{ name, buffer: visual.buffer }], text, link: article.link, intent: intentUrl(text) };
}

export function kitMessage(pkg) {
  return [
    `🐦 <b>Kit X</b> · ${esc(pkg.article.title)}`,
    '',
    `<b>1. Post</b> (${[...pkg.text].length}/280, touche pour copier) :`,
    `<code>${esc(pkg.text)}</code>`,
    '',
    '<b>2. Réponse à ton post</b> (touche pour copier) :',
    `<code>${esc(`L’article complet 👉 ${pkg.link}`)}</code>`,
    '',
    'Enregistre l’image ci-dessus, touche « Publier sur X » (texte pré-rempli), joins l’image et publie. Puis réponds à ton post avec le lien : sur X, un post avec lien est quasi invisible.',
  ].join('\n');
}

export async function publish(pkg) {
  await sendDocument(pkg.files[0].buffer, pkg.files[0].name);
  await send(kitMessage(pkg), { reply_markup: JSON.stringify({ inline_keyboard: [[{ text: '✍️ Publier sur X', url: pkg.intent }]] }) });
  return { mediaId: 'kit-telegram' };
}
