import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { splitAround } from '../brain/editorial.mjs';
import { facebookComment } from '../brain/compose.mjs';
import { loadSource, cropTo, SLIDE } from '../media/crop.mjs';
import { createRenderer } from '../media/render.mjs';
import { uploadFiles, assertPublic } from '../storage/ftp.mjs';
import { GraphError } from './meta-graph.mjs';
import { alert } from './telegram.mjs';
import { alerteFacebookCommentaire } from './messages.mjs';
import { jitter } from '../core/scheduler.mjs';
import { GuardError } from '../core/errors.mjs';
import { config, fromRoot } from '../core/config.mjs';
import { formatFacebook, lienMarque } from '../core/formats-facebook.mjs';

// Facebook : deux formats, choisis par jour (src/core/formats-facebook.mjs, test du 23/11 au 13/12/2026).
//  - lien  : une phrase, et sous elle la carte d'aperçu que Facebook construit depuis l'article ;
//  - photo : le visuel 4:5 avec le titre, la phrase, puis le lien en premier commentaire 1 à 3 min après.
// Le lien porte le format (utm_campaign=fb-lien ou fb-photo) : le site sait d'où vient le lecteur.
export const id = 'facebook';

const DEFAULT_PUBLIC = 'https://passion-aquitaine.ouest-france.fr/social';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = () => (process.env.PUBLIC_BASE_URL || DEFAULT_PUBLIC).replace(/\/+$/, '');

