// node --env-file=.env scripts/smoke-ig.mjs --mode=single|carousel [--publish]
import { createGraph } from '../src/lib/graph.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);
const mode = args.mode ?? 'single';
const publish = args.publish === 'true';

if (!['single', 'carousel'].includes(mode)) {
  console.error('Usage : --mode=single|carousel [--publish]');
  process.exit(1);
}
const missing = ['IG_USER_ID', 'IG_TOKEN', 'TEST_IMAGE'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Variables manquantes : ${missing.join(', ')}`);
  process.exit(1);
}

const graph = createGraph({
  userId: process.env.IG_USER_ID,
  token: process.env.IG_TOKEN,
  version: process.env.GRAPH_VERSION,
});
// TEST_IMAGE : une URL, ou plusieurs séparées par des virgules
const images = process.env.TEST_IMAGE.split(',').map((s) => s.trim()).filter(Boolean);
const caption = `Test pa-social ${new Date().toISOString()}`;

try {
  const me = await graph.account();
  console.log(`Compte : @${me.username}${me.name ? ` (${me.name})` : ''}`);

  const { usage, total } = await graph.publishingLimit();
  console.log(`Quota 24 h : ${usage}/${total?.toString() ?? '?'}`);

  let creationId;
  if (mode === 'single') {
    creationId = await graph.createImage(images[0], { caption });
    console.log(`Conteneur image : ${creationId}`);
  } else {
    const urls = images.length > 1 ? images.slice(0, 10) : [images[0], images[0]];
    const children = [];
    for (const url of urls) {
      const id = await graph.createImage(url, { carouselItem: true });
      console.log(`Élément : ${id}`);
      children.push(id);
    }
    for (const id of children) {
      await graph.waitFinished(id);
      console.log(`  ${id} FINISHED`);
    }
    creationId = await graph.createCarousel(children, caption);
    console.log(`Conteneur carrousel : ${creationId}`);
  }

  await graph.waitFinished(creationId);
  console.log(`  ${creationId} FINISHED`);

  if (!publish) {
    console.log('Arrêt avant publication (ajouter --publish pour publier).');
  } else {
    const mediaId = await graph.publish(creationId);
    console.log(`Publié : ${mediaId}`);
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
