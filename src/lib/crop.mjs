import sharp from 'sharp';

const UA = 'pa-social/0.1 (+https://passion-aquitaine.ouest-france.fr)';
const MAX_BYTES = 8 * 1024 * 1024; // limite Meta
const FOCUS_SHIFT = 0.1;
const BAND_START = 0.6;
const LUMINANCE_MAX = 150;
const MAP_WIDTH = 200;
const COVERAGE_MIN = 0.7; // part du sujet à garder, sinon on élargit le cadre
const FADE = 140;

// Cadres candidats (largeur/hauteur), du plus serré au plus large
export const SLIDE = { width: 1080, height: 1350, ratios: [0.8, 0.9, 1, 1.125, 1.25], photoCenter: null };
export const STORY = { width: 1080, height: 1920, ratios: [0.5625, 0.66, 0.8, 0.9, 1], photoCenter: 0.43 };

export async function loadSource(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Image ${res.status} : ${url}`);
  const input = Buffer.from(await res.arrayBuffer());
  // orientation EXIF appliquée, sans perte
  const { data, info } = await sharp(input, { failOn: 'none' })
    .rotate()
    .png({ compressionLevel: 1 })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

export async function toMetaJpeg(input) {
  // 4:4:4 : pas de sous-échantillonnage couleur, bords rouges nets
  for (const quality of [95, 90, 85, 80]) {
    const out = await sharp(input).toColorspace('srgb').jpeg({ quality, chromaSubsampling: '4:4:4' }).toBuffer();
    if (out.length < MAX_BYTES) return out;
  }
  throw new Error('JPEG au-delà de 8 Mo');
}

// Flou boîte séparable
function boxBlur(src, W, H, r) {
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * W + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = acc / (2 * r + 1);
      acc += src[y * W + Math.min(W - 1, x + r + 1)] - src[y * W + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
  return out;
}

const quantile = (arr, q) => {
  const s = Float32Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] || 1;
};

// Carte du sujet : zones détaillées ET distinctes de la teinte dominante, légère priorité au centre
async function saliency(buffer) {
  const { data, info } = await sharp(buffer).resize(MAP_WIDTH).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const N = W * H;
  const r = new Float32Array(N);
  const g = new Float32Array(N);
  const b = new Float32Array(N);
  const lum = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    r[i] = data[3 * i];
    g[i] = data[3 * i + 1];
    b[i] = data[3 * i + 2];
    lum[i] = 0.299 * r[i] + 0.587 * g[i] + 0.114 * b[i];
  }

  const edge = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = lum[i - W + 1] + 2 * lum[i + 1] + lum[i + W + 1] - lum[i - W - 1] - 2 * lum[i - 1] - lum[i + W - 1];
      const gy = lum[i + W - 1] + 2 * lum[i + W] + lum[i + W + 1] - lum[i - W - 1] - 2 * lum[i - W] - lum[i - W + 1];
      edge[i] = Math.hypot(gx, gy);
    }
  }
  const detail = boxBlur(boxBlur(edge, W, H, 3), W, H, 3);

  const [mr, mg, mb] = [quantile(r, 0.5), quantile(g, 0.5), quantile(b, 0.5)];
  const [rb, gb, bb] = [boxBlur(r, W, H, 2), boxBlur(g, W, H, 2), boxBlur(b, W, H, 2)];
  const distinct = new Float32Array(N);
  for (let i = 0; i < N; i++) distinct[i] = Math.hypot(rb[i] - mr, gb[i] - mg, bb[i] - mb);

  const dMax = quantile(detail, 0.95);
  const cMax = quantile(distinct, 0.95);
  const map = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const dx = (x - W / 2) / (0.35 * W);
      const dy = (y - H / 2) / (0.35 * H);
      const prior = 0.7 + 0.3 * Math.exp(-(dx * dx + dy * dy) / 2);
      map[i] = Math.min(1, detail[i] / dMax) ** 0.8 * (0.25 + Math.min(1, distinct[i] / cMax)) * prior;
    }
  }
  return { map, W, H };
}

// Fenêtre de ratio donné qui contient le plus de sujet
function bestWindow({ map, W, H }, ratio) {
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += map[y * W + x];
      I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row;
    }
  }
  const total = I[H * (W + 1) + W] || 1;
  const ww = W / H >= ratio ? Math.round(H * ratio) : W;
  const wh = W / H >= ratio ? H : Math.round(W / ratio);
  let best = { x: 0, y: 0, sum: -1 };
  for (let y = 0; y <= H - wh; y++) {
    for (let x = 0; x <= W - ww; x++) {
      const sum = I[(y + wh) * (W + 1) + x + ww] - I[y * (W + 1) + x + ww] - I[(y + wh) * (W + 1) + x] + I[y * (W + 1) + x];
      if (sum > best.sum) best = { x, y, sum };
    }
  }
  return { x: best.x, y: best.y, w: ww, h: wh, coverage: best.sum / total };
}

export async function cropTo(src, { width, height, ratios, photoCenter }) {
  const sal = await saliency(src.buffer);
  const srcRatio = src.width / src.height;

  // cadre le plus serré qui garde assez de sujet
  let win;
  let ratio;
  for (ratio of ratios) {
    win = bestWindow(sal, ratio);
    if (win.coverage >= COVERAGE_MIN || ratio >= srcRatio) break;
  }

  const scale = src.width / sal.W;
  const w = Math.min(src.width, Math.round(win.w * scale));
  const h = Math.min(src.height, Math.round(win.h * scale));
  const left = Math.max(0, Math.min(src.width - w, Math.round(win.x * scale)));
  let top = Math.max(0, Math.min(src.height - h, Math.round(win.y * scale)));
  // fenêtre descendue de 10 % : le sujet remonte au-dessus du bloc titre
  if (h < src.height) top = Math.min(src.height - h, Math.round(top + h * FOCUS_SHIFT));

  const photoH = Math.min(height, Math.round(width / (w / h)));
  const window = sharp(src.buffer).extract({ left, top, width: w, height: h });
  let frame;
  let mode;

  if (photoH >= height - 4) {
    mode = 'plein cadre';
    frame = await window.resize(width, height, { fit: 'cover' }).png({ compressionLevel: 1 }).toBuffer();
  } else {
    // photo nette + même photo floutée en fond, raccord en fondu
    mode = 'cadre élargi';
    const photoTop = photoCenter == null ? 0 : Math.max(0, Math.min(height - photoH, Math.round(photoCenter * height - photoH / 2)));
    const fadeTop = photoTop > 0 ? FADE / photoH : 0;
    const fadeBottom = photoTop + photoH < height ? FADE / photoH : 0;
    const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${photoH}">
      <defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity="${fadeTop ? 0 : 1}"/>
        <stop offset="${fadeTop}" stop-color="#fff" stop-opacity="1"/>
        <stop offset="${1 - fadeBottom}" stop-color="#fff" stop-opacity="1"/>
        <stop offset="1" stop-color="#fff" stop-opacity="${fadeBottom ? 0 : 1}"/>
      </linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#f)"/>
    </svg>`;
    const photo = await window
      .resize(width, photoH, { fit: 'cover' })
      .ensureAlpha()
      .composite([{ input: Buffer.from(mask), blend: 'dest-in' }])
      .png()
      .toBuffer();
    const backdrop = await sharp(src.buffer)
      .resize(width, height, { fit: 'cover' })
      .blur(45)
      .modulate({ brightness: 0.7 })
      .png()
      .toBuffer();
    frame = await sharp(backdrop)
      .composite([{ input: photo, top: photoTop, left: 0 }])
      .png({ compressionLevel: 1 })
      .toBuffer();
  }

  // luminance de la zone texte (60-100 % de la hauteur)
  const bandTop = Math.round(height * BAND_START);
  const { channels } = await sharp(frame)
    .extract({ left: 0, top: bandTop, width, height: height - bandTop })
    .greyscale()
    .stats();
  const luminance = channels[0].mean;

  return {
    buffer: await toMetaJpeg(frame),
    luminance,
    darken: luminance > LUMINANCE_MAX,
    info: `${mode}, ratio ${ratio}, sujet gardé ${Math.round(win.coverage * 100)} %`,
  };
}
