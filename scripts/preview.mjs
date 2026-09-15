// Planches d'aperçu (6 articles par image) : node --env-file=.env scripts/preview.mjs [--latest=N]
// Sans option : les articles de tests/fixtures/articles.json. Aucune publication, aucun dépôt.
import { readFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { fetchItems } from '../src/sources/rss.mjs';
import { prepare } from '../src/channels/instagram.mjs';
import { createRenderer } from '../src/media/render.mjs';
import { fromRoot } from '../src/core/config.mjs';

const latest = Number(process.argv.find((a) => a.startsWith('--latest='))?.split('=')[1]) || 0;
const articles = latest
  ? (await fetchItems(process.env.RSS_URL || 'https://passion-aquitaine.ouest-france.fr/feed/')).sort((a, b) => b.date - a.date).slice(0, latest)
  : JSON.parse(await readFile(fromRoot('tests/fixtures/articles.json'), 'utf8'));

const ROW = 450;
const COLS = [360, 360, 253];
const LABEL = 380;
const GAP = 10;
const WIDTH = COLS.reduce((s, w) => s + w + GAP, GAP) + LABEL + GAP;
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const wrap = (s, n) => String(s).split(/\s+/).reduce((lines, w) => {
  if (!lines.length || (lines.at(-1) + ' ' + w).length > n) lines.push(w);
  else lines[lines.length - 1] += ` ${w}`;
  return lines;
}, []);

function label(lines, color = '#1D1B1A') {
  const tspans = lines.slice(0, 20).map((l, i) => `<tspan x="12" dy="${i ? 21 : 24}">${esc(l)}</tspan>`).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${LABEL}" height="${ROW}"><rect width="100%" height="100%" fill="#F3F0EE"/><text font-family="Arial, sans-serif" font-size="15" fill="${color}">${tspans}</text></svg>`);
}

const renderer = await createRenderer();
const rows = [];
try {
  for (const article of articles) {
    try {
      const pkg = await prepare(article, { renderer, log: () => {} });
      rows.push({ article, pkg });
      console.log(`OK      ${article.title}`);
    } catch (err) {
      rows.push({ article, error: err.problems?.join(' · ') ?? err.message });
      console.log(`BLOQUÉ  ${article.title} → ${err.problems?.join(' · ') ?? err.message}`);
    }
  }
} finally {
  await renderer.close();
}

await mkdir(fromRoot('out'), { recursive: true });
for (let sheet = 0; sheet * 6 < rows.length; sheet++) {
  const chunk = rows.slice(sheet * 6, sheet * 6 + 6);
  const layers = [];
  for (const [r, row] of chunk.entries()) {
    const top = GAP + r * (ROW + GAP);
    let left = GAP;
    if (row.pkg) {
      for (const [i, file] of row.pkg.files.entries()) {
        layers.push({ input: await sharp(file.buffer).resize(COLS[i], ROW, { fit: 'contain', background: '#FFFFFF' }).toBuffer(), top, left });
        left += COLS[i] + GAP;
      }
    } else {
      left += COLS.reduce((s, w) => s + w + GAP, 0);
    }
    const { article, pkg, error } = row;
    const lines = [
      `[${article.label ?? 'article'}]`,
      ...wrap(article.title, 40),
      '',
      ...(pkg ? [`Rubrique : ${pkg.ed.rubrique}`, ...wrap(`Surligné : « ${pkg.ed.parts.highlight} »`, 40)] : ['BLOQUÉ :', ...wrap(error, 40)]),
      '',
      ...wrap(`Catégories : ${article.categories.join(', ')}`, 40),
    ];
    layers.push({ input: label(lines, pkg ? '#1D1B1A' : '#B42318'), top, left });
  }
  const height = GAP + chunk.length * (ROW + GAP);
  const file = fromRoot('out', `preview-${sheet + 1}.jpg`);
  await sharp({ create: { width: WIDTH, height, channels: 3, background: '#FFFFFF' } }).composite(layers).jpeg({ quality: 82 }).toFile(file);
  console.log(`Planche : ${file}`);
}
