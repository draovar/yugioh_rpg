// Booster pack pictures for the card shop: vendor/paid/booster-packs/<SET>.png (any size; Konami's pack art, saved by
// hand, kept in the private assets repo like the paid art) → public/boosters/<SET>.png, the shelf size, and
// public/boosters/large/<SET>.png, the size a pack is opened at (both drawn at 1x). A picture with transparency has its
// transparent padding cut first; then it's scaled to each size, a pack of another shape stretched (the downloads are
// 1.72 to 1.85 times as tall as wide, so at most ~7%).
// Usage: node tools/art/build-boosters.mjs
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SRC = path.join(ROOT, "vendor/paid/booster-packs");
const OUT = path.join(ROOT, "public/boosters");
/** Output folder -> size: PACK in src/shop/Shop.ts, LARGE_PACK in src/shop/PackOpening.ts. */
const SIZES = { "": { w: 64, h: 110 }, large: { w: 100, h: 172 } };

if (!existsSync(SRC)) {
  console.error(`No ${path.relative(ROOT, SRC)}/: clone the private assets repo into vendor/paid (CLAUDE.md, Fresh clone).`);
  process.exit(1);
}
for (const dir of Object.keys(SIZES)) mkdirSync(path.join(OUT, dir), { recursive: true });
for (const file of readdirSync(SRC).filter((f) => f.endsWith(".png")).sort()) {
  const src = path.join(SRC, file);
  const { hasAlpha } = await sharp(src).metadata();
  const pack = hasAlpha ? sharp(src).trim({ threshold: 0 }) : sharp(src);
  const { data, info } = await pack.toBuffer({ resolveWithObject: true });
  for (const [dir, { w, h }] of Object.entries(SIZES)) {
    await sharp(data).resize(w, h, { fit: "fill", kernel: "lanczos3" }).png().toFile(path.join(OUT, dir, file));
  }
  console.log(`${file}: ${info.width}x${info.height} -> ${Object.values(SIZES).map(({ w, h }) => `${w}x${h}`).join(", ")}`);
}
