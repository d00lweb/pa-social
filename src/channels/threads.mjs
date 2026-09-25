import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { splitAround } from '../brain/editorial.mjs';
import { linkLead } from '../brain/compose.mjs';
import { substituer } from '../brain/annuaire.mjs';
import { alerteThreadsReponse } from './messages.mjs';
import { loadSource, cropTo, toMetaJpeg, SLIDE } from '../media/crop.mjs';
import { createRenderer } from '../media/render.mjs';
import { uploadFiles, assertPublic } from '../storage/ftp.mjs';
import { GraphError } from './meta-graph.mjs';
import { alert } from './telegram.mjs';
import { jitter } from '../core/scheduler.mjs';
import { GuardError } from '../core/errors.mjs';
import { config, fromRoot } from '../core/config.mjs';

// Threads : conteneur puis publication, en deux temps. 3 formats en rotation.
export const id = 'threads';

const API = 'https://graph.threads.net/v1.0';
const SIZE = [1440, 1800]; // 4:5
const MAX_TEXT = 500;
const ATTENTE_CONTENEUR = 30e3; // Meta recommande 30 s avant de publier un conteneur
const DEFAULT_PUBLIC = 'https://passion-aquitaine.ouest-france.fr/social';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hashNum = (s) => parseInt(createHash('sha1').update(String(s)).digest('hex').slice(0, 8), 16);

// image + lien dans le texte · lien seul (aperçu) · image avec lien en réponse
export const FORMATS = config.channels.threads?.formats ?? ['image', 'lien', 'reponse'];
export const modeFor = (guid, formats = FORMATS) => formats[hashNum(guid) % formats.length];

export const replyTextFor = (article) => `${linkLead(article.guid, 'threads')} ${article.link}`;

// Le lien ne figure dans le texte que pour le format « image » ; ailleurs il est porté
// par l'aperçu natif ou par la réponse.
export function postText(dossier, mode, link) {
  const base = String(dossier.threads?.texte ?? '').trim();
  return mode === 'image' ? `${base}\n➡️ ${link}` : base;
}

const compte = (texte) => [...texte].length;

export async function prepare(article, { dossier, renderer: shared, log = console.log } = {}) {
  const mode = modeFor(article.guid);
  let texte = postText(dossier, mode, article.link);
  if (!texte) throw new GuardError(article, ['texte Threads vide']);

  // mention seulement en remplaçant un nom déjà écrit, et seulement si le compte est sur Threads
  // idem Bluesky : un compte de référence porte un nom de domaine, pas un nom cité dans le texte
  const mention = (dossier.comptes?.threads ?? []).find((c) => !c.thematique);
  if (mention) {
    const avecMention = substituer(texte, mention.nom, mention.handle);
    if (avecMention && compte(avecMention) <= MAX_TEXT) {
      texte = avecMention;
      log(`   Mention : @${mention.handle}`);
    }
  }
  // idem Bluesky : le compte de référence s'ajoute en fin de post, faute de nom à substituer
  const reference = (dossier.comptes?.threads ?? []).find((c) => c.thematique);
  if (reference) {
    const avec = `${texte}\n@${reference.handle}`;
    if (compte(avec) <= MAX_TEXT) {
      texte = avec;
      log(`   Compte de référence mentionné : @${reference.handle}`);
    }
  }
  if (compte(texte) > MAX_TEXT) throw new GuardError(article, [`texte Threads trop long : ${compte(texte)} / ${MAX_TEXT}`]);

  // sujet : la commune quand l'article en nomme une, plus précise que la rubrique ; sinon celui de l'IA.
  // Threads refuse « . » et « & », et limite le sujet à 50 caractères.
  const nettoyer = (s) => String(s ?? '').replace(/[#.&]/g, '').trim().slice(0, 50) || null;
  const sujet = nettoyer(dossier.commune) ?? nettoyer(dossier.threads?.sujet);
  const base = { article, dossier, mode, text: texte, sujet, lieu: dossier.lieu ?? null };

  // format « lien seul » : pas de visuel, Threads affiche l'aperçu de l'article
  if (mode === 'lien') {
    log(`   Threads : lien seul (aperçu), ${compte(texte)}/${MAX_TEXT} caractères`);
    return { ...base, files: [], replyText: null };
  }

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
    });
  } finally {
    if (!shared) await renderer.close();
  }
  if (!visual.title.fits) throw new GuardError(article, ['titre trop long pour le visuel Threads']);

  const buffer = await toMetaJpeg(await sharp(visual.buffer).resize(SIZE[0], SIZE[1], { kernel: 'lanczos3' }).png().toBuffer());
  const stamp = new Date(article.date).toISOString().slice(0, 10).replaceAll('-', '');
  const name = `${stamp}-${createHash('sha1').update(article.guid).digest('hex').slice(0, 8)}-th.jpg`;
  await mkdir(fromRoot('out'), { recursive: true });
  await writeFile(fromRoot('out', name), buffer);

  const libelle = mode === 'image' ? 'image + lien dans le texte' : 'image, lien en réponse';
  log(`   Threads : ${libelle}, ${compte(texte)}/${MAX_TEXT} caractères`);
  return { ...base, files: [{ name, buffer }], replyText: mode === 'reponse' ? replyTextFor(article) : null };
}

