import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fetchItems } from './lib/rss.mjs';
import { pickRubrique, stripGeoLead, splitHighlight, frenchTypography } from './lib/editorial.mjs';
import { loadSource, cropTo, SLIDE, STORY } from './lib/crop.mjs';
import { createRenderer } from './lib/render.mjs';
import { uploadFiles, assertPublic } from './lib/upload.mjs';
import { alert, sendStory } from './lib/notify.mjs';
import { createGraph } from './lib/graph.mjs';
import { loadState, markPublished, publishedGuids, nextSlot, MIN_GAP_HOURS } from './lib/state.mjs';

const STATE_FILE = new URL('../state/published.json', import.meta.url);
const OUT_DIR = new URL('../out/', import.meta.url);
const DEFAULT_RSS = 'https://passion-aquitaine.ouest-france.fr/feed/';
const DEFAULT_PUBLIC = 'https://passion-aquitaine.ouest-france.fr/social';

// DRY_RUN=1 : rendu + SFTP, sans Instagram, sans Telegram, sans état
const DRY_RUN = ['1', 'true'].includes(process.env.DRY_RUN);

const MAX_AGE_HOURS = 24; // évite de republier l'historique du flux
const MIN_SOURCE_WIDTH = 1200;
const MAX_DESC = 300;
const MAX_POSTS_24H = 6;

class GuardError extends Error {
  constructor(item, problems) {
    super(`⛔ Publication bloquée\n${item.title}\n${item.link}\n\n${problems.map((p) => `• ${p}`).join('\n')}`);
  }
}

function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Variables manquantes : ${missing.join(', ')}`);
}

const paris = (ms) => new Date(ms).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });

const show = (s) => s.replace(/ /g, '⍽').replace(/ /g, '·'); // espaces visibles dans le log

// ligne « vide » en U+2800 : Instagram supprime les lignes réellement vides
const BLANK_LINE = '⠀';

function buildCaption({ description }) {
  return [description, BLANK_LINE, '➡️ Article complet sur le site Passion Aquitaine'].join('\n');
}

async function processItem(item, { graph, publicBase }) {
  console.log(`\n━━ ${item.title}\n   ${item.link}`);

  // Rédactionnel
  const rubrique = pickRubrique(item.categories);
  const cleanTitle = frenchTypography(stripGeoLead(item.title, rubrique));
  const parts = splitHighlight(cleanTitle);
  const description = frenchTypography(item.description);
  console.log(`   Catégories : ${item.categories.join(', ')}`);
  console.log(`   Rubrique   : ${rubrique}`);
  console.log(`   Titre      : ${show(cleanTitle)}`);
  console.log(`   Surligné   : « ${show(parts.highlight)} »`);
  console.log(`   Description (${description.length} car.) : ${show(description)}`);

  // Garde-fous
  const problems = [];
  let source = null;
  if (!item.image) {
    problems.push('aucune image (enclosure) dans le flux');
  } else {
    source = await loadSource(item.image);
    console.log(`   Image source : ${source.width}x${source.height} ${item.image}`);
    if (source.width < MIN_SOURCE_WIDTH) problems.push(`image source trop petite : ${source.width}px de large (min ${MIN_SOURCE_WIDTH})`);
  }
  if (!description) problems.push('description vide');
  else if (description.length > MAX_DESC) problems.push(`description trop longue : ${description.length} caractères (max ${MAX_DESC})`);

  const { usage } = await graph.publishingLimit();
  if (usage >= MAX_POSTS_24H) problems.push(`quota atteint : ${usage} publications sur les dernières 24 h`);
  if (publishedGuids(await loadState(STATE_FILE)).has(item.guid)) problems.push('guid déjà présent dans state/published.json');

  // Rendu
  let slides = null;
  if (source) {
    const renderer = await createRenderer();
    try {
      const [photo, storyPhoto] = await Promise.all([cropTo(source, SLIDE), cropTo(source, STORY)]);
      console.log(`   Cadrage slide : ${photo.info}\n   Cadrage story : ${storyPhoto.info}`);
      console.log(`   Luminance bas d'image : ${photo.luminance.toFixed(0)}${photo.darken ? ' → dégradé renforcé' : ''}`);
      const common = { rubrique, ...parts };
      slides = {
        s1: await renderer.render('slide1', { ...common, photo: photo.buffer, darken: photo.darken }),
        s2: await renderer.render('slide2', { description }),
        story: await renderer.render('story', { ...common, photo: storyPhoto.buffer, darken: storyPhoto.darken }),
      };
    } finally {
      await renderer.close();
    }
    const fmt = ({ size, fits }) => `${size}px${fits ? '' : ' (NE TIENT PAS)'}`;
    console.log(`   Police : titre slide 1 ${fmt(slides.s1.title)} · titre story ${fmt(slides.story.title)} · description ${fmt(slides.s2.description)}`);
    if (!slides.s1.title.fits) problems.push('titre trop long : ne tient pas à 44 px sur 4 lignes (slide 1)');
    if (!slides.story.title.fits) problems.push('titre trop long : ne tient pas à 44 px (story)');
    if (!slides.s2.description.fits) problems.push('description trop longue : ne tient pas à 40 px sur 9 lignes');
  }

  // Fichiers (écrits même bloqués, pour contrôle visuel)
  let files = [];
  if (slides) {
    const stamp = new Date(item.date).toISOString().slice(0, 10).replaceAll('-', '');
    const base = `${stamp}-${createHash('sha1').update(item.guid).digest('hex').slice(0, 8)}`;
    files = [
      { name: `${base}-1.jpg`, buffer: slides.s1.buffer },
      { name: `${base}-2.jpg`, buffer: slides.s2.buffer },
      { name: `${base}-story.jpg`, buffer: slides.story.buffer },
    ];
    await mkdir(OUT_DIR, { recursive: true });
    await Promise.all(files.map((f) => writeFile(new URL(f.name, OUT_DIR), f.buffer)));
    for (const f of files) console.log(`   Fichier : ${fileURLToPath(new URL(f.name, OUT_DIR))}`);
  }

  if (problems.length) throw new GuardError(item, problems);

  await uploadFiles(files, {
    host: process.env.SFTP_HOST,
    user: process.env.SFTP_USER,
    pass: process.env.SFTP_PASS,
    dir: process.env.SFTP_DIR,
  });
  const [url1, url2, storyUrl] = files.map((f) => `${publicBase}/${f.name}`);
  for (const url of [url1, url2, storyUrl]) await assertPublic(url);
  console.log(`   En ligne :\n     ${url1}\n     ${url2}\n     ${storyUrl}`);

  const caption = buildCaption({ title: frenchTypography(item.title), description, rubrique, categories: item.categories });

  if (DRY_RUN) {
    console.log(`   DRY_RUN : pas de publication Instagram.\n   Légende prévue :\n${caption.replace(/^/gm, '     | ')}`);
    return;
  }

  // Publication carrousel
  const children = [];
  for (const url of [url1, url2]) children.push(await graph.createImage(url, { carouselItem: true }));
  for (const id of children) await graph.waitFinished(id);
  const carousel = await graph.createCarousel(children, caption);
  await graph.waitFinished(carousel);
  const mediaId = await graph.publish(carousel);
  console.log(`   Publié sur Instagram : ${mediaId}`);

  await markPublished(STATE_FILE, item.guid, mediaId);

  // Story : envoi manuel, non bloquant
  try {
    await sendStory({ buffer: slides.story.buffer, url: storyUrl, title: item.title, link: item.link });
  } catch (e) {
    console.error(`   Story non envoyée : ${e.message}\n   ${storyUrl}`);
  }
}

