import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { splitAround } from '../brain/editorial.mjs';
import { composeX } from '../brain/compose.mjs';
import { loadSource, cropTo, toMetaJpeg, SLIDE } from '../media/crop.mjs';
import { createRenderer } from '../media/render.mjs';
import { send, sendDocument } from './telegram.mjs';
import { esc } from './preview.mjs';
import { GuardError } from '../core/errors.mjs';
import { config, fromRoot } from '../core/config.mjs';

// X sans API (payante) : kit envoyé sur Telegram, publication à la main
export const id = 'x';
export const publishedLabel = '📨 <b>Kit X envoyé</b>, à publier depuis Telegram';
const SIZE = [1080, 1350]; // 4:5, format choisi pour X

// Lien de rédaction pré-remplie : texte + « ➡️ lien » à la ligne
export const intentUrl = (text) => `https://x.com/intent/post?${new URLSearchParams({ text })}`;

// Longueur comptée par X : lien = 23, emoji = 2
export const xLength = (text) => {
  const withoutLinks = String(text).replace(/https?:\/\/\S+/g, 'x'.repeat(23));
  return [...withoutLinks].reduce((n, ch) => n + (/\p{Extended_Pictographic}/u.test(ch) ? 2 : /️/.test(ch) ? 0 : 1), 0);
};

export async function prepare(article, { dossier, renderer: shared, log = console.log } = {}) {
  if (!article.image) throw new GuardError(article, ['aucune image (enclosure) dans le flux']);
  const source = await loadSource(article.image);
  const renderer = shared ?? (await createRenderer());
  let visual;
  try {
    const photo = await cropTo(source, SLIDE);
    visual = await renderer.render('slide1', {
      rubrique: dossier.rubrique,
      ...splitAround(dossier.visuel.titre, dossier.visuel.surlignage),
      photo: photo.buffer,
      darken: photo.darken,
      variant: config.channels.x?.hideOuestFrance ? 'no-of' : '',
    });
  } finally {
    if (!shared) await renderer.close();
  }
  if (!visual.title.fits) throw new GuardError(article, ['titre trop long pour le visuel (44 px sur 4 lignes)']);
  const buffer = await toMetaJpeg(await sharp(visual.buffer).resize(SIZE[0], SIZE[1], { kernel: 'lanczos3' }).png().toBuffer());

  const stamp = new Date(article.date).toISOString().slice(0, 10).replaceAll('-', '');
  const name = `${stamp}-${createHash('sha1').update(article.guid).digest('hex').slice(0, 8)}-x.jpg`;
  await mkdir(fromRoot('out'), { recursive: true });
  await writeFile(fromRoot('out', name), buffer);
  log(`   Visuel X : ${SIZE.join('×')}`);

  const text = composeX(dossier, article.link);
  return { article, dossier, files: [{ name, buffer }], text, link: article.link, intent: intentUrl(text) };
}

export function kitMessage(pkg) {
  return [
    `🐦 <b>Kit X</b> · ${esc(pkg.article.title)}`,
    '',
    `<b>Post</b> (${xLength(pkg.text)}/280, touche pour copier) :`,
    `<code>${esc(pkg.text)}</code>`,
    '',
    'Enregistre l’image ci-dessus, touche « Publier sur X » (texte et lien déjà remplis), joins l’image et publie.',
  ].join('\n');
}

export async function publish(pkg) {
  await sendDocument(pkg.files[0].buffer, pkg.files[0].name);
  await send(kitMessage(pkg), { reply_markup: JSON.stringify({ inline_keyboard: [[{ text: '✍️ Publier sur X', url: pkg.intent }]] }) });
  return { mediaId: 'kit-telegram' };
}
