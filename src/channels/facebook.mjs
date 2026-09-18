import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { splitAround } from '../brain/editorial.mjs';
import { facebookComment } from '../brain/compose.mjs';
import { loadSource, cropTo, toMetaJpeg, SLIDE } from '../media/crop.mjs';
import { createRenderer } from '../media/render.mjs';
import { uploadFiles, assertPublic } from '../storage/ftp.mjs';
import { GraphError } from './meta-graph.mjs';
import { alert } from './telegram.mjs';
import { jitter } from '../core/scheduler.mjs';
import { GuardError } from '../core/errors.mjs';
import { config, fromRoot } from '../core/config.mjs';

// Facebook : une seule image 4:5, texte court sans lien, et l'URL en premier commentaire.
export const id = 'facebook';

const SIZE = [1440, 1800]; // 4:5
const DEFAULT_PUBLIC = 'https://passion-aquitaine.ouest-france.fr/social';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client({ pageId, token, version }) {
  const base = `https://graph.facebook.com/${version || 'v23.0'}`;
  return async function call(chemin, params = {}) {
    const res = await fetch(`${base}/${chemin}`, { method: 'POST', body: new URLSearchParams({ ...params, access_token: token }) });
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

export async function prepare(article, { dossier, renderer: shared, log = console.log } = {}) {
  if (!article.image) throw new GuardError(article, ['aucune image (enclosure) dans le flux']);
  const texte = dossier.facebook?.texte?.trim();
  if (!texte) throw new GuardError(article, ['texte Facebook vide']);
  // le lien vit dans le commentaire : dans le corps, il ferait chuter la portée
  if (/https?:\/\//.test(texte)) throw new GuardError(article, ['lien dans le texte Facebook : il doit rester en commentaire']);

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
    });
  } finally {
    if (!shared) await renderer.close();
  }
  if (!visual.title.fits) throw new GuardError(article, ['titre trop long pour le visuel Facebook']);

  const buffer = await toMetaJpeg(await sharp(visual.buffer).resize(SIZE[0], SIZE[1], { kernel: 'lanczos3' }).png().toBuffer());
  const stamp = new Date(article.date).toISOString().slice(0, 10).replaceAll('-', '');
  const name = `${stamp}-${createHash('sha1').update(article.guid).digest('hex').slice(0, 8)}-fb.jpg`;
  await mkdir(fromRoot('out'), { recursive: true });
  await writeFile(fromRoot('out', name), buffer);

  const lieu = dossier.lieu ?? null;
  log(`   Facebook : image ${SIZE.join('×')}, ${[...texte].length} caractères${lieu ? `, lieu ${lieu.nom}` : ''}`);
  return { article, dossier, files: [{ name, buffer }], text: texte, comment: facebookComment(article, dossier), lieu };
}

// Dépôt FTP puis vérification de l'URL publique : Meta télécharge l'image depuis notre site
export async function stage(pkg) {
  await uploadFiles(pkg.files, {
    host: process.env.SFTP_HOST,
    user: process.env.SFTP_USER,
    pass: process.env.SFTP_PASS,
    dir: process.env.SFTP_DIR,
  });
  const base = (process.env.PUBLIC_BASE_URL || DEFAULT_PUBLIC).replace(/\/+$/, '');
  const url = `${base}/${pkg.files[0].name}`;
  await assertPublic(url);
  return url;
}

export async function publish(pkg, { channel } = {}) {
  const call = client({ pageId: process.env.FB_PAGE_ID, token: process.env.FB_TOKEN, version: process.env.GRAPH_VERSION });
  const pageId = process.env.FB_PAGE_ID;
  const url = await stage(pkg);

  const params = { url, caption: pkg.text, published: 'true' };
  if (pkg.lieu?.id) params.place = String(pkg.lieu.id);
  let reponse;
  try {
    reponse = await call(`${pageId}/photos`, params);
  } catch (err) {
    // un lieu devenu invalide ne doit pas empêcher la publication
    if (!params.place) throw err;
    console.error(`   Lieu abandonné : ${err.message}`);
    delete params.place;
    reponse = await call(`${pageId}/photos`, params);
  }
  const postId = reponse.post_id ?? reponse.id;
  const lien = await lienDuPost(postId, { token: process.env.FB_TOKEN, version: process.env.GRAPH_VERSION }).catch(() => null);

  // Le lien part en commentaire, 1 à 3 minutes plus tard : jamais dans le même souffle que le post.
  // Un échec ici ne doit surtout pas faire réessayer la publication, qui est déjà en ligne.
  try {
    await sleep(jitter(channel?.commentDelayMinutes ?? [1, 3]));
    await call(`${postId}/comments`, { message: pkg.comment });
    console.log('   Commentaire publié');
  } catch (err) {
    console.error(`   Commentaire non publié : ${err.message}`);
    await alert(`⚠️ Facebook : post publié mais commentaire (lien) non posté\n${pkg.article.title}\n${pkg.comment}`).catch(() => {});
  }
  return { mediaId: postId, lien };
}
