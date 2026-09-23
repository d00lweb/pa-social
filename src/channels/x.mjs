import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { splitAround } from '../brain/editorial.mjs';
import { composeX, composeXText, linkLead } from '../brain/compose.mjs';
import { loadSource, cropTo, toMetaJpeg, SLIDE } from '../media/crop.mjs';
import { createRenderer } from '../media/render.mjs';
import { send, sendCopie, sendDocument } from './telegram.mjs';
import { esc } from './messages.mjs';
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

// Lien de rédaction pré-remplie : texte + « ➡️ lien » à la ligne.
// Le texte est débarrassé de tout blanc de bordure — un saut de ligne en tête ferait commencer le
// post par une ligne vide. Encodage en %20 plutôt qu'en « + » : tous les clients ne relisent pas
// le « + » comme une espace.
export const intentUrl = (text) =>
  `https://x.com/intent/post?text=${encodeURIComponent(String(text).trim())}`;

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

  // « image » et « lien » : l'adresse suit le texte — sans elle, le format « lien seul » ne
  // produirait aucun aperçu, ce qui est pourtant tout son intérêt. « reponse » : elle part à part.
  const text = mode === 'reponse' ? composeXText(dossier) : composeX(dossier, article.link);
  const replyText = mode === 'reponse' ? `${linkLead(article.guid, 'x')} ${article.link}` : null;
  return { article, dossier, mode, files: [{ name, buffer }], text, replyText, link: article.link, intent: intentUrl(text) };
}

// Un message par élément, et chaque message ne contient QUE ce qu'il faut copier : l'étiquette est
// portée par le bouton. Auparavant le titre (« 📝 Texte du post (246/280) ») était dans le message :
// une copie le ramenait avec, il fallait l'effacer dans X, et la ligne vide laissée derrière faisait
// commencer le post par un saut de ligne. Le sommaire annonce l'ordre une fois pour toutes.
export function kitMessages(pkg) {
  const mode = pkg.mode ?? 'image';
  const comptes = (pkg.dossier?.comptes?.x ?? []).slice(0, 2);
  const pistes = comptes.length ? [] : (pkg.dossier?.comptes?.instagram ?? []).slice(0, 2);
  const nomLieu = pkg.dossier?.lieuNom ?? pkg.dossier?.lieu?.nom;
  const commune = pkg.dossier?.commune;
  const alt = pkg.dossier?.visuel?.texte_alternatif;

  const elements = [
    { etiquette: `Copier le texte du post (${xLength(pkg.text)}/280)`, valeur: pkg.text, sommaire: 'le texte du post' },
    pkg.replyText && { etiquette: 'Copier la réponse', valeur: pkg.replyText, sommaire: 'la réponse à publier juste après' },
    ...comptes.map((c) => ({ etiquette: `Copier @${c.handle}`, valeur: `@${c.handle}`, sommaire: `le compte de ${c.nom}` })),
    ...pistes.map((c) => ({ etiquette: `Copier @${c.handle}`, valeur: `@${c.handle}`, sommaire: `une piste : ${c.nom}, vérifié sur Instagram, à confirmer sur X` })),
    nomLieu && { etiquette: 'Copier le lieu', valeur: nomLieu, sommaire: 'le lieu à taguer', note: commune && commune !== nomLieu ? `S'il n'apparaît pas sur X, essayer : ${commune}` : null },
    alt && { etiquette: 'Copier la description', valeur: alt, sommaire: 'la description de l’image (bouton « ALT » sur X)' },
  ].filter(Boolean);

  const sommaire = [
    `🐦 <b>Kit X</b> · ${esc(pkg.article.title)}`,
    `<i>Format : ${LIBELLES[mode] ?? mode}</i>`,
    '',
    CONSIGNES[mode] ?? '',
    comptes.length ? 'Les comptes se taguent sur l’image : ils ne comptent pas dans les 280 caractères.' : '',
    '',
    `<i>Ci-dessous, dans l’ordre : ${elements.map((e) => e.sommaire).join(' · ')}. Chaque message ne contient que le texte à copier, le bouton le met dans le presse-papier.</i>`,
  ].filter(Boolean).join('\n');

  return { sommaire, elements };
}

export async function publish(pkg) {
  if (pkg.files.length) await sendDocument(pkg.files[0].buffer, pkg.files[0].name);
  const { sommaire, elements } = kitMessages(pkg);
  await send(sommaire, { reply_markup: JSON.stringify({ inline_keyboard: [[{ text: '✍️ Publier sur X', url: pkg.intent }]] }) });
  for (const e of elements) await sendCopie(e.etiquette, e.valeur, { note: e.note ?? null });
  return { mediaId: 'kit-telegram' };
}