function client({ token, version }) {
  const racine = `https://graph.facebook.com/${version || 'v23.0'}`;
  return async function call(chemin, params = {}) {
    const res = await fetch(`${racine}/${chemin}`, { method: 'POST', body: new URLSearchParams({ ...params, access_token: token }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new GraphError(json.error ?? { message: 'réponse illisible' }, res.status);
    return json;
  };
}

// Le permalien ne se devine pas : dans le lien rendu par Meta, l'identifiant de page diffère
// de FB_PAGE_ID. Une URL reconstruite à la main serait fausse, il faut la demander.
async function lienDuPost(postId, { token, version }) {
  const params = new URLSearchParams({ fields: 'permalink_url', access_token: token });
  const res = await fetch(`https://graph.facebook.com/${version || 'v23.0'}/${postId}?${params}`, { signal: AbortSignal.timeout(15000) });
  const json = await res.json().catch(() => ({}));
  return json.permalink_url ?? null;
}

// Ce qui part réellement à Facebook. Fonction pure : c'est elle que les tests vérifient.
export function parametres(pkg) {
  const params = pkg.mode === 'photo'
    ? { url: pkg.imageUrl, caption: pkg.text, published: 'true' }
    : { message: pkg.text, link: pkg.lien, published: 'true' };
  // description pour les lecteurs d'écran : Facebook la conserve telle quelle
  if (pkg.mode === 'photo' && pkg.alt) params.alt_text_custom = pkg.alt;
  if (pkg.lieu?.id) params.place = String(pkg.lieu.id);
  return params;
}

// Texte de la photo : la phrase, puis la ligne qui dit où est l'article
export const textePhoto = (texte, canal = config.channels.facebook) => (canal?.ligneCommentaire ? `${texte}\n${canal.ligneCommentaire}` : texte);

const nomFichier = (article, suffixe) => {
  const stamp = new Date(article.date).toISOString().slice(0, 10).replaceAll('-', '');
  return `${stamp}-${createHash('sha1').update(article.guid).digest('hex').slice(0, 8)}-${suffixe}.jpg`;
};

// Le visuel 4:5 : celui du carrousel Instagram s'il est déjà en ligne, sinon rendu ici (même gabarit)
async function visuel(article, dossier, { history, renderer: shared, log }) {
  const insta = history.find((e) => e.guid === article.guid && e.channel === 'instagram')?.apercu?.image;
  if (insta && insta.startsWith(`${base()}/`)) {
    try {
      await assertPublic(insta);
      log('   Facebook : visuel du carrousel Instagram repris');
      return { imageUrl: insta, files: [] };
    } catch (e) {
      log(`   Visuel Instagram injoignable (${e.message}) : nouveau rendu`);
    }
  }
  if (!article.image) throw new GuardError(article, ['aucune image (enclosure) dans le flux']);
  const source = await loadSource(article.image);
  const renderer = shared ?? (await createRenderer());
  let rendu;
  try {
    const photo = await cropTo(source, SLIDE);
    rendu = await renderer.render('slide1', {
      rubrique: dossier.rubrique,
      ...splitAround(dossier.visuel.titre, dossier.visuel.surlignage),
      photo: photo.buffer,
      darken: photo.darken,
    });
  } finally {
    if (!shared) await renderer.close();
  }
  if (!rendu.title.fits) throw new GuardError(article, ['titre trop long pour le visuel Facebook']);
  const name = nomFichier(article, 'fb');
  await mkdir(fromRoot('out'), { recursive: true });
  await writeFile(fromRoot('out', name), rendu.buffer);
  return { imageUrl: `${base()}/${name}`, files: [{ name, buffer: rendu.buffer }] };
}

// `quand` : l'instant de la publication, qui fixe le format du jour ; `fabriquer` : remplaçable par les tests
export async function prepare(article, { dossier, history = [], quand = Date.now(), canal = config.channels.facebook, renderer, log = console.log, fabriquer = visuel } = {}) {
  const texte = dossier.facebook?.texte?.trim();
  if (!texte) throw new GuardError(article, ['texte Facebook vide']);
  // le lien est porté par la carte d'aperçu ou par le commentaire : dans le texte, il ferait doublon
  if (/https?:\/\//.test(texte)) throw new GuardError(article, ['lien dans le texte Facebook : il est ajouté par la carte d’aperçu ou le commentaire']);
  // un retour à la ligne pousse la fin du texte derrière « Voir plus » : une seule phrase, d'un bloc
  if (/[\r\n]/.test(texte)) throw new GuardError(article, ['retour à la ligne dans le texte Facebook : une seule phrase']);
  if (!article.link) throw new GuardError(article, ['aucun lien d’article à publier']);

  const lieu = dossier.lieu ?? null;
  const commun = { article, dossier, lieu };
  const lien = () => {
    log(`   Facebook : lien + aperçu, ${[...texte].length} caractères${lieu ? `, lieu ${lieu.nom}` : ''}`);
    return { ...commun, mode: 'lien', text: texte, lien: lienMarque(article.link, 'lien', canal), files: [] };
  };
  if (formatFacebook(quand, canal) !== 'photo') return lien();

  let image;
  try {
    image = await fabriquer(article, dossier, { history, renderer, log });
  } catch (err) {
    // pas de visuel possible (image absente, titre trop long) : l'article part quand même, en lien
    if (!(err instanceof GuardError)) throw err;
    log(`   Facebook : photo impossible (${err.problems?.join(', ') ?? err.message}), publication avec lien`);
    return lien();
  }
  const caption = textePhoto(texte, canal);
  const comment = facebookComment({ ...article, link: lienMarque(article.link, 'photo', canal) }, dossier);
  log(`   Facebook : photo 4:5, lien en commentaire, ${[...caption].length} caractères${lieu ? `, lieu ${lieu.nom}` : ''}`);
  return { ...commun, mode: 'photo', text: caption, comment, alt: dossier.visuel?.texte_alternatif ?? null, ...image };
}

// Dépôt FTP du visuel rendu ici, puis vérification de l'URL publique : Meta la télécharge
export async function deposer(pkg) {
  if (pkg.files?.length) {
    await uploadFiles(pkg.files, {
      host: process.env.SFTP_HOST,
      user: process.env.SFTP_USER,
      pass: process.env.SFTP_PASS,
      dir: process.env.SFTP_DIR,
    });
  }
  await assertPublic(pkg.imageUrl);
}

export async function publish(pkg, { channel } = {}) {
  const call = client({ token: process.env.FB_TOKEN, version: process.env.GRAPH_VERSION });
  const pageId = process.env.FB_PAGE_ID;
  const photo = pkg.mode === 'photo';
  if (photo) await deposer(pkg);
  const params = parametres(pkg);
  const chemin = `${pageId}/${photo ? 'photos' : 'feed'}`;

  let reponse;
  try {
    reponse = await call(chemin, params);
  } catch (err) {
    // un lieu devenu invalide ne doit pas empêcher la publication
    if (!params.place) throw err;
    console.error(`   Lieu abandonné : ${err.message}`);
    delete params.place;
    reponse = await call(chemin, params);
  }
  // photo : `id` est la photo, `post_id` la publication de la Page (celle qu'on commente et qu'on mesure)
  const postId = reponse.post_id ?? reponse.id;
  const lien = await lienDuPost(postId, { token: process.env.FB_TOKEN, version: process.env.GRAPH_VERSION }).catch(() => null);

  if (photo) {
    // Le lien part en commentaire, 1 à 3 min plus tard. Un échec ici ne doit surtout pas faire
    // réessayer la publication, déjà en ligne : on prévient, avec le commentaire à poster à la main.
    try {
      await sleep(jitter(channel?.commentDelayMinutes ?? [1, 3]));
      await call(`${postId}/comments`, { message: pkg.comment });
      console.log('   Commentaire (lien) publié');
    } catch (err) {
      console.error(`   Commentaire non publié : ${err.message}`);
      await alert(alerteFacebookCommentaire(pkg.article.title, pkg.comment)).catch(() => {});
    }
  }
  return { mediaId: postId, lien };
}