export async function stage(pkg) {
  if (!pkg.files.length) return null;
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

function client(token) {
  return async function appel(chemin, params) {
    const res = await fetch(`${API}/${chemin}`, { method: 'POST', body: new URLSearchParams({ ...params, access_token: token }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new GraphError(json.error ?? { message: 'réponse illisible' }, res.status);
    return json;
  };
}

// Permalien du post, demandé en lecture : client() ne fait que des POST.
async function lienDuPost(postId, token) {
  const params = new URLSearchParams({ fields: 'permalink', access_token: token });
  const res = await fetch(`${API}/${postId}?${params}`, { signal: AbortSignal.timeout(15000) });
  const json = await res.json().catch(() => ({}));
  return json.permalink ?? null;
}

export async function publish(pkg, { channel } = {}) {
  const token = process.env.THREADS_TOKEN;
  const userId = process.env.THREADS_USER_ID;
  const appel = client(token);
  const url = await stage(pkg);

  const params = { media_type: url ? 'IMAGE' : 'TEXT', text: pkg.text };
  if (url) {
    params.image_url = url;
    // Meta refuse alt_text sur un post sans image : « cannot be used with the TEXT media type »
    if (pkg.dossier.visuel?.texte_alternatif) params.alt_text = pkg.dossier.visuel.texte_alternatif;
  }
  if (pkg.sujet) params.topic_tag = pkg.sujet;
  // format « lien seul » : l'aperçu de l'article remplace le visuel
  if (pkg.mode === 'lien') params.link_attachment = pkg.article.link;

  const { id: conteneur } = await appel(`${userId}/threads`, params);
  await sleep(ATTENTE_CONTENEUR);
  const { id: postId } = await appel(`${userId}/threads_publish`, { creation_id: conteneur });
  // permalien pour l'avis Telegram : un échec ici ne doit rien casser, le post est déjà en ligne
  const lien = await lienDuPost(postId, token).catch(() => null);

  // Le lien part en réponse à notre propre post. Un échec ici ne doit jamais faire
  // réessayer la publication, qui est déjà en ligne.
  if (pkg.replyText) {
    try {
      await sleep(jitter(channel?.replyDelayMinutes ?? [1, 3]));
      const { id: reponse } = await appel(`${userId}/threads`, { media_type: 'TEXT', text: pkg.replyText, reply_to_id: postId });
      await sleep(ATTENTE_CONTENEUR);
      await appel(`${userId}/threads_publish`, { creation_id: reponse });
      console.log('   Réponse publiée');
    } catch (err) {
      console.error(`   Réponse non publiée : ${err.message}`);
      await alert(alerteThreadsReponse(pkg.article.title, pkg.replyText)).catch(() => {});
    }
  }
  return { mediaId: postId, lien };
}
