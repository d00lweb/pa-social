import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { frenchTypography, splitAround } from '../brain/editorial.mjs';
import { fallbackDossier } from '../brain/fallback.mjs';
import { loadSource, cropTo, SLIDE, STORY } from '../media/crop.mjs';
import { createRenderer } from '../media/render.mjs';
import { uploadFiles, assertPublic } from '../storage/ftp.mjs';
import { sendStory } from './telegram.mjs';
import { createGraph } from './meta-graph.mjs';
import { GuardError, DeferError } from '../core/errors.mjs';
import { fromRoot } from '../core/config.mjs';

export const id = 'instagram';

const ed = JSON.parse(readFileSync(fromRoot('config/editorial.json'), 'utf8'));
const MIN_SOURCE_WIDTH = 1200;
const MAX_DESC = 300;
const DEFAULT_PUBLIC = 'https://passion-aquitaine.ouest-france.fr/social';
// ligne « vide » en U+2800 : Instagram supprime les lignes réellement vides
const BLANK_LINE = '⠀';
const show = (s) => s.replace(/ /g, '⍽').replace(/ /g, '·'); // espaces visibles dans le journal

// Texte, ligne vide, renvoi vers le site, ligne vide, 3 hashtags
export function buildCaption(dossier, description) {
  const raw = ed.instagramCaptionSource === 'ai' && dossier.source === 'ia' ? dossier.instagram.texte : description;
  // une ligne blanche (U+2800) entre chaque paragraphe
  const text = raw.split('\n').map((l) => l.trim()).filter(Boolean).join(`\n${BLANK_LINE}\n`);
  return [text, BLANK_LINE, '➡️ Article complet sur le site Passion Aquitaine', BLANK_LINE, dossier.instagram.hashtags.join(' ')].join('\n');
}

// Rendu des 3 visuels + garde-fous de contenu ; GuardError si l'article ne peut pas être publié
export async function prepare(article, { dossier = fallbackDossier(article), renderer: shared, log = console.log } = {}) {
  log(`\n━━ ${article.title}\n   ${article.link}`);
  const parts = splitAround(dossier.visuel.titre, dossier.visuel.surlignage);
  const description = frenchTypography(article.description);
  // 2ᵉ image : texte rédigé par l'IA, sinon la description de l'article
  const slideText = dossier.visuel.description?.trim() || description;
  log(`   [${dossier.source}] Rubrique : ${dossier.rubrique} | Titre : ${show(dossier.visuel.titre)} | Surligné : « ${show(parts.highlight)} » | ${dossier.instagram.hashtags.join(' ')}`);

  const problems = [];
  let source = null;
  if (!article.image) {
    problems.push('aucune image (enclosure) dans le flux');
  } else {
    source = await loadSource(article.image);
    log(`   Image source : ${source.width}x${source.height}`);
    if (source.width < MIN_SOURCE_WIDTH) problems.push(`image source trop petite : ${source.width}px de large (min ${MIN_SOURCE_WIDTH})`);
  }
  if (!slideText) problems.push('description vide');
  else if (slideText.length > MAX_DESC) problems.push(`texte de la 2ᵉ image trop long : ${slideText.length} caractères (max ${MAX_DESC})`);
  if (!source) throw new GuardError(article, problems);

  const renderer = shared ?? (await createRenderer());
  let slides;
  try {
    const [photo, storyPhoto] = await Promise.all([cropTo(source, SLIDE), cropTo(source, STORY)]);
    log(`   Cadrage : ${photo.info} | story : ${storyPhoto.info}`);
    const common = { rubrique: dossier.rubrique, ...parts };
    slides = {
      s1: await renderer.render('slide1', { ...common, photo: photo.buffer, darken: photo.darken }),
      s2: await renderer.render('slide2', { description: slideText }),
      story: await renderer.render('story', { ...common, photo: storyPhoto.buffer, darken: storyPhoto.darken }),
    };
  } finally {
    if (!shared) await renderer.close();
  }
  const fmt = ({ size, fits }) => `${size}px${fits ? '' : ' (NE TIENT PAS)'}`;
  log(`   Police : titre ${fmt(slides.s1.title)} · story ${fmt(slides.story.title)} · description ${fmt(slides.s2.description)}`);
  if (!slides.s1.title.fits) problems.push('titre trop long : ne tient pas à 44 px sur 4 lignes (slide 1)');
  if (!slides.story.title.fits) problems.push('titre trop long : ne tient pas à 44 px (story)');
  if (!slides.s2.description.fits) problems.push('description trop longue : ne tient pas à 40 px sur 9 lignes');

  // fichiers écrits même bloqués, pour contrôle visuel
  const stamp = new Date(article.date).toISOString().slice(0, 10).replaceAll('-', '');
  const base = `${stamp}-${createHash('sha1').update(article.guid).digest('hex').slice(0, 8)}`;
  const files = [
    { name: `${base}-1.jpg`, buffer: slides.s1.buffer },
    { name: `${base}-2.jpg`, buffer: slides.s2.buffer },
    { name: `${base}-story.jpg`, buffer: slides.story.buffer },
  ];
  await mkdir(fromRoot('out'), { recursive: true });
  await Promise.all(files.map((f) => writeFile(fromRoot('out', f.name), f.buffer)));

  if (problems.length) throw new GuardError(article, problems);
  return { article, dossier, files, caption: buildCaption(dossier, description) };
}

// Dépôt FTP + vérification des URL publiques
export async function stage(pkg) {
  await uploadFiles(pkg.files, {
    host: process.env.SFTP_HOST,
    user: process.env.SFTP_USER,
    pass: process.env.SFTP_PASS,
    dir: process.env.SFTP_DIR,
  });
  const base = (process.env.PUBLIC_BASE_URL || DEFAULT_PUBLIC).replace(/\/+$/, '');
  const urls = pkg.files.map((f) => `${base}/${f.name}`);
  for (const url of urls) await assertPublic(url);
  return urls;
}

// Carrousel Instagram + story envoyée sur Telegram
export async function publish(pkg, { channel }) {
  const graph = createGraph({ userId: process.env.IG_USER_ID, token: process.env.IG_TOKEN, version: process.env.GRAPH_VERSION });
  const { usage } = await graph.publishingLimit();
  if (usage >= channel.maxPer24h) throw new DeferError(`quota atteint : ${usage} publications sur 24 h`);

  const [url1, url2, storyUrl] = await stage(pkg);
  const children = [];
  for (const url of [url1, url2]) children.push(await graph.createImage(url, { carouselItem: true }));
  for (const child of children) await graph.waitFinished(child);
  const carousel = await graph.createCarousel(children, pkg.caption);
  await graph.waitFinished(carousel);
  const mediaId = await graph.publish(carousel);

  // story : envoi manuel, non bloquant
  try {
    await sendStory({ buffer: pkg.files[2].buffer, url: storyUrl, title: pkg.article.title, link: pkg.article.link });
  } catch (e) {
    console.error(`   Story non envoyée : ${e.message}\n   ${storyUrl}`);
  }
  return { mediaId };
}
