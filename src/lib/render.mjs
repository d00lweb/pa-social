import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { toMetaJpeg } from './crop.mjs';
import { brushMask } from './brush.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEMPLATE = join(ROOT, 'src/template/card.html');
const FONT = join(ROOT, 'assets/fonts/Montserrat[wght].ttf');
const FONT_URL = 'https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf';
// logos HD du bandeau (vectoriel Ouest-France, PNG transparent Passion Aquitaine)
const LOGO_OF = join(ROOT, 'assets/logo-ouest-france.svg');
const LOGO_PA = join(ROOT, 'assets/logo-passion-aquitaine.png');
const SUPERSAMPLING = 2; // rendu x2 puis réduction : texte et logos plus nets

const FORMATS = {
  slide1: { width: 1080, height: 1350 },
  slide2: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
};

const exists = (p) => access(p).then(() => true, () => false);
const dataUri = (buf, mime) => `data:${mime};base64,${buf.toString('base64')}`;
const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fill = (tpl, tokens) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(tokens[k] ?? ''));

async function ensureFont() {
  if (await exists(FONT)) return;
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`Police Montserrat ${res.status}`);
  await mkdir(dirname(FONT), { recursive: true });
  await writeFile(FONT, Buffer.from(await res.arrayBuffer()));
}


// Recherche binaire : plus grande taille qui tient dans la boîte et le nombre de lignes
function fitText({ selector, box, min, max, maxLines, lineHeight }) {
  const el = document.querySelector(selector);
  const container = box ? document.querySelector(box) : null;
  const ok = (size) => {
    el.style.fontSize = `${size}px`;
    const lines = Math.round(el.getBoundingClientRect().height / (size * lineHeight));
    if (lines > maxLines) return false;
    if (el.scrollWidth > el.clientWidth + 1) return false;
    if (container && (el.offsetHeight > container.clientHeight || container.scrollHeight > container.clientHeight + 1)) return false;
    return true;
  };
  let lo = min;
  let hi = max;
  let best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ok(mid)) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  el.style.fontSize = `${best ?? min}px`;
  return { size: best ?? min, fits: best !== null };
}

export async function createRenderer() {
  await ensureFont();
  const [template, font, logoOf, logoPa] = await Promise.all([
    readFile(TEMPLATE, 'utf8'), readFile(FONT), readFile(LOGO_OF), readFile(LOGO_PA),
  ]);
  const assets = {
    FONT: dataUri(font, 'font/ttf'),
    LOGO_OF: dataUri(logoOf, 'image/svg+xml'),
    LOGO_PA: dataUri(logoPa, 'image/png'),
  };
  const browser = await chromium.launch();

  async function render(format, data) {
    const { width, height } = FORMATS[format];
    const html = fill(template, {
      ...assets,
      FORMAT: format,
      WIDTH: width,
      HEIGHT: height,
      PHOTO: data.photo ? dataUri(data.photo, 'image/jpeg') : '',
      SHADE: data.darken ? '0.86' : '0.66',
      RUBRIQUE: esc(data.rubrique),
      TITLE_BEFORE: esc(data.before),
      TITLE_HL: esc(data.highlight),
      TITLE_AFTER: esc(data.after),
      BRUSH: data.highlight ? await brushMask(`${data.before}${data.highlight}`) : '',
      DESCRIPTION: esc(data.description),
    });

    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: SUPERSAMPLING });
    try {
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready.then(() => true));

      const result = {};
      if (format === 'slide2') {
        result.description = await page.evaluate(fitText, {
          selector: '.desc', box: '.desc-box', min: 40, max: 76, maxLines: 9, lineHeight: 1.24,
        });
      } else {
        result.title = await page.evaluate(fitText, {
          selector: '.title', box: null, min: 44, max: 66, maxLines: 4, lineHeight: 1.16,
        });
      }

      const shot = await page.locator('#root').screenshot({ type: 'png' });
      const png = await sharp(shot).resize(width, height, { kernel: 'lanczos3' }).png().toBuffer();
      return { buffer: await toMetaJpeg(png), ...result };
    } finally {
      await page.close();
    }
  }

  return { render, close: () => browser.close() };
}
