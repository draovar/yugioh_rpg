// Downscales the downloaded artworks (vendor/art/<code>.jpg) to the game's pixel sizes:
//   public/cards/art32.png + art32.json – 32x32 art for every card, one atlas (card faces)
//   public/cards/art128/<code>.png      – 128x128 art per card (info panel, loaded on demand)
// Colours are reduced to a small palette so the art sits with the pixel-art frames.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "vendor/art");
const OUT = path.join(ROOT, "public/cards");
const COLORS_SMALL = 24, COLORS_LARGE = 48;
const pool = JSON.parse(readFileSync(path.join(ROOT, "data/pool.json"), "utf-8")).cards;
mkdirSync(path.join(OUT, "art128"), { recursive: true });

const shrink = (file, size, colors) =>
  sharp(file).resize(size, size, { fit: "cover", position: "centre", kernel: "lanczos3" })
    .png({ palette: true, colors, dither: 0 }).toBuffer();

const available = pool.filter((code) => existsSync(path.join(SRC, `${code}.jpg`)));
const missing = pool.filter((code) => !available.includes(code));

// 32x32 atlas, 32 tiles per row.
const PER_ROW = 32, T = 32;
const rows = Math.max(1, Math.ceil(available.length / PER_ROW));
const tiles = [];
const frames = {};
for (const [i, code] of available.entries()) {
  const src = path.join(SRC, `${code}.jpg`);
  const x = (i % PER_ROW) * T, y = Math.floor(i / PER_ROW) * T;
  tiles.push({ input: await shrink(src, T, COLORS_SMALL), left: x, top: y });
  frames[String(code)] = { frame: { x, y, w: T, h: T }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: T, h: T }, sourceSize: { w: T, h: T } };
  await sharp(await shrink(src, 128, COLORS_LARGE)).toFile(path.join(OUT, "art128", `${code}.png`));
}
await sharp({ create: { width: PER_ROW * T, height: rows * T, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(tiles).png().toFile(path.join(OUT, "art32.png"));
writeFileSync(path.join(OUT, "art32.json"), JSON.stringify({ frames, meta: { image: "art32.png", size: { w: PER_ROW * T, h: rows * T }, scale: "1" } }));

console.log(`art: ${available.length} cards -> art32 atlas + art128`);
if (missing.length) console.warn("no downloaded art for (run npm run fetch-art):", missing);
