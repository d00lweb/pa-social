import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { splitAround, frenchTypography } from '../brain/editorial.mjs';
import { composeBluesky, linkLead } from '../brain/compose.mjs';
import { placerMentions } from '../brain/annuaire.mjs';
import { resoudreHandle } from '../sources/bsky-public.mjs';
import { loadSource, cropTo, X_FORMAT, SLIDE } from '../media/crop.mjs';
import { createRenderer } from '../media/render.mjs';
import { GuardError } from '../core/errors.mjs';
import { config, fromRoot } from '../core/config.mjs';

// Bluesky : API AT Protocol officielle (gratuite), mot de passe d'application
export const id = 'bluesky';

const PDS = 'https://bsky.social';
const MAX_BLOB = 950 * 1024; // vignette de carte limitée à ~1 Mo
const MAX_GRAPHEMES = 300;
const CARD = [1200, 627]; // 1,91:1
const IMAGE = [1080, 1350]; // 4:5
export const LINK_LABEL = 'Lire l’article';

const graphemes = (s) => [...new Intl.Segmenter('fr', { granularity: 'grapheme' }).segment(String(s))].length;
const hashNum = (s) => parseInt(createHash('sha1').update(String(s)).digest('hex').slice(0, 8), 16);

// Rotation des 3 formats, stable par article : carte de lien · image + lien · image, lien en réponse
export const FORMATS = config.channels.bluesky?.formats ?? ['card', 'image', 'reply'];
export const modeFor = (guid, formats = FORMATS) => formats[hashNum(guid) % formats.length];

// Réponse portant le lien : formule tournante, jamais deux fois la même d'un article à l'autre
export const replyTextFor = (article) => `${linkLead(article.guid, 'bluesky')} ${article.link}`;

export function postText(dossier, mode) {
  const base = composeBluesky(dossier);
  return mode === 'image' ? `${base}\n➡️ ${LINK_LABEL}` : base;
}

// Facettes (hashtags cliquables, lien sur le libellé) : positions en octets UTF-8
export function buildFacets(text, link, linkLabel) {
  const enc = new TextEncoder();
  const byteAt = (i) => enc.encode(text.slice(0, i)).length;
  const facets = [];
  for (const m of text.matchAll(/(^|[\s(])#([\p{L}\p{N}_]+)/gu)) {
    const start = m.index + m[1].length;
    const end = start + 1 + m[2].length;
    facets.push({ index: { byteStart: byteAt(start), byteEnd: byteAt(end) }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: m[2] }] });
  }
  if (link && linkLabel) {
    const at = text.lastIndexOf(linkLabel);
    if (at >= 0) facets.push({ index: { byteStart: byteAt(at), byteEnd: byteAt(at + linkLabel.length) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: link }] });
  }
  // lien écrit en clair (réponse) : la facette porte sur l'URL elle-même
  for (const m of text.matchAll(/https?:\/\/\S+/g)) {
    facets.push({ index: { byteStart: byteAt(m.index), byteEnd: byteAt(m.index + m[0].length) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }] });
  }
  return facets;
}

