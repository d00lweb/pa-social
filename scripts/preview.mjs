// Planches d'aperçu (6 articles par image) + rapport des textes : node --env-file=.env scripts/preview.mjs [--latest=N] [--sans-ia]
// Sans option : les articles de tests/fixtures/articles.json. Aucune publication, aucun dépôt.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { fetchItems } from '../src/sources/rss.mjs';
import { prepare } from '../src/channels/instagram.mjs';
import * as xkit from '../src/channels/x.mjs';
import * as bsky from '../src/channels/bluesky.mjs';
import { buildDossier } from '../src/brain/dossier.mjs';
import { loadMemory, remember } from '../src/brain/memory.mjs';
import { createRenderer } from '../src/media/render.mjs';
import { fromRoot } from '../src/core/config.mjs';
import { composeBluesky, composeX, composeXText, facebookComment } from '../src/brain/compose.mjs';

const editorialConfig = JSON.parse(await readFile(fromRoot('config/editorial.json'), 'utf8'));
const latest = Number(process.argv.find((a) => a.startsWith('--latest='))?.split('=')[1]) || 0;
if (process.argv.includes('--sans-ia')) delete process.env.ANTHROPIC_API_KEY;
const articles = latest
  ? (await fetchItems(process.env.RSS_URL || 'https://passion-aquitaine.ouest-france.fr/feed/')).sort((a, b) => b.date - a.date).slice(0, latest)
  : JSON.parse(await readFile(fromRoot('tests/fixtures/articles.json'), 'utf8'));

const ROW = 450;
const COLS = [360, 360, 253];
const LABEL = 420;
const GAP = 10;
const WIDTH = COLS.reduce((s, w) => s + w + GAP, GAP) + LABEL + GAP;
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const wrap = (s, n) => String(s).split(/\s+/).reduce((lines, w) => {
  if (!lines.length || `${lines.at(-1)} ${w}`.length > n) lines.push(w);
  else lines[lines.length - 1] += ` ${w}`;
  return lines;
}, []);
const label = (lines, color) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${LABEL}" height="${ROW}"><rect width="100%" height="100%" fill="#F3F0EE"/><text font-family="Arial, sans-serif" font-size="14" fill="${color}">${lines.slice(0, 22).map((l, i) => `<tspan x="12" dy="${i ? 19 : 22}">${esc(l)}</tspan>`).join('')}</text></svg>`);