async function main() {
  requireEnv(['IG_USER_ID', 'IG_TOKEN', 'SFTP_HOST', 'SFTP_USER', 'SFTP_PASS', 'SFTP_DIR']);
  const publicBase = (process.env.PUBLIC_BASE_URL || DEFAULT_PUBLIC).replace(/\/+$/, '');
  const graph = createGraph({
    userId: process.env.IG_USER_ID,
    token: process.env.IG_TOKEN,
    version: process.env.GRAPH_VERSION,
  });
  if (DRY_RUN) console.log('Mode DRY_RUN : rien ne sera publié.');

  const items = await fetchItems(process.env.RSS_URL || DEFAULT_RSS);
  const state = await loadState(STATE_FILE);
  const published = publishedGuids(state);
  const now = Date.now();
  let queue = items
    .filter((i) => !published.has(i.guid) && now - i.date <= MAX_AGE_HOURS * 3600e3)
    .sort((a, b) => a.date - b.date);

  // Écart minimum entre deux publications : les articles attendent le prochain créneau
  const slot = nextSlot(state);
  if (queue.length && now < slot) {
    const waiting = `${queue.length} article(s) en attente, prochaine publication possible à partir de ${paris(slot)} (écart minimum ${MIN_GAP_HOURS} h)`;
    if (!DRY_RUN) {
      console.log(waiting);
      return;
    }
    console.log(`DRY_RUN : ${waiting} — ignoré à blanc.`);
  }

  if (DRY_RUN) {
    // DRY_RUN_LATEST=n : les n derniers articles du flux ; sinon les récents, ou à défaut le dernier
    const latest = Number(process.env.DRY_RUN_LATEST) || 0;
    const newest = [...items].sort((a, b) => b.date - a.date);
    if (latest) queue = newest.slice(0, latest);
    else if (!queue.length) queue = newest.slice(0, 1);
  } else {
    queue = queue.slice(0, 1); // un article par run, le plus ancien
  }
  if (!queue.length) {
    console.log('Rien de nouveau.');
    return;
  }

  let failed = 0;
  for (const item of queue) {
    try {
      await processItem(item, { graph, publicBase });
    } catch (err) {
      failed++;
      const text = err instanceof GuardError ? err.message : `❌ Échec pa-social\n${err.message}`;
      if (!(err instanceof GuardError) && err.stack) console.error(err.stack);
      if (DRY_RUN) console.error(text);
      else await alert(text).catch((e) => console.error(`Alerte Telegram impossible : ${e.message}`));
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err.stack ?? err.message);
  if (!DRY_RUN) await alert(`❌ Échec pa-social\n${err.message}`).catch((e) => console.error(`Alerte Telegram impossible : ${e.message}`));
  process.exitCode = 1;
});
