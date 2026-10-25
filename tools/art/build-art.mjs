// Turns the downloaded artworks (vendor/art/<code>.jpg) into game pixels, using the shared
// palette in data/palette.gpl and the style settings in tools/lib/art-style.mjs:
//   public/cards/art32.png + art32.json – 32x32 art for every card in public/data/cards.json (pool + tokens), one atlas
//   public/cards/art128/<code>.png      – 128x128 art per card (info panel, loaded on demand)
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { remap } from "../lib/palette.mjs";
import { ART_STYLE, boost, readGpl } from "../lib/art-style.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SRC = path.join(ROOT, "vendor/art");
const OUT = path.join(ROOT, "public/cards");
const PALETTE = readGpl(path.join(ROOT, "data/palette.gpl"));
const pool = JSON.parse(readFileSync(path.join(ROOT, "public/data/cards.json"), "utf-8")).map((c) => c.code);
mkdirSync(path.join(OUT, "art128"), { recursive: true });

/** Resize + boost + map to the shared palette; returns a PNG buffer. */
export async function renderArt(file, style) {
  const { size } = style;
  const px = await boost(sharp(file).resize(size, size, { fit: "cover", position: "centre", kernel: "lanczos3" }), style)
    .removeAlpha().raw().toBuffer();
  remap(px, size, size, PALETTE, style.dither);
  return sharp(px, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

const available = pool.filter((code) => existsSync(path.join(SRC, `${code}.jpg`)));
const missing = pool.filter((code) => !available.includes(code));

// 32x32 atlas, 32 tiles per row.
const PER_ROW = 32, T = ART_STYLE.small.size;
const rows = Math.max(1, Math.ceil(available.length / PER_ROW));
const tiles = [];
const frames = {};
for (const [i, code] of available.entries()) {
  const src = path.join(SRC, `${code}.jpg`);
  const x = (i % PER_ROW) * T, y = Math.floor(i / PER_ROW) * T;
  tiles.push({ input: await renderArt(src, ART_STYLE.small), left: x, top: y });
  frames[String(code)] = { frame: { x, y, w: T, h: T }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: T, h: T }, sourceSize: { w: T, h: T } };
  writeFileSync(path.join(OUT, "art128", `${code}.png`), await renderArt(src, ART_STYLE.large));
}
await sharp({ create: { width: PER_ROW * T, height: rows * T, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(tiles).png().toFile(path.join(OUT, "art32.png"));
writeFileSync(path.join(OUT, "art32.json"), JSON.stringify({ frames, meta: { image: "art32.png", size: { w: PER_ROW * T, h: rows * T }, scale: "1" } }));

console.log(`art: ${available.length} cards -> art32 atlas + art128 (${PALETTE.length}-colour palette)`);
if (missing.length) console.warn("no downloaded art for (run npm run fetch-art):", missing);