// Une mention n'est cliquable que si la facette porte l'identifiant technique du compte
export async function mentionFacets(text, resoudre = resoudreHandle) {
  const enc = new TextEncoder();
  const byteAt = (i) => enc.encode(text.slice(0, i)).length;
  const facets = [];
  for (const m of text.matchAll(/(^|[\s(])@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) {
    const did = await resoudre(m[2]);
    if (!did) continue;
    const start = m.index + m[1].length;
    facets.push({ index: { byteStart: byteAt(start), byteEnd: byteAt(start + 1 + m[2].length) }, features: [{ $type: 'app.bsky.richtext.facet#mention', did }] });
  }
  return facets;
}

async function underLimit(input, [width, height]) {
  for (const quality of [90, 82, 74, 66, 58]) {
    const buffer = await sharp(input).resize(width, height, { fit: 'cover' }).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (buffer.length <= MAX_BLOB) return buffer;
  }
  throw new Error('image Bluesky au-delà de 950 Ko');
}

export async function prepare(article, { dossier, renderer: shared, log = console.log } = {}) {
  if (!article.image) throw new GuardError(article, ['aucune image (enclosure) dans le flux']);
  const mode = modeFor(article.guid);
  const suffixe = postText(dossier, mode).slice(composeBluesky(dossier).length);

  // Trois mentions au plus, comme sur Instagram. Un compte que l'article nomme remplace son nom
  // dans le texte ; les autres (commune, références du domaine) forment une ligne à part, avant
  // le lien. Jamais un nom de domaine remplacé en plein texte : « Le mot @fond-patrimoine, plus
  // vieux que patrimoine… ». Le texte prime : ce qui ne tient pas dans 300 signes n'est pas mentionné.
  const { texte, places } = placerMentions(composeBluesky(dossier), dossier.comptes?.bluesky ?? [], {
    tient: (t) => graphemes(t + suffixe) <= MAX_GRAPHEMES,
  });
  const text = texte + suffixe;
  if (places.length) log(`   Mentions : ${places.map((c) => `@${c.handle}`).join(' ')}`);
  if (graphemes(text) > MAX_GRAPHEMES) throw new GuardError(article, [`texte Bluesky trop long : ${graphemes(text)} / ${MAX_GRAPHEMES}`]);

  const source = await loadSource(article.image);
  const renderer = shared ?? (await createRenderer());
  let buffer;
  try {
    const parts = splitAround(dossier.visuel.titre, dossier.visuel.surlignage);
    const photo = await cropTo(source, mode === 'card' ? X_FORMAT : SLIDE);
    const visual = await renderer.render(mode === 'card' ? 'x' : 'slide1', { rubrique: dossier.rubrique, ...parts, photo: photo.buffer, darken: photo.darken });
    if (!visual.title.fits) throw new GuardError(article, ['titre trop long pour le visuel Bluesky']);
    buffer = await underLimit(visual.buffer, mode === 'card' ? CARD : IMAGE);
  } finally {
    if (!shared) await renderer.close();
  }

  const stamp = new Date(article.date).toISOString().slice(0, 10).replaceAll('-', '');
  const name = `${stamp}-${createHash('sha1').update(article.guid).digest('hex').slice(0, 8)}-bsky.jpg`;
  await mkdir(fromRoot('out'), { recursive: true });
  await writeFile(fromRoot('out', name), buffer);
  const libelle = { card: 'carte de lien', image: 'image 4:5 + lien', reply: 'image 4:5, lien en réponse' }[mode];
  log(`   Bluesky : ${libelle}, ${graphemes(text)}/${MAX_GRAPHEMES} caractères, ${Math.round(buffer.length / 1024)} Ko`);
  return { article, dossier, mode, text, files: [{ name, buffer }], alt: dossier.visuel.texte_alternatif, replyText: mode === 'reply' ? replyTextFor(article) : null };
}

async function xrpc(method, { token, body, contentType = 'application/json' } = {}) {
  const res = await fetch(`${PDS}/xrpc/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: contentType === 'application/json' ? JSON.stringify(body) : body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Bluesky ${method} : HTTP ${res.status} ${json.error ?? ''} ${json.message ?? ''}`.trim());
    // limite ou sanction : coupe-circuit
    err.restriction = res.status === 429 || ['RateLimitExceeded', 'AccountTakedown', 'AccountSuspended', 'AccountDeactivated'].includes(json.error);
    throw err;
  }
  return json;
}

export async function login() {
  const session = await xrpc('com.atproto.server.createSession', { body: { identifier: process.env.BLUESKY_HANDLE, password: process.env.BLUESKY_APP_PASSWORD } });
  return { token: session.accessJwt, did: session.did, handle: session.handle };
}

export async function publish(pkg) {
  const { token, did } = await login();
  const { blob } = await xrpc('com.atproto.repo.uploadBlob', { token, body: pkg.files[0].buffer, contentType: 'image/jpeg' });
  const embed = pkg.mode === 'card'
    ? { $type: 'app.bsky.embed.external', external: { uri: pkg.article.link, title: pkg.article.title, description: frenchTypography(pkg.article.description).slice(0, 300), thumb: blob } }
    : { $type: 'app.bsky.embed.images', images: [{ alt: pkg.alt, image: blob, aspectRatio: { width: IMAGE[0], height: IMAGE[1] } }] };
  const record = {
    $type: 'app.bsky.feed.post',
    text: pkg.text,
    createdAt: new Date().toISOString(),
    langs: ['fr'],
    facets: [...buildFacets(pkg.text, pkg.article.link, pkg.mode === 'image' ? LINK_LABEL : null), ...(await mentionFacets(pkg.text))],
    embed,
  };
  const { uri, cid } = await xrpc('com.atproto.repo.createRecord', { token, body: { repo: did, collection: 'app.bsky.feed.post', record } });

  // format « lien en réponse » : le lien part dans une réponse à notre propre post
  if (pkg.replyText) {
    const ref = { uri, cid };
    const reply = {
      $type: 'app.bsky.feed.post',
      text: pkg.replyText,
      createdAt: new Date().toISOString(),
      langs: ['fr'],
      facets: buildFacets(pkg.replyText),
      reply: { root: ref, parent: ref },
    };
    await xrpc('com.atproto.repo.createRecord', { token, body: { repo: did, collection: 'app.bsky.feed.post', record: reply } });
  }
  return { mediaId: uri, lien: lienPublic(uri) };
}

// at://did:plc:…/app.bsky.feed.post/3mvrm5zanwc2i → https://bsky.app/profile/<compte>/post/3mvrm5zanwc2i
// Aucun appel réseau : l'identifiant du post contient déjà tout ce qu'il faut.
export function lienPublic(uri, compte = process.env.BLUESKY_HANDLE) {
  const rkey = String(uri ?? '').split('/').pop();
  return rkey && compte ? `https://bsky.app/profile/${compte}/post/${rkey}` : null;
}