const memory = await loadMemory();
const renderer = await createRenderer();
const rows = [];
let tokensIn = 0;
let tokensOut = 0;
try {
  for (const article of articles) {
    const dossier = await buildDossier(article, { memory, useCache: true, log: (m) => console.log(m) });
    remember(memory, dossier, editorialConfig.networks, editorialConfig.memorySize); // comme en production (mémoire non enregistrée)
    if (dossier.usage && !dossier.cached) { tokensIn += dossier.usage.input; tokensOut += dossier.usage.output; }
    try {
      const pkg = await prepare(article, { dossier, renderer, log: () => {} });
      const xpkg = await xkit.prepare(article, { dossier, renderer, log: () => {} });
      const bpkg = await bsky.prepare(article, { dossier, renderer, log: () => {} });
      rows.push({ article, dossier, pkg, xpkg, bpkg });
      console.log(`OK [${dossier.source}] ${article.title}`);
    } catch (err) {
      rows.push({ article, dossier, error: err.problems?.join(' · ') ?? err.message });
      console.log(`BLOQUÉ ${article.title} → ${err.problems?.join(' · ') ?? err.message}`);
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
    for (const [i, file] of (row.pkg?.files ?? []).entries()) {
      layers.push({ input: await sharp(file.buffer).resize(COLS[i], ROW, { fit: 'contain', background: '#FFFFFF' }).toBuffer(), top, left });
      left += COLS[i] + GAP;
    }
    if (!row.pkg) left += COLS.reduce((s, w) => s + w + GAP, 0);
    const d = row.dossier;
    const lines = [
      `[${row.article.label ?? 'article'}] source : ${d.source}${d.nature ? ` · ${d.nature}` : ''}${d.sensible ? ' · SENSIBLE' : ''}`,
      ...wrap(row.article.title, 46),
      '',
      `Rubrique : ${d.rubrique}`,
      ...wrap(`Surligné : « ${d.visuel.surlignage} »`, 46),
      `Hashtags : ${d.instagram.hashtags.join(' ')}`,
      '',
      ...wrap(`Légende : ${d.source === 'ia' ? d.instagram.texte : '(description)'}`, 46).slice(0, 9),
      ...(row.error ? ['', 'BLOQUÉ :', ...wrap(row.error, 46)] : []),
    ];
    layers.push({ input: label(lines, row.pkg ? '#1D1B1A' : '#B42318'), top, left });
  }
  const file = fromRoot('out', `preview-${sheet + 1}.jpg`);
  await sharp({ create: { width: WIDTH, height: GAP + chunk.length * (ROW + GAP), channels: 3, background: '#FFFFFF' } }).composite(layers).jpeg({ quality: 82 }).toFile(file);
  console.log(`Planche : ${file}`);
}

// Données de la page pilotage.html (aperçus par réseau)
const previewData = {
  generatedAt: new Date().toISOString(),
  articles: rows.map(({ article, dossier: d, pkg, xpkg, bpkg, error }) => ({
    title: article.title,
    link: article.link,
    date: article.date,
    rubrique: d.rubrique,
    source: d.source,
    nature: d.nature ?? null,
    sensible: Boolean(d.sensible),
    surlignage: d.visuel.surlignage,
    alt: d.visuel.texte_alternatif,
    error: error ?? null,
    images: pkg ? { slide1: `out/${pkg.files[0].name}`, slide2: `out/${pkg.files[1].name}`, story: `out/${pkg.files[2].name}`, x: xpkg ? `out/${xpkg.files[0].name}` : null, bluesky: bpkg ? `out/${bpkg.files[0].name}` : null } : null,
    networks: {
      instagram: { text: pkg?.caption ?? d.instagram.texte, hashtags: d.instagram.hashtags },
      facebook: { text: d.facebook.texte, comment: facebookComment(article, d) },
      bluesky: { text: bpkg?.text ?? composeBluesky(d), mode: bpkg?.mode ?? 'card' },
      threads: { text: d.threads.texte, sujet: d.threads.sujet ?? '' },
      x: { text: composeXText(d), link: article.link },
    },
  })),
};
await writeFile(fromRoot('out', 'preview-data.js'), `window.PREVIEW = ${JSON.stringify(previewData)};\n`);
console.log(`Données de pilotage : ${fromRoot('out', 'preview-data.js')}`);

// Rapport texte : tous les réseaux, pour relecture
const report = rows.map(({ article, dossier: d, pkg }) => [
  `## ${article.title}`,
  `- Source : ${d.source}${d.nature ? ` · ${d.nature}` : ''}${d.sensible ? ' · sensible' : ''}${d.angles ? ` · angles : ${Object.entries(d.angles).map(([k, v]) => `${k} = ${v}`).join(', ')}` : ''}`,
  `- Rubrique : ${d.rubrique} · Titre visuel : ${d.visuel.titre} · Surligné : « ${d.visuel.surlignage} »`,
  `- Texte alternatif : ${d.visuel.texte_alternatif}`,
  '', '**Instagram**', '```', pkg?.caption ?? d.instagram.texte, '```',
  `**Facebook** : ${d.facebook.texte}`, `> 1er commentaire : ${facebookComment(article, d)}`, '',
  `**Bluesky** : ${composeBluesky(d)}`, '',
  `**Threads** : ${d.threads.texte}${d.threads.sujet ? ` [sujet : ${d.threads.sujet}]` : ''}`, '',
  `**X** : ${composeX(d, article.link)}`, '',
].join('\n')).join('\n');
const cost = (tokensIn * 5 + tokensOut * 25) / 1e6;
await writeFile(fromRoot('out', 'preview-textes.md'), `# Aperçu des textes\n\nNouveaux appels IA : ${tokensIn} tokens en entrée, ${tokensOut} en sortie, ~${cost.toFixed(3)} $.\n\n${report}`);
console.log(`Rapport : ${fromRoot('out', 'preview-textes.md')} | nouveaux appels IA : ${tokensIn} + ${tokensOut} tokens ≈ ${cost.toFixed(3)} $`);
