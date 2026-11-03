// Deck box pictures for the deck shop: vendor/paid/deck-boxes/<CODE>.png (Konami's box art from Yugipedia's product
// shots, cut out and touched up by hand, kept in the private assets repo) → public/deck-boxes/<CODE>.png, pixel art drawn
// at 1x (DECK_BOX_STYLE in tools/lib/art-style.mjs: half the resolution, the box's own 32 colours, hard edges, a 1px
// dark outline, the hanger hole cut through; the soft photos looked smeary shown big). The cut-outs share one 200x300
// frame with the box at the same pixels in each (deck-boxes/aligned/), so they're all cropped to the same rectangle and
// keep their places: every box hangs from its peg at the same point. Any other picture has its transparent padding cut
// (if it has transparency) and is fitted into that rectangle's size, top centred, first (no hole).
// Usage: node tools/art/build-deck-boxes.mjs
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { DECK_BOX_STYLE as S, boost } from "../lib/art-style.mjs";
import { indexedPng } from "../lib/indexed-png.mjs";
import { buildPalette, remap } from "../lib/palette.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SRC = path.join(ROOT, "vendor/paid/deck-boxes");
const OUT = path.join(ROOT, "public/deck-boxes");
/** In the shared 200x300 frame: every cut-out's box lies inside CROP. */
const FRAME = { w: 200, h: 300 }, CROP = { left: 24, top: 29, width: 151, height: 248 };
/** The art's size, and the picture's (1px of outline all round): DECK_BOX in src/shop/DeckShop.ts. */
const ART = { w: Math.round(CROP.width * S.scale), h: Math.round(CROP.height * S.scale) };
const PIC = { w: ART.w + 2, h: ART.h + 2 };
/**
 * The hanger hole (a "euro slot": a slot with a round bump on top, where the pegboard's peg goes through), cut out of
 * every framed box so the board and the peg show through: "#" = hole, in art pixels from HOLE_AT (found where the
 * photos' gold backdrop shows through on most boxes). The box pixels around it get the outline colour, like its edge.
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
mkdirSync(OUT, { recursive: true });
for (const file of readdirSync(SRC).filter((f) => f.endsWith(".png")).sort()) {
  const src = path.join(SRC, file);
  const { width, height, hasAlpha } = await sharp(src).metadata();
  const framed = width === FRAME.w && height === FRAME.h && hasAlpha;
  // The box at CROP's size, transparent around it.
  const box = framed
    ? await sharp(src).extract(CROP).png().toBuffer()
    : await sharp(hasAlpha ? await sharp(src).trim({ threshold: 0 }).toBuffer() : src)
      .resize(CROP.width, CROP.height, { fit: "contain", position: "top", kernel: "lanczos3", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toBuffer();

  // Half size: colour (lanczos3, then boosted) and coverage separately; the colours mapped to the box's own palette.
  const rgb = await boost(sharp(box).removeAlpha().resize(ART.w, ART.h, { kernel: "lanczos3", fit: "fill" }), S).raw().toBuffer();
  const alpha = await sharp(box).extractChannel(3).resize(ART.w, ART.h, { kernel: "cubic", fit: "fill" }).raw().toBuffer();
  const opaque = [];
  for (let p = 0; p < ART.w * ART.h; p++) if (alpha[p] >= 128) opaque.push(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]);
  remap(rgb, ART.w, ART.h, buildPalette(Buffer.from(opaque), S.colors), 0);

  // Into the picture with 1px to spare all round: hard edges (half covered or more is in), then the outline on every
  // empty pixel touching the box.
  const px = Buffer.alloc(PIC.w * PIC.h * 4);
  for (let y = 0; y < ART.h; y++) for (let x = 0; x < ART.w; x++) {
    const p = y * ART.w + x, q = ((y + 1) * PIC.w + x + 1) * 4;
    if (alpha[p] < 128) continue;
    px[q] = rgb[p * 3]; px[q + 1] = rgb[p * 3 + 1]; px[q + 2] = rgb[p * 3 + 2]; px[q + 3] = 255;
  }
  const solid = (x, y) => x >= 0 && y >= 0 && x < PIC.w && y < PIC.h && px[(y * PIC.w + x) * 4 + 3] === 255;
  const edge = [];
  for (let y = 0; y < PIC.h; y++) for (let x = 0; x < PIC.w; x++) {
    if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) edge.push((y * PIC.w + x) * 4);
  }
  for (const q of edge) { [px[q], px[q + 1], px[q + 2]] = S.outline; px[q + 3] = 255; }
  if (framed) {
    const hole = new Set();
    HOLE.forEach((row, dy) => [...row].forEach((ch, dx) => { if (ch === "#") hole.add((HOLE_AT.y + dy + 1) * PIC.w + HOLE_AT.x + dx + 1); }));
    const rim = new Set();
    for (const p of hole) for (const q of [p - 1, p + 1, p - PIC.w, p + PIC.w]) if (!hole.has(q) && px[q * 4 + 3]) rim.add(q);
    for (const p of hole) px[p * 4 + 3] = 0;
    for (const q of rim) [px[q * 4], px[q * 4 + 1], px[q * 4 + 2]] = S.outline;
  }
  writeFileSync(path.join(OUT, file), indexedPng(px, PIC.w, PIC.h));
  console.log(`${file}: ${width}x${height}${framed ? " (frame)" : ""} -> ${PIC.w}x${PIC.h}`);
}
