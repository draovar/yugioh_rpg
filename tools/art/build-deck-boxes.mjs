// Deck box pictures for the deck shop: vendor/paid/deck-boxes/<CODE>.png (Konami's box art from Yugipedia's product
// shots, cut out and touched up by hand, kept in the private assets repo) → public/deck-boxes/<CODE>.png, pixel art drawn
// at 1x (DECK_BOX_STYLE in tools/lib/art-style.mjs, the hanger hole cut through; the soft photos looked smeary shown
// big). The cut-outs share one 200x300 frame with the box at the same pixels in each (deck-boxes/aligned/), so they're
// all cropped to the same rectangle and keep their places: every box hangs from its peg at the same point. Any other
// picture has its transparent padding cut (if it has transparency) and is fitted into that rectangle's size, top
// centred, first (no hole).
// Usage: node tools/art/build-deck-boxes.mjs
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { DECK_BOX_STYLE as STYLE, boost } from "../lib/art-style.mjs";
import { indexedPng } from "../lib/indexed-png.mjs";
import { buildPalette, remap } from "../lib/palette.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SRC = path.join(ROOT, "vendor/paid/deck-boxes");
const OUT = path.join(ROOT, "public/deck-boxes");
/** In the shared 200x300 frame: every cut-out's box lies inside CROP. */
const FRAME = { w: 200, h: 300 }, CROP = { left: 24, top: 29, width: 151, height: 248 };
/**
 * Output folder -> scale: the pegboard's boxes (DECK_BOX in src/shop/DeckShop.ts, 78x126 with the outline) and
 * large/, the cut-outs' own size (153x250, the deck unboxing's box, src/shop/DeckOpening.ts).
 */
const SIZES = { "": STYLE.scale, large: 1 };
/**
 * The hanger hole (a "euro slot": a slot with a round bump on top, where the pegboard's peg goes through), cut out of
 * every framed box so the board and the peg show through: "#" = hole, in pixels of the art at STYLE.scale from HOLE_AT
 * (found where the photos' gold backdrop shows through on most boxes; doubled for large/). The box pixels around it
 * get the outline colour, like its edge.
 */
const HOLE_AT = { x: 24, y: 7 };
const HOLE = [
  ".......####........",
  ".....########......",
  ".#################.",
  "###################",
  "###################",
  ".#################.",
];

if (!existsSync(SRC)) {
  console.error(`No ${path.relative(ROOT, SRC)}/: clone the private assets repo into vendor/paid (CLAUDE.md, Fresh clone).`);
  process.exit(1);
}
for (const dir of Object.keys(SIZES)) mkdirSync(path.join(OUT, dir), { recursive: true });
for (const file of readdirSync(SRC).filter((f) => f.endsWith(".png")).sort()) {
  const src = path.join(SRC, file);
  const { width, height, hasAlpha } = await sharp(src).metadata();
  const framed = width === FRAME.w && height === FRAME.h && hasAlpha;
  const box = await cutOut(src, framed, hasAlpha);
  const sizes = [];
  for (const [dir, scale] of Object.entries(SIZES)) {
    const { px, w, h } = await render(box, scale, framed);
    writeFileSync(path.join(OUT, dir, file), indexedPng(px, w, h));
    sizes.push(`${w}x${h}`);
  }
  console.log(`${file}: ${width}x${height}${framed ? " (frame)" : ""} -> ${sizes.join(", ")}`);
}

/** The box at CROP's size, transparent around it. */
async function cutOut(src, framed, hasAlpha) {
  if (framed) return sharp(src).extract(CROP).png().toBuffer();
  const trimmed = hasAlpha ? await sharp(src).trim({ threshold: 0 }).toBuffer() : src;
  return sharp(trimmed)
    .resize(CROP.width, CROP.height, { fit: "contain", position: "top", kernel: "lanczos3", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
}

/** The box at `scale` as pixel art, in a picture with 1px of outline all round (the hanger hole cut if `framed`). */
async function render(box, scale, framed) {
  // Colour (lanczos3, then boosted) and coverage separately; the colours mapped to the box's own palette.
  const art = { w: Math.round(CROP.width * scale), h: Math.round(CROP.height * scale) }, pic = { w: art.w + 2, h: art.h + 2 };
  const rgb = await boost(sharp(box).removeAlpha().resize(art.w, art.h, { kernel: "lanczos3", fit: "fill" }), STYLE).raw().toBuffer();
  const alpha = await sharp(box).extractChannel(3).resize(art.w, art.h, { kernel: "cubic", fit: "fill" }).raw().toBuffer();
  const opaque = [];
  for (let p = 0; p < art.w * art.h; p++) if (alpha[p] >= 128) opaque.push(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]);
  remap(rgb, art.w, art.h, buildPalette(Buffer.from(opaque), STYLE.colors), 0);

  // Hard edges (half covered or more is in), then the outline on every empty pixel touching the box.
  const px = Buffer.alloc(pic.w * pic.h * 4);
  for (let y = 0; y < art.h; y++) for (let x = 0; x < art.w; x++) {
    const p = y * art.w + x;
    if (alpha[p] >= 128) px.set([rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2], 255], ((y + 1) * pic.w + x + 1) * 4);
  }
  const solid = (x, y) => x >= 0 && y >= 0 && x < pic.w && y < pic.h && px[(y * pic.w + x) * 4 + 3] === 255;
  const edge = [];
  for (let y = 0; y < pic.h; y++) for (let x = 0; x < pic.w; x++) {
    if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) edge.push((y * pic.w + x) * 4);
  }
  for (const q of edge) px.set([...STYLE.outline, 255], q);
  if (framed) cutHole(px, pic.w, Math.round(scale / STYLE.scale));
  return { px, w: pic.w, h: pic.h };
}

/** Cuts HOLE (each of its pixels f x f here) out of a framed box's picture, its rim f px wide in the outline colour. */
function cutHole(px, w, f) {
  const hole = new Set();
  HOLE.forEach((row, dy) => [...row].forEach((ch, dx) => {
    if (ch !== "#") return;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) hole.add(((HOLE_AT.y + dy) * f + j + 1) * w + (HOLE_AT.x + dx) * f + i + 1);
  }));
  // The rim as wide as the small pictures' 1px outline.
  const rim = new Set();
  let front = [...hole];
  for (let k = 0; k < f; k++) {
    const next = [];
    for (const p of front) for (const q of [p - 1, p + 1, p - w, p + w]) {
      if (!hole.has(q) && !rim.has(q) && px[q * 4 + 3]) { rim.add(q); next.push(q); }
    }
    front = next;
  }
  for (const p of hole) px[p * 4 + 3] = 0;
  for (const q of rim) px.set(STYLE.outline, q * 4);
}
