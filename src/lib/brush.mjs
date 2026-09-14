import { createHash } from 'node:crypto';
import sharp from 'sharp';

// Texture de pinceau sec générée : fibres horizontales, manques qui laissent voir l'image, bouts effilochés
const W = 1200;
const H = 240;

function hash(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const ease = (t) => t * t * (3 - 2 * t);
const smoothstep = (e0, e1, x) => ease(Math.min(1, Math.max(0, (x - e0) / (e1 - e0))));

function noise2(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = ease(x - ix);
  const fy = ease(y - iy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

const noise1 = (x, seed) => noise2(x, 0.5, seed);

// Masque PNG (alpha) en data URI ; même clé = même trait
export async function brushMask(key) {
  const seed = parseInt(createHash('sha1').update(String(key)).digest('hex').slice(0, 6), 16);
  const px = Buffer.alloc(W * H * 4);

  for (let y = 0; y < H; y++) {
    // brins : longueur différente à chaque rangée
    const left = W * (0.01 + 0.08 * noise1(y / 5, seed + 1) ** 1.6);
    const right = W * (0.99 - 0.08 * noise1(y / 6, seed + 2) ** 1.6);

    for (let x = 0; x < W; x++) {
      const top = H * (0.08 + 0.1 * noise1(x / 150, seed + 3));
      const bottom = H * (0.8 + 0.12 * noise1(x / 180, seed + 4));
      let alpha = 0;

      if (y > top && y < bottom && x > left && x < right) {
        const edge = Math.min(y - top, bottom - y) / (H * 0.14);
        const end = Math.min(x - left, right - x) / (W * 0.1);
        const dry = 1 - Math.min(1, edge, end); // 0 au cœur, 1 sur les bords
        const fibre = noise2(x / 180, y / 5, seed + 5) * 0.65 + noise2(x / 40, y / 2.2, seed + 6) * 0.35;
        const threshold = 0.14 + dry ** 1.5 * 0.45; // cœur presque plein, manques sur les contours
        alpha = smoothstep(threshold - 0.05, threshold + 0.05, fibre);
      }

      const i = (y * W + x) * 4;
      px[i] = 255;
      px[i + 1] = 255;
      px[i + 2] = 255;
      px[i + 3] = Math.round(alpha * 255);
    }
  }

  const png = await sharp(px, { raw: { width: W, height: H, channels: 4 } }).blur(0.6).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}
