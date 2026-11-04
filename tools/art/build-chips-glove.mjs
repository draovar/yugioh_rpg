// The chips glove, the chip count in the overworld's HUD (src/ui/chipsGlove.ts): data/ui/chips-glove.png (drawn by
// hand, 64x64, three empty star holes on the cuff) → public/assets/ui/chips-glove.png, four frames side by side, each
// the glove cut out of its drawing with a light outline and a shadow: 0 to 3 of the cuff's stars (left, centre,
// right) filled in gold, a dark amber border around a light gold inside, the right one a shade darker in the cuff's
// shadow. Also the number's font, "glove-digits": bold 6x8 digits, white with a pale lower half and a 1px dark
// outline, the colours in the font (left white in Phaser) → public/assets/fonts/glove-digits.png + .xml.
// Usage: node tools/art/build-chips-glove.mjs
import path from "node:path";
import sharp from "sharp";
import { preview, writeBitmapFont } from "../lib/bmfont.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SRC = path.join(ROOT, "data/ui/chips-glove.png");
const OUT = path.join(ROOT, "public/assets/ui/chips-glove.png");
const FONTS = path.join(ROOT, "public/assets/fonts");

// --- The stars ----------------------------------------------------------------------------------------------------
// Each star: its shape ('#'), top-left in the drawing, the box cleared of the empty hole first (pixels darker than
// `dark` there become the cuff's `band` colour; the cuff's lighter shine stays) and whether it's in the shadow.
const SMALL = ["...#...", "..###..", "#######", ".#####.", "..###..", ".##.##.", ".#...#."];
const BIG = ["....#....", "...###...", "#########", ".#######.", "..#####..", "..##.##..", ".##...##.", ".#.....#."];
const STARS = [
  { shape: SMALL, x: 20, y: 47, box: [20, 26, 47, 55], band: [176, 181, 190], dark: 160 },
  { shape: BIG, x: 29, y: 48, box: [28, 38, 47, 55], band: [176, 181, 190], dark: 160 },
  { shape: SMALL, x: 41, y: 47, box: [41, 48, 47, 53], band: [104, 106, 116], dark: 80, shade: true },
];
const BORDER = [128, 84, 18], INSIDE = [254, 232, 88];
const SHADE_BORDER = [96, 62, 14], SHADE_INSIDE = [219, 187, 53];

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const luma = (d, i) => 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];

/** The drawing with the first `stars` stars filled. */
function withStars(stars) {
  const d = Buffer.from(data);
  const put = (x, y, c) => d.set([...c, 255], (y * W + x) * 4);
  for (const s of STARS.slice(0, stars)) {
    const [x0, x1, y0, y1] = s.box;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (luma(d, (y * W + x) * 4) < s.dark) put(x, y, s.band);
    const on = (x, y) => s.shape[y - s.y]?.[x - s.x] === "#";
    const [border, inside] = s.shade ? [SHADE_BORDER, SHADE_INSIDE] : [BORDER, INSIDE];
    s.shape.forEach((row, ry) => [...row].forEach((ch, rx) => {
      if (ch !== "#") return;
      const x = s.x + rx, y = s.y + ry;
      const edge = !on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1);
      put(x, y, edge ? border : inside);
    }));
  }
  return d;
}

