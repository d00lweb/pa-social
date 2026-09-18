import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { splitAround } from '../brain/editorial.mjs';
import { composeX, composeXText, linkLead } from '../brain/compose.mjs';
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

// Rotation des 3 formats, stable par article
export const FORMATS = config.channels.x?.formats ?? ['image', 'lien', 'reponse'];
const hashNum = (s) => parseInt(createHash('sha1').update(String(s)).digest('hex').slice(0, 8), 16);
export const modeFor = (guid, formats = FORMATS) => formats[hashNum(guid) % formats.length];

const LIBELLES = {
  image: 'image + lien dans le post',
  lien: 'lien seul, X affiche l’aperçu',
  reponse: 'image, lien en réponse',
};
const CONSIGNES = {
  image: 'Enregistre l’image ci-dessus, touche « Publier sur X », joins l’image et publie.',
  lien: 'Touche « Publier sur X » et publie sans joindre l’image : X affiche l’aperçu du lien. Le visuel reste fourni si tu le préfères.',
  reponse: 'Enregistre l’image, touche « Publier sur X », joins l’image et publie. Réponds ensuite à ton propre post avec le second texte.',
};

// Lien de rédaction pré-remplie : texte + « ➡️ lien » à la ligne
export const intentUrl = (text) => `https://x.com/intent/post?${new URLSearchParams({ text })}`;

// Longueur comptée par X : lien = 23, emoji = 2
export const xLength = (text) => {
  const withoutLinks = String(text).replace(/https?:\/\/\S+/g, 'x'.repeat(23));
  return [...withoutLinks].reduce((n, ch) => n + (/\p{Extended_Pictographic}/u.test(ch) ? 2 : /️/.test(ch) ? 0 : 1), 0);
};

export async function prepare(article, { dossier, renderer: shared, log = console.log } = {}) {
  const mode = modeFor(article.guid);

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
  log(`   Kit X : ${LIBELLES[mode]}, visuel ${SIZE.join('×')}`);

  // « image » : le lien suit le texte ; « reponse » : le lien part dans une réponse
  const text = mode === 'image' ? composeX(dossier, article.link) : composeXText(dossier);
  const replyText = mode === 'reponse' ? `${linkLead(article.guid, 'x')} ${article.link}` : null;
  return { article, dossier, mode, files: [{ name, buffer }], text, replyText, link: article.link, intent: intentUrl(text) };
}

// Un message par élément : chacun se copie d'une seule touche, sans rien sélectionner à la main
export function kitMessages(pkg) {
  const mode = pkg.mode ?? 'image';
  const comptes = (pkg.dossier?.comptes?.x ?? []).slice(0, 2);
  const lieu = pkg.dossier?.lieu;

  const messages = [
    [
      `🐦 <b>Kit X</b> · ${esc(pkg.article.title)}`,
      `<i>Format : ${LIBELLES[mode] ?? mode}</i>`,
      '',
      CONSIGNES[mode] ?? '',
      comptes.length ? 'Les comptes se taguent sur l’image : ils ne comptent pas dans les 280 caractères.' : '',
    ].filter(Boolean).join('\n'),
    `📝 <b>Texte du post</b> (${xLength(pkg.text)}/280)\n<code>${esc(pkg.text)}</code>`,
  ];
  if (pkg.replyText) messages.push(`💬 <b>Réponse à publier juste après</b>\n<code>${esc(pkg.replyText)}</code>`);
  for (const c of comptes) messages.push(`👤 <b>Compte à taguer</b> · ${esc(c.nom)}\n<code>@${esc(c.handle)}</code>`);

  // Aucun compte X connu : on propose celui vérifié sur Instagram, en disant clairement ce que c'est
  if (!comptes.length) {
    for (const c of (pkg.dossier?.comptes?.instagram ?? []).slice(0, 2)) {
      messages.push(`👤 <b>Piste</b> · ${esc(c.nom)} — compte vérifié sur Instagram, à confirmer sur X\n<code>@${esc(c.handle)}</code>`);
    }
  }
  if (lieu) messages.push(`📍 <b>Lieu à taguer</b>\n<code>${esc(lieu.nom)}</code>`);
  return messages;
}

export async function publish(pkg) {
  if (pkg.files.length) await sendDocument(pkg.files[0].buffer, pkg.files[0].name);
  const [consignes, ...elements] = kitMessages(pkg);
  await send(consignes, { reply_markup: JSON.stringify({ inline_keyboard: [[{ text: '✍️ Publier sur X', url: pkg.intent }]] }) });
  // un message par élément : texte, réponse, comptes, lieu — chacun se copie seul
  for (const message of elements) await send(message);
  return { mediaId: 'kit-telegram' };
}
