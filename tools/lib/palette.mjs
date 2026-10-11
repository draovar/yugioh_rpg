// Colour quantisation for pixel art: k-means palettes in Oklab (perceptual) space and
// nearest-colour remapping with optional 4x4 ordered (Bayer) dithering.
// Deterministic: the same input always gives the same palette.

// ---------------------------------------------------------------- Oklab
const toLinear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const toSrgb = (c) => { const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(v * 255))); };

export function rgbToOklab(r, g, b) {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToRgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

// ---------------------------------------------------------------- k-means palette
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Picks `k` colours that best represent the given pixels.
 * @param {Uint8Array|Buffer} rgb packed RGB (3 bytes per pixel); may be several images concatenated
 * @returns {number[][]} palette as [r, g, b], sorted dark to light
 */
export function buildPalette(rgb, k, { iterations = 20, maxSamples = 60000, seed = 1 } = {}) {
  const rand = mulberry32(seed);
  const total = rgb.length / 3;
  const step = Math.max(1, Math.floor(total / maxSamples));
  const pts = [];
  for (let i = 0; i < total; i += step) pts.push(rgbToOklab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]));
  const n = pts.length;
  const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

  // k-means++ initialisation: spread the starting centres out.
  const centres = [pts[Math.floor(rand() * n)]];
  const nearest = new Float64Array(n).fill(Infinity);
  while (centres.length < Math.min(k, n)) {
    const last = centres[centres.length - 1];
    let sum = 0;
    for (let i = 0; i < n; i++) { nearest[i] = Math.min(nearest[i], d2(pts[i], last)); sum += nearest[i]; }
    if (sum === 0) break;
    let r = rand() * sum, j = 0;
    while (j < n - 1 && (r -= nearest[j]) > 0) j++;
    centres.push(pts[j]);
  }

  const assign = new Int32Array(n);
  for (let it = 0; it < iterations; it++) {
    const acc = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < centres.length; c++) { const e = d2(pts[i], centres[c]); if (e < bd) { bd = e; best = c; } }
      assign[i] = best;
      const a = acc[best]; a[0] += pts[i][0]; a[1] += pts[i][1]; a[2] += pts[i][2]; a[3]++;
    }
    let moved = 0;
    for (let c = 0; c < centres.length; c++) {
      const a = acc[c];
      if (!a[3]) continue;
      const next = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
      moved += d2(next, centres[c]);
      centres[c] = next;
    }
    if (moved < 1e-10) break;
  }

  const unique = new Map();
  for (const c of centres) { const rgbC = oklabToRgb(...c); unique.set(rgbC.join(), rgbC); }
  return [...unique.values()].sort((p, q) => rgbToOklab(...p)[0] - rgbToOklab(...q)[0]);
}

// ---------------------------------------------------------------- remapping
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

/**
 * Maps every pixel to its perceptually nearest palette colour (in place).
 * @param {Buffer} rgb packed RGB of a width x height image
 * @param {number} dither ordered-dither strength in sRGB units (0 = none, ~24-48 = light)
 */
export function remap(rgb, width, height, palette, dither = 0) {
  const labs = palette.map((p) => rgbToOklab(...p));
  const cache = new Map();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const o = dither ? BAYER4[(y & 3) * 4 + (x & 3)] * dither : 0;
      const r = Math.max(0, Math.min(255, Math.round(rgb[i] + o)));
      const g = Math.max(0, Math.min(255, Math.round(rgb[i + 1] + o)));
      const b = Math.max(0, Math.min(255, Math.round(rgb[i + 2] + o)));
      const key = (r << 16) | (g << 8) | b;
      let best = cache.get(key);
      if (best === undefined) {
        const lab = rgbToOklab(r, g, b);
        let bd = Infinity;
        for (let c = 0; c < labs.length; c++) {
          const e = (lab[0] - labs[c][0]) ** 2 + (lab[1] - labs[c][1]) ** 2 + (lab[2] - labs[c][2]) ** 2;
          if (e < bd) { bd = e; best = c; }
        }
        cache.set(key, best);
      }
      rgb[i] = palette[best][0]; rgb[i + 1] = palette[best][1]; rgb[i + 2] = palette[best][2];
    }
  }
  return rgb;
}