// Cut to the glove (its opaque pixels' box) with room for a 1px light outline around it and the outlined shape's
// shadow 2px down-right, so it stands out on any ground; the frames (0 to 3 stars) side by side.
const OUTLINE = [255, 244, 214], SHADOW_ALPHA = 128, PAD = { left: 1, top: 1, right: 3, bottom: 3 };
const FRAMES = STARS.length + 1;
let left = W, top = info.height, right = 0, bottom = 0;
for (let y = 0; y < info.height; y++) for (let x = 0; x < W; x++) {
  if (data[(y * W + x) * 4 + 3] < 128) continue;
  left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
}
const fw = right - left + 1 + PAD.left + PAD.right, fh = bottom - top + 1 + PAD.top + PAD.bottom;
const sheetW = fw * FRAMES, sheet = Buffer.alloc(sheetW * fh * 4);
for (let n = 0; n < FRAMES; n++) {
  const d = withStars(n);
  const at = (x, y) => ((y - PAD.top + top) * W + x - PAD.left + left) * 4;
  const glove = (x, y) => x >= PAD.left && x < fw - PAD.right && y >= PAD.top && y < fh - PAD.bottom && d[at(x, y) + 3] >= 128;
  const outlined = (x, y) => [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => glove(x + dx, y + dy)));
  const pixel = (x, y) => {
    if (glove(x, y)) return [...d.subarray(at(x, y), at(x, y) + 3), 255];
    if (outlined(x, y)) return [...OUTLINE, 255];
    if (outlined(x - 2, y - 2)) return [0, 0, 0, SHADOW_ALPHA];
    return null;
  };
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const px = pixel(x, y);
    if (px) sheet.set(px, (y * sheetW + n * fw + x) * 4);
  }
}
await sharp(sheet, { raw: { width: sheetW, height: fh, channels: 4 } }).png().toFile(OUT);
console.log(`chips-glove: ${FRAMES} frames of ${fw}x${fh}, the glove cut at ${left},${top} of the drawing and placed at ` +
  `${PAD.left},${PAD.top} (FRAME / NUMBER in src/ui/chipsGlove.ts)`);

// --- The digits ---------------------------------------------------------------------------------------------------
const DIGITS = {
  0: [".####.", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", ".####."],
  1: ["..##..", ".###..", "..##..", "..##..", "..##..", "..##..", "..##..", ".####."],
  2: [".####.", "##..##", "....##", "...##.", "..##..", ".##...", "##....", "######"],
  3: [".####.", "##..##", "....##", "..###.", "....##", "....##", "##..##", ".####."],
  4: ["...##.", "..###.", ".####.", "##.##.", "######", "...##.", "...##.", "...##."],
  5: ["######", "##....", "##....", "#####.", "....##", "....##", "##..##", ".####."],
  6: [".####.", "##..##", "##....", "#####.", "##..##", "##..##", "##..##", ".####."],
  7: ["######", "....##", "....##", "...##.", "..##..", "..##..", "..##..", "..##.."],
  8: [".####.", "##..##", "##..##", ".####.", "##..##", "##..##", "##..##", ".####."],
  9: [".####.", "##..##", "##..##", "##..##", ".#####", "....##", "##..##", ".####."],
};
// Palette indices: 1 outline (the glove's darkest red), 2 white (the top half), 3 pale (the lower half).
const PALETTE = [null, [20, 8, 8], [255, 255, 255], [206, 204, 214]];
const glyphs = Object.entries(DIGITS).map(([ch, rows]) => {
  // A 1px outline all round: the bitmap is 2px bigger, drawn 1px up and left of the pen.
  const bits = Array.from({ length: rows.length + 2 }, () => Array(rows[0].length + 2).fill(0));
  const ink = (r, c) => rows[r]?.[c] === "#";
  bits.forEach((row, r) => row.forEach((_, c) => {
    if (ink(r - 1, c - 1)) row[c] = r - 1 < rows.length / 2 ? 2 : 3;
    else if ([-1, 0, 1].some((dr) => [-1, 0, 1].some((dc) => ink(r - 1 + dr, c - 1 + dc)))) row[c] = 1;
  }));
  // Digits 1px apart: neighbours' outlines share the column between them.
  return { code: ch.codePointAt(0), bits, rowTop: -1, xoffset: -1, advance: rows[0].length + 1 };
});
const { width, height } = await writeBitmapFont(FONTS, "glove-digits", glyphs, { capHeight: 8, lineHeight: 10, palette: PALETTE });
console.log(`glove-digits: ${glyphs.length} glyphs, atlas ${width}x${height}`);
// Preview: the digits' ink only, from the pen.
const inked = glyphs.map((g) => ({ ...g, rowTop: 0, bits: g.bits.slice(1).map((row) => row.slice(1).map((v) => (v > 1 ? 1 : 0))) }));
console.log(preview(inked, "0123456789", 8));
