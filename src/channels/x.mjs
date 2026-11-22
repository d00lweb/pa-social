import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { splitAround } from '../brain/editorial.mjs';
import { composeX, composeXText, linkLead } from '../brain/compose.mjs';
import { loadSource, cropTo, toMetaJpeg, SLIDE } from '../media/crop.mjs';
import { createRenderer } from '../media/render.mjs';
import { envoyerMessage, sendDocument } from './telegram.mjs';
import { kitX, longueurVisible, LEGENDE_MAX } from './messages.mjs';
import { unSeul } from './problemes.mjs';
import { GuardError } from '../core/errors.mjs';
import { config, fromRoot } from '../core/config.mjs';

// X sans API (payante) : kit envoyé sur Telegram, publication à la main
export const id = 'x';
// le kit part sur Telegram : pas de publication à confirmer (sert au journal du passage)
export const publishedLabel = 'Kit X envoyé';
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

// Le kit en UN message (22/11/2026) : l'image, la consigne, les textes et un bouton par élément à
// copier. Avant, jusqu'à neuf messages par article (image, sommaire, un message par élément, comptes à
// chercher). Les comptes à chercher sont ceux que les autres réseaux ont confirmés : X n'ayant pas
// d'API gratuite, leur pseudo reste à trouver à la main, souvent le même qu'ailleurs.
export function kitDonnees(pkg) {
  const comptes = (pkg.dossier?.comptes?.x ?? []).slice(0, 3);
  const aChercher = [...(pkg.dossier?.comptes?.instagram ?? []), ...(pkg.dossier?.comptes?.bluesky ?? [])]
    .filter((c) => c?.handle && !comptes.some((x) => x.handle === c.handle))
    .filter((c, i, t) => t.findIndex((x) => (x.nom ?? x.handle) === (c.nom ?? c.handle)) === i)
    .slice(0, 3)
    .map((c) => ({ nom: c.nom ?? c.handle, handle: c.handle }));
  const lieu = pkg.dossier?.lieuNom ?? pkg.dossier?.lieu?.nom ?? null;
  const commune = pkg.dossier?.commune ?? null;
  return {
    titre: pkg.article.title,
    mode: pkg.mode ?? 'image',
    texte: pkg.text,
    longueur: xLength(pkg.text),
    reponse: pkg.replyText ?? null,
    intent: pkg.intent,
    comptes,
    aChercher,
    lieu,
    lieuSecours: commune && commune !== lieu ? commune : null,
    alt: pkg.dossier?.visuel?.texte_alternatif ?? null,
  };
}

export async function publish(pkg) {
  const message = kitX(kitDonnees(pkg));
  await unSeul(`kit-x:${pkg.article.guid}`, async () => {
    // une légende d'image tient en 1 024 caractères : au-delà (ou si Telegram la refuse), l'image puis le kit
    if (longueurVisible(message.text) <= LEGENDE_MAX) {
      try {
        return await sendDocument(pkg.files[0].buffer, pkg.files[0].name, { caption: message.text, reply_markup: message.reply_markup });
      } catch (e) {
        if (!/caption|too long/i.test(e.message)) throw e;
      }
    }
    await sendDocument(pkg.files[0].buffer, pkg.files[0].name, { caption: message.text.split('\n')[0] });
    return envoyerMessage(message);
  });
  return { mediaId: 'kit-telegram' };
}
