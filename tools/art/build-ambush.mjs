// Ambush sheets: an NPC jumping out of a hedge (the maze's random encounters, src/overworld/ambush.ts). For every
// name in characters.json's "ambush" list, one row of 32x32 frames drawn from that character's down frames in
// public/assets/overworld/characters.png (run build-characters first; `npm run build-characters` runs both):
//   public/assets/overworld/ambush/<name>.png
//   0     a dark hollow opening in the hedge
//   1, 2  eyes in it (looking ahead / glancing aside)
//   3     head pushed out through the leaves
//   4     crouched in front of the hedge, leaves in the hair
//   5     leaping (stretched step frame)
//   6     landing (squashed)
//   7, 8  single leaves (particles)
//   9     leaping sideways out of a hedge beside the path (stretched side step frame, facing right; flipped for left)
// The frames sit on the hedge face: the frame's bottom edge is the face's bottom edge, the face covers rows 16-31.
// Leaf colours are the maze hedge face's greens, so the leaves read as torn from it.
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "public/assets/overworld/ambush");
const S = 32, FRAMES = 10;
const spec = JSON.parse(readFileSync(path.join(ROOT, "data/characters/characters.json"), "utf-8"));
const built = JSON.parse(readFileSync(path.join(ROOT, "public/assets/overworld/characters.json"), "utf-8"));
const chars = await sharp(path.join(ROOT, "public/assets/overworld/characters.png")).raw().toBuffer({ resolveWithObject: true });

const LEAF = { outline: [26, 82, 73], dark: [23, 112, 75], mid: [38, 139, 73], light: [45, 162, 51] };
const HOLLOW = [12, 30, 32], HOLLOW_RIM = [20, 48, 48];
const EYE_WHITE = [240, 240, 240], PUPIL = [56, 48, 56];

const blank = () => Buffer.alloc(S * S * 4);
function set(px, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
}
/** Frame `k` (0..8: down / side / up × stand, step, step) of a character in characters.png. */
function charFrame(name, k) {
  const row = built.names.indexOf(name);
  if (row < 0) throw new Error(`no character "${name}" in characters.json`);
  const px = blank(), W = chars.info.width;
  for (let y = 0; y < S; y++) chars.data.copy(px, y * S * 4, ((row * S + y) * W + k * S) * 4, ((row * S + y) * W + (k + 1) * S) * 4);
  return px;
}
/**
 * Rows of `src` moved and stretched: each [from, to, destFrom, destTo] maps a row range by nearest row. Drawn over
 * `under` (its opaque pixels only).
 */
function remap(src, segments, under = blank()) {
  const px = under;
  for (const [a, b, c, d] of segments) for (let y = c; y <= d; y++) {
    const sy = a + Math.floor(((y - c) * (b - a + 1)) / (d - c + 1));
    for (let x = 0; x < S; x++) if (src[(sy * S + x) * 4 + 3]) src.copy(px, (y * S + x) * 4, (sy * S + x) * 4, (sy * S + x + 1) * 4);
  }
  return px;
}
/** A small leaf: 3x2, its tip pointing right (or left when flipped). */
function leaf(px, x, y, flip = false) {
  const f = (dx) => (flip ? x + 2 - dx : x + dx);
  set(px, f(0), y, LEAF.mid); set(px, f(1), y, LEAF.light); set(px, f(2), y, LEAF.light);
  set(px, f(0), y + 1, LEAF.outline); set(px, f(1), y + 1, LEAF.dark);
}
/** Leafy fringe across columns x0..x1 from about row `top` down to the frame bottom: a ragged top edge of leaf tips. */
function fringe(px, x0, x1, top) {
  const EDGE = [2, 1, 1, 2, 3, 2, 1, 2, 3, 3, 2, 1, 1, 2, 3, 2, 1, 2];
  for (let x = x0; x <= x1; x++) for (let y = top + EDGE[(x - x0) % EDGE.length]; y < S; y++) set(px, x, y, LEAF.outline);
  // Leaves in staggered rows over the dark base, the top row sticking out above it.
  for (let y = top, row = 0; y < S; y += 2, row++) {
    for (let x = x0 - 1 + (row % 2) * 2; x <= x1 - 1; x += 4) leaf(px, x, y, (x + row) % 3 === 0);
  }
}
/** The dark hollow in the hedge face: a solid core fading out in dithered rings, so it has no hard edge. */
function hollow(px = blank()) {
  const cx = 15.5, cy = 24, rx = 11, ry = 7;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (d <= 0.45 || (d <= 0.7 && (x + y) % 2 === 0)) set(px, x, y, HOLLOW);
    else if (d <= 0.7 || (d <= 1 && x % 2 === 0 && (y + (x >> 1)) % 2 === 0)) set(px, x, y, HOLLOW_RIM);
  }
  return px;
}
/** The hollow with two eyes; `glance` shifts eyes and pupils one pixel right. */
function eyes(glance) {
  const px = hollow(), g = glance ? 1 : 0;
  for (const [ex, inner] of [[13, 1], [16, 0]]) for (let dy = 0; dy < 2; dy++) {
    // His own eyes: a white outer column and a dark pupil inside; glancing, both pupils go right.
    const pupil = glance ? 1 : inner;
    set(px, ex + g + pupil, 23 + dy, PUPIL);
    set(px, ex + g + 1 - pupil, 23 + dy, EYE_WHITE);
  }
  return px;
}

mkdirSync(OUT, { recursive: true });
for (const name of spec.ambush ?? []) {
  const stand = charFrame(name, 0), step = charFrame(name, 1), sideStep = charFrame(name, 4);
  // Head (rows 1-14) and body (15-29) of the 32x32 down frame, moved separately: squash bends the knees.
  const headOut = remap(stand, [[1, 19, 13, 31]], hollow());
  fringe(headOut, 7, 24, 26);
  leaf(headOut, 13, 13); leaf(headOut, 17, 14, true);
  const crouch = remap(stand, [[1, 14, 5, 18], [15, 29, 19, 29]]);
  leaf(crouch, 12, 5); leaf(crouch, 18, 6, true); leaf(crouch, 9, 20);
  const leap = remap(step, [[1, 14, 0, 13], [15, 29, 14, 29]]);
  leaf(leap, 16, 0, true);
  const land = remap(stand, [[1, 14, 3, 16], [15, 29, 17, 29]]);
  const leafA = blank(), leafB = blank();
  leaf(leafA, 15, 15); leaf(leafB, 15, 15, true);
  const sideLeap = remap(sideStep, [[1, 14, 0, 13], [15, 29, 14, 29]]);
  leaf(sideLeap, 12, 1, true); leaf(sideLeap, 10, 17);

  const frames = [hollow(), eyes(false), eyes(true), headOut, crouch, leap, land, leafA, leafB, sideLeap];
  const raw = Buffer.alloc(FRAMES * S * S * 4);
  frames.forEach((px, k) => { for (let y = 0; y < S; y++) px.copy(raw, (y * FRAMES + k) * S * 4, y * S * 4, (y + 1) * S * 4); });
  await sharp(raw, { raw: { width: FRAMES * S, height: S, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(OUT, `${name}.png`));
  console.log(`ambush/${name}.png: ${FRAMES} frames`);
}
