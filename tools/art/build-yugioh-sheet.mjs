// The generated part of the custom Yu-Gi-Oh tileset (vendor/paid/custom/yugioh_tileset.png, data/maps/tilesets/yugioh.tsj),
// 20 tiles wide. Rows 0-14 are drawn by hand and copied byte for byte; every entry of PIECES is drawn on a base and put
// at its own tile position:
//   cols 0-9,   rows 15-30  billboards on the sheet's blank billboard (rows 4-7): tournament, cardShop, museum, booster
//   cols 0-9,   rows 31-40  plaque signs on the pack's plain bakery sign: cards, packs
//   cols 0-9,   rows 41-50  shop signs in the pack's empty sign frame: cardShopFrame, duelArena
//   cols 0-9,   rows 51-52  mall wall ads on the pack's mall wall: duelistAd, duelAd
//   cols 10-19, rows 15-18  gameStore on the pack's gun store sign (a game pad for the gun, a level star)
//   cols 0-15,  rows 53-60  gadgets on the pack's hardware sign (a Duel Disk for the hammer)
// The pack's pieces are read from vendor/paid/themes/ when this runs, so no paid pixels are in this script.
// Keep every piece where it is (placed tiles keep their ids) and put new ones in free space: overlaps are refused, the
// .tsj's size follows. (The sheet was 10 tiles wide until the hardware sign; main-city's tiles were renumbered then.)
// Like the pack's 32x32 art (16x16 art doubled), everything is drawn in 2x2 "art pixels". Small text is tiny5 (the game's
// 3x5 font), headlines a 5x7 font, plaque words a bold script font like the pack's "Bakery"; colours mostly the pack's.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SHEET = path.join(ROOT, "vendor/paid/custom/yugioh_tileset.png");
const THEMES = path.join(ROOT, "vendor/paid/themes");
const TSJ = path.join(ROOT, "data/maps/tilesets/yugioh.tsj");
const FONTS = path.join(ROOT, "public/assets/fonts");
const KEEP_ROWS = 15, COLS = 20, TILE = 16, ART = TILE / 2;

const C = {
  ink: [58, 58, 80], ink2: [45, 66, 117], navy: [60, 81, 127],
  b1: [61, 86, 210], b2: [62, 100, 213], b3: [66, 128, 221], b4: [73, 149, 227], sky: [186, 210, 224],
  white: [248, 248, 248], off: [235, 228, 242], lav: [198, 189, 213], lav2: [216, 208, 224],
  g1: [230, 140, 22], g2: [242, 178, 43], g3: [248, 210, 57], g4: [255, 241, 168],
  r0: [107, 56, 59], r1: [158, 43, 45], r2: [217, 50, 50], r3: [252, 92, 70],
  w0: [92, 74, 68], w1: [126, 97, 81], w2: [168, 95, 70], w3: [181, 117, 77],
  s0: [157, 124, 91], s1: [199, 140, 89], s2: [218, 164, 99], s3: [237, 196, 130],
  p0: [30, 26, 54], p1: [44, 38, 78], p2: [62, 52, 104], p3: [86, 72, 136], p4: [124, 104, 176],
  t1: [28, 125, 77], t2: [33, 152, 61], m1: [165, 72, 115], o2: [233, 157, 29], dune: [237, 147, 30],
  skin: [240, 174, 128], skin2: [212, 154, 113],
};
const mix = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));

class Canvas {
  constructor(w, h, fill = null) { this.w = w; this.h = h; this.px = Array.from({ length: w * h }, () => fill); }
  get(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y * this.w + x] : null; }
  set(x, y, c) { if (c && x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c; }
  clear(x, y) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = null; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  each(fn) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) fn(x, y); }
  /** Rows of characters, key: char -> colour (others are skipped). */
  sprite(rows, key, x, y) { rows.forEach((r, j) => [...r].forEach((ch, i) => this.set(x + i, y + j, key[ch]))); }
  /** A mask (Set of "x,y") painted with fn(x, y), outlined (4 neighbours) with `outline`. */
  shape(mask, fn, outline) {
    const pts = [...mask].map((k) => k.split(",").map(Number));
    if (outline) for (const [x, y] of pts) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
      if (!mask.has(`${x + dx},${y + dy}`)) this.set(x + dx, y + dy, outline);
    for (const [x, y] of pts) this.set(x, y, fn(x, y));
  }
  /** Another canvas drawn on this one at (x, y), its transparent pixels skipped. */
  paste(cv, x, y) { cv.each((i, j) => this.set(x + i, y + j, cv.get(i, j))); }
}
const maskOf = (test, x0, y0, x1, y1) => {
  const m = new Set();
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (test(x, y)) m.add(`${x},${y}`);
  return m;
};
/** Colour by a pixel's place in its row of the mask: ramp[0] on the left (lit) to the last on the right. */
const rowShade = (mask, ramp) => (x, y) => {
  let a = x, b = x;
  while (mask.has(`${a - 1},${y}`)) a--;
  while (mask.has(`${b + 1},${y}`)) b++;
  const t = b === a ? 0.5 : (x - a) / (b - a);
  return ramp[Math.min(ramp.length - 1, Math.floor(t * ramp.length))];
};

/** A tile rectangle of a sheet as a canvas of art pixels (the sheet must be 2x2 blocks there). */
async function region(file, tx, ty, w, h) {
  const { data, info } = await sharp(file).extract({ left: tx * TILE, top: ty * TILE, width: w * TILE, height: h * TILE })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cv = new Canvas(w * ART, h * ART);
  cv.each((x, y) => {
    const at = (dx, dy) => data.readUInt32BE(((y * 2 + dy) * info.width + x * 2 + dx) * 4);
    if (at(1, 0) !== at(0, 0) || at(0, 1) !== at(0, 0) || at(1, 1) !== at(0, 0))
      throw new Error(`${path.basename(file)} ${tx},${ty}: not 2x2 art pixels at ${x},${y}`);
    const i = (y * 2 * info.width + x * 2) * 4;
    if (data[i + 3]) cv.set(x, y, [data[i], data[i + 1], data[i + 2], data[i + 3]]);
  });
  return cv;
}

// ---------- text ----------
const SMALL = {};
{
  const xml = readFileSync(path.join(FONTS, "tiny5.xml"), "utf-8");
  const { data, info } = await sharp(path.join(FONTS, "tiny5.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const m of xml.matchAll(/<char id="(\d+)" x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" xoffset="(-?\d+)" yoffset="(-?\d+)" xadvance="(\d+)"/g)) {
    const [id, x, y, w, h, xo, yo, adv] = m.slice(1).map(Number);
    const rows = Array.from({ length: h }, (_, j) =>
      Array.from({ length: w }, (_, i) => (data[((y + j) * info.width + x + i) * 4 + 3] ? "#" : ".")).join(""));
    SMALL[String.fromCharCode(id)] = { rows, xo, yo, adv };
  }
}
const BIG = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["###", ".#.", ".#.", ".#.", ".#.", ".#.", "###"],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  "!": ["#", "#", "#", "#", "#", ".", "#"],
  " ": ["...", "...", "...", "...", "...", "...", "..."],
};
// Bold script for plaque words (like the pack's "Bakery"): capitals 10 rows, lowercase 6 (x-height starts at row 4),
// ascenders from row 1, descenders to row 11. [rows, top row].
const SCRIPT = {
  C: [["..####.", ".##..##", "##.....", "##.....", "##.....", "##.....", "##.....", "##.....", ".##..##", "..####."], 0],
  G: [["..####.", ".##..##", "##.....", "##.....", "##.....", "##.####", "##...##", "##...##", ".##..##", "..####."], 0],
  D: [["#####..", "##..##.", "##...##", "##...##", "##...##", "##...##", "##...##", "##...##", "##..##.", "#####.."], 0],
  P: [["######.", "##...##", "##...##", "##...##", "##..##.", "#####..", "##.....", "##.....", "##.....", "##....."], 0],
  a: [[".###.", "...##", ".####", "##.##", "##.##", ".####"], 4],
  c: [[".####", "##...", "##...", "##...", "##...", ".####"], 4],
  d: [["...##", "...##", "...##", ".####", "##.##", "##.##", "##.##", "##.##", ".####"], 1],
  e: [[".###.", "##.##", "#####", "##...", "##...", ".####"], 4],
  k: [["##...", "##...", "##...", "##.##", "####.", "###..", "####.", "##.##", "##.##"], 1],
  m: [["#######.", "##.##.##", "##.##.##", "##.##.##", "##.##.##", "##.##.##"], 4],
  r: [["##.##", "#####", "##...", "##...", "##...", "##..."], 4],
  s: [[".####", "##...", ".###.", "...##", "...##", "####."], 4],
  u: [["##.##", "##.##", "##.##", "##.##", "##.##", ".####"], 4],
};
const glyph = (font, ch) => {
  const g = font === "big" ? BIG[ch] && { rows: BIG[ch], xo: 0, yo: 0, adv: BIG[ch][0].length + 1 }
    : font === "script" ? SCRIPT[ch] && { rows: SCRIPT[ch][0], xo: 0, yo: SCRIPT[ch][1], adv: Math.max(...SCRIPT[ch][0].map((r) => r.length)) + 1 }
    : SMALL[ch];
  if (!g) throw new Error(`no "${ch}" in the ${font} font`);
  return g;
};
const textWidth = (str, font) => [...str].reduce((w, ch) => w + glyph(font, ch).adv, 0) - 1;
/** The pixels of a text centred on x = `center` (a Set of "x,y"). */
function textMask(str, center, y, font) {
  const mask = new Set();
  let x = Math.round(center - textWidth(str, font) / 2);
  for (const ch of str) {
    const g = glyph(font, ch);
    g.rows.forEach((r, j) => [...r].forEach((p, i) => { if (p === "#") mask.add(`${x + g.xo + i},${y + g.yo + j}`); }));
    x += g.adv;
  }
  return mask;
}
/** Text centred on x = `center`, with an optional outline (8 neighbours) and drop shadow; colour may be fn(x, y). */
function text(cv, str, center, y, colour, { font = "small", outline, shadow } = {}) {
  const mask = textMask(str, center, y, font);
  const pts = [...mask].map((k) => k.split(",").map(Number));
  const around = (offsets, c) => { for (const [px, py] of pts) for (const [dx, dy] of offsets) if (!mask.has(`${px + dx},${py + dy}`)) cv.set(px + dx, py + dy, c); };
  if (shadow) around([[0, 1], [1, 1], [0, 2], [1, 2]], shadow);
  if (outline) around([[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]], outline);
  for (const [px, py] of pts) cv.set(px, py, typeof colour === "function" ? colour(px, py) : colour);
}

// ---------- backgrounds and trim ----------
/** Vertical gradient in bands, a checkered row between bands. */
function bands(cv, colours, y0 = 0, y1 = cv.h - 1) {
  const n = colours.length, span = (y1 - y0 + 1) / n;
  for (let y = y0; y <= y1; y++) {
    const f = (y - y0) / span, i = Math.min(n - 1, Math.floor(f));
    const edge = i < n - 1 && f - i > 1 - 1 / span;
    for (let x = 0; x < cv.w; x++) cv.set(x, y, edge && (x + y) % 2 ? colours[i + 1] : colours[i]);
  }
}
/** Rounded corners in the frame colour (as on the SALE billboard). */
function corners(cv, c) {
  const { w, h } = cv;
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [w - 1, 0], [w - 2, 0], [w - 1, 1],
    [0, h - 1], [1, h - 1], [0, h - 2], [w - 1, h - 1], [w - 2, h - 1], [w - 1, h - 2]]) cv.set(x, y, c);
}
function sparkle(cv, x, y, c, big = false) {
  cv.set(x, y, c);
  if (big) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) cv.set(x + dx, y + dy, mix(cv.get(x + dx, y + dy) ?? c, c, 0.6));
}
/** Ribbon: a bar with notched tails folded behind it. */
function ribbon(cv, x, y, w, h, face, dark, tail) {
  for (let j = 0; j < h; j++) for (let i = 0; i < 3; i++) {
    if (i === 0 && j === Math.floor(h / 2)) continue;
    cv.set(x - 3 + i, y + 1 + j, tail);
    cv.set(x + w + 2 - i, y + 1 + j, tail);
  }
  cv.set(x - 1, y + h, dark); cv.set(x + w, y + h, dark);
  cv.rect(x, y, w, h, face);
  cv.rect(x, y + h - 1, w, 1, dark);
}
/** Spotlight: lightens what lies within `spread` radians of direction `ang` from (ox, oy). */
function beam(cv, ox, oy, ang, spread, amount) {
  cv.each((x, y) => {
    let d = Math.abs(Math.atan2(y - oy, x - ox) - ang);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d < spread) cv.set(x, y, mix(cv.get(x, y), C.off, amount * (d < spread * 0.55 ? 1 : 0.5)));
  });
}
/** Sunburst: n rays around (cx, cy) in colours a/b. */
function rays(cv, cx, cy, n, a, b) {
  cv.each((x, y) => cv.set(x, y, Math.floor(((Math.atan2(y - cy, x - cx) + Math.PI) / (2 * Math.PI)) * n) % 2 ? a : b));
}
/** Zigzag lightning bolt, top at (x, y). */
function bolt(cv, x, y, c, dark) {
  cv.sprite(["..##", ".##.", "##..", "####", "..##", ".##.", ".#..", "#..."], { "#": c }, x, y);
  cv.sprite(["....#", "...#.", "..#..", "....#", "....#", "...#.", "..#..", ".#..."], { "#": dark }, x, y);
}

// ---------- props ----------
/** Gold cup (x = its centre line) on a wooden base. */
function trophy(cv, x, y) {
  const bowl = maskOf((i, j) => Math.abs(i - x + 0.5) <= (j - y < 5 ? 6 : 6 - (j - y - 4) * 1.4), x - 6, y, x + 5, y + 7);
  const stem = maskOf(() => true, x - 1, y + 8, x, y + 10);
  const foot = maskOf((i, j) => Math.abs(i - x + 0.5) <= (j === y + 11 ? 2 : 3), x - 3, y + 11, x + 2, y + 12);
  for (const [hx, inward] of [[x - 8, 1], [x + 7, -1]]) {
    for (const [i, j] of [[0, 1], [0, 2], [0, 3], [inward, 4], [inward, 0]]) cv.set(hx + i, y + j, C.g1);
    for (const j of [1, 2, 3]) cv.set(hx + inward, y + j, C.ink);
  }
  const cup = new Set([...bowl, ...stem, ...foot]);
  cv.shape(cup, rowShade(cup, [C.g4, C.g3, C.g3, C.g2, C.g2, C.g1]), C.w0);
  for (let i = -5; i <= 4; i++) cv.set(x + i, y, C.g4);
  cv.sprite([".g..", "gwwy", "..g."], { g: C.g4, w: C.white, y: C.g3 }, x - 2, y + 2);   // glint
  cv.shape(maskOf(() => true, x - 5, y + 14, x + 4, y + 17), (i, j) => (j === y + 14 ? C.w3 : j === y + 17 ? C.w0 : C.w1), C.ink);
  cv.rect(x - 2, y + 15, 4, 1, C.g2);                                          // name plate
}
/** Card front 9x13: frame colour, art window, text box. art = [background, accent, centre]. */
function cardFront(cv, x, y, frame, frameDark, art) {
  cv.rect(x, y, 9, 13, C.ink);
  cv.rect(x + 1, y + 1, 7, 11, frame);
  cv.rect(x + 1, y + 11, 7, 1, frameDark);
  cv.rect(x + 2, y + 2, 4, 1, C.ink2);          // name
  cv.rect(x + 2, y + 3, 5, 5, frameDark);
  cv.rect(x + 3, y + 4, 3, 3, art[0]);
  cv.set(x + 3, y + 6, art[1]); cv.set(x + 5, y + 4, art[1]); cv.set(x + 4, y + 5, art[2]);
  cv.rect(x + 2, y + 9, 5, 2, C.s3);            // text box
  cv.rect(x + 2, y + 9, 3, 1, mix(C.s3, C.w1, 0.4));
}
function cardBack(cv, x, y) {
  cv.rect(x, y, 9, 13, C.ink);
  cv.rect(x + 1, y + 1, 7, 11, C.w1);
  cv.rect(x + 1, y + 1, 7, 1, C.w3);
  cv.sprite([".kkk.", "kkokk", "kokrk", "korok", "krkok", "kkokk", ".kkk."], { k: C.ink, o: C.w2, r: C.g1 }, x + 2, y + 3);
}
/** Big card front 11x15 (plaque signs): frame, name bar, art window with a small picture, text box. */
function bigCard(cv, x, y, frame, frameDark, art) {
  cv.rect(x, y, 11, 15, C.ink);
  cv.rect(x + 1, y + 1, 9, 13, frame);
  cv.rect(x + 1, y + 1, 9, 1, mix(frame, C.white, 0.35));
  cv.rect(x + 1, y + 13, 9, 1, frameDark);
  cv.rect(x + 2, y + 2, 5, 1, C.ink2);          // name
  cv.set(x + 8, y + 2, C.r2);                   // attribute
  cv.rect(x + 2, y + 3, 7, 6, frameDark);       // art window
  cv.rect(x + 3, y + 4, 5, 4, art[0]);
  cv.sprite(art[1], art[2], x + 3, y + 4);
  cv.rect(x + 2, y + 10, 7, 3, C.s3);           // text box
  cv.rect(x + 3, y + 11, 4, 1, mix(C.s3, C.w1, 0.45));
}
/** Booster pack 14x22: crimped (serrated, ridged) ends, foil, logo band, a dragon head in the art window. */
function booster(cv, x, y, body, bodyDark, bodyLight) {
  const w = 14, h = 22;
  for (let i = 0; i < w; i++) {
    if (i % 2 === 0) { cv.set(x + i, y, bodyLight); cv.set(x + i, y + h - 1, bodyDark); }
    cv.set(x + i, y + 1, i % 2 ? bodyLight : body);
    cv.set(x + i, y + 2, bodyDark);
    cv.set(x + i, y + h - 2, i % 2 ? body : bodyDark);
    cv.set(x + i, y + h - 3, bodyDark);
  }
  cv.rect(x, y + 3, w, h - 6, body);
  cv.rect(x, y + 3, 1, h - 6, bodyLight);
  cv.rect(x + w - 1, y + 3, 1, h - 6, bodyDark);
  cv.rect(x + 2, y + 4, w - 4, 3, C.g2);        // logo band
  cv.rect(x + 2, y + 6, w - 4, 1, C.g1);
  cv.rect(x + 4, y + 5, w - 8, 1, C.r2);
  cv.rect(x + 2, y + 8, w - 4, 10, C.ink);      // art window
  cv.rect(x + 3, y + 9, w - 6, 8, C.b1);
  cv.rect(x + 3, y + 9, w - 6, 2, C.ink2);
  cv.sprite(DRAGON, { k: C.ink, w: C.white, l: C.sky, h: C.sky, r: C.r2 }, x + 3, y + 9);
  cv.set(x + 1, y + 4, C.white); cv.set(x + 1, y + 5, C.white);   // shine
}
const DRAGON = [
  "......h.",
  ".....hh.",
  "...wwww.",
  ".wwwwrwl",
  "wwwwwwwl",
  "kkkk.wwl",
  ".wwwwwwl",
  "....wwwl",
];
/** Small booster pack 12x17 with an outline (plaque signs): crimped top, logo band, a star in the window. */
function smallPack(cv, x, y, body, bodyDark, bodyLight) {
  const w = 12, h = 17;
  cv.rect(x, y + 1, w, h - 2, C.ink);
  for (let i = 0; i < w; i += 2) { cv.set(x + i, y, C.ink); cv.set(x + i, y + h - 1, C.ink); }
  cv.rect(x + 1, y + 1, w - 2, h - 2, body);
  for (let i = 1; i < w - 1; i++) { cv.set(x + i, y + 1, i % 2 ? bodyLight : body); cv.set(x + i, y + h - 2, i % 2 ? body : bodyDark); }
  cv.rect(x + 1, y + 2, w - 2, 1, bodyDark);
  cv.rect(x + 1, y + h - 3, w - 2, 1, bodyDark);
  cv.rect(x + 1, y + 3, 1, h - 6, bodyLight);
  cv.rect(x + 2, y + 4, w - 4, 2, C.g2);        // logo band
  cv.rect(x + 3, y + 5, w - 6, 1, C.r2);
  cv.rect(x + 2, y + 7, w - 4, 6, C.ink);       // window
  cv.rect(x + 3, y + 8, w - 6, 4, C.b3);
  cv.sprite(["..#..", ".###.", "#####", ".#.#."], { "#": C.g3 }, x + 4, y + 8);
  cv.set(x + 6, y + 9, C.g4);
}
/** Red die in 3/4 view, 11x11: lit top, front and side with pips. */
function die(cv, x, y) {
  cv.sprite([
    "..kkkkkkk..",
    ".kTTTTTTTk.",
    "kTTTwTTTTTk",
    "kTTTTTTTwTk",
    "kFFFFFFkRRk",
    "kFwFFwFkRRk",
    "kFFFFFFkRwk",
    "kFFwFFFkRRk",
    "kFFFFFFkwRk",
    "kFwFFwFkRRk",
    ".kkkkkkkkk.",
  ], { k: C.ink, T: C.r3, F: C.r2, R: C.r1, w: C.white }, x, y);
}
/** Inverted golden pyramid with an eye, hanging on a cord. 21x17. */
function puzzle(cv, x, y) {
  const w = 21, h = 17, mid = (w - 1) / 2;
  const tri = maskOf((i, j) => Math.abs(i - x - mid) <= mid * (1 - (j - y) / h) + 0.5, x, y, x + w - 1, y + h - 1);
  cv.shape(tri, (i, j) => (j === y ? C.g4 : i - x < mid ? C.g3 : C.g2), C.w0);
  for (const [i, j] of [[-1, -1], [1, -1], [-1, -2], [1, -2], [0, -3]]) cv.set(x + mid + i, y + j, C.w0);
  cv.sprite([
    "..#######..",
    "...........",
    "...#####...",
    "..#wwppw#..",
    ".#wwwppww##",
    "..#######..",
    "...........",
    "....#..#...",
    "....#...#..",
    "...##..#...",
  ], { "#": C.w0, w: C.off, p: C.ink }, x + mid - 5, y + 2);
}
function pyramid(cv, x, base, half, lit, shade) {
  for (let j = 0; j <= half; j++) for (let i = j - half; i <= half - j; i++) cv.set(x + i, base - j, i < 0 || j === half ? lit : shade);
}
/** A duelist's head and shoulders, 9x9: spiky hair, blond fringe, blue jacket. */
function duelist(cv, x, y) {
  cv.sprite([
    "h.hh.hh.h",
    "hhhhhhhhh",
    "hhbbbbbhh",
    "hbsbssbsh",
    ".seesees.",
    ".sssssss.",
    "..sSSSs..",
    ".jjwjwjj.",
    "jjjjwjjjj",
  ], { h: C.p2, b: C.g3, s: C.skin, S: C.skin2, e: C.ink, j: C.b1, w: C.white }, x, y);
}

// ---------- billboards: designs on the blank billboard's face (70x32 art pixels) ----------
const FACE = { x: 5, w: 70, h: 32 };
const BILLBOARDS = {
  tournament() {
    const cv = new Canvas(FACE.w, FACE.h, C.p1);
    bands(cv, [C.p0, C.p1, C.p2, C.p3]);
    beam(cv, 24, 33, -Math.PI / 2 + 0.55, 0.12, 0.18);
    beam(cv, 68, 33, -Math.PI / 2 - 0.55, 0.12, 0.18);
    for (const [x, y, big] of [[3, 3, 1], [20, 2, 0], [27, 6, 0], [66, 4, 1], [57, 2, 0], [14, 1, 0], [68, 14, 0]]) sparkle(cv, x, y, C.off, big);
    trophy(cv, 11, 7);
    text(cv, "ISLAND", 45, 2, C.g3);
    text(cv, "DUEL", 45, 9, (x, y) => (y < 12 ? C.white : y < 14 ? C.off : C.sky), { font: "big", outline: C.ink, shadow: C.r1 });
    text(cv, "TOURNAMENT", 45, 19, C.g3, { outline: C.p0 });
    ribbon(cv, 29, 24, 33, 7, C.r2, C.r1, C.r0);
    text(cv, "SUNDAY", 45, 25, C.white);
    corners(cv, C.ink);
    return cv;
  },

  cardShop() {
    const cv = new Canvas(FACE.w, FACE.h, C.r2);
    rays(cv, 13, 17, 18, C.r2, C.r1);
    cv.each((x, y) => { if ((x - 13) ** 2 + (y - 17) ** 2 < 60) cv.set(x, y, mix(cv.get(x, y), C.r3, 0.5)); });
    cardBack(cv, 2, 11);
    cardFront(cv, 8, 6, C.t2, C.t1, [C.b4, C.sky, C.g3]);          // spell
    cardFront(cv, 15, 10, C.o2, C.g1, [C.b3, C.white, C.r2]);      // monster
    cv.set(17, 4, C.white); sparkle(cv, 22, 5, C.g4, true); sparkle(cv, 5, 7, C.g4, true);
    const gold = (x, y) => (y < 5 || (y >= 12 && y < 15) ? C.g4 : C.g3);
    text(cv, "DUEL", 47, 2, gold, { font: "big", outline: C.ink, shadow: C.r0 });
    text(cv, "DEPOT", 47, 12, gold, { font: "big", outline: C.ink, shadow: C.r0 });
    cv.rect(26, 23, 43, 7, C.ink);
    text(cv, "BOOSTERS!", 47, 24, C.white);
    corners(cv, C.r0);
    return cv;
  },

  museum() {
    const cv = new Canvas(FACE.w, FACE.h, C.ink2);
    bands(cv, [C.ink2, C.navy, C.m1, C.r3, C.dune, C.g2], 0, 23);  // dusk sky
    bands(cv, [C.s2, C.s1], 24, 31);                                // sand
    for (let x = 0; x < cv.w; x++) if ((x * 7) % 11 < 3) cv.set(x, 27 + ((x >> 2) % 2), C.s3);
    cv.each((x, y) => { if (y <= 23 && (x - 52) ** 2 + (y - 23) ** 2 < 30) cv.set(x, y, C.g3); });
    pyramid(cv, 42, 23, 8, C.s2, C.s0);
    pyramid(cv, 58, 23, 11, C.s3, C.s1);
    pyramid(cv, 67, 23, 5, C.s2, C.s0);
    for (const [x, y, big] of [[22, 2, 0], [26, 7, 0], [67, 2, 1], [5, 3, 0], [17, 5, 0]]) sparkle(cv, x, y, C.off, big);
    cv.each((x, y) => { const d = (x - 11) ** 2 + (y - 13) ** 2; if (d < 110) cv.set(x, y, mix(cv.get(x, y), C.g3, d < 55 ? 0.3 : 0.15)); });
    puzzle(cv, 1, 6);
    text(cv, "MUSEUM", 46, 2, C.white, { font: "big", outline: C.ink, shadow: C.ink2 });
    text(cv, "MILLENNIUM", 46, 11, C.g3, { outline: C.ink });
    text(cv, "EXHIBIT", 22, 26, C.w0);
    corners(cv, C.ink);
    return cv;
  },

  booster() {
    const cv = new Canvas(FACE.w, FACE.h, C.b1);
    cv.each((x, y) => cv.set(x, y, ((x + y) >> 2) % 2 ? C.b1 : C.b2));   // diagonal stripes, as on the SALE sign
    cv.each((x, y) => { const d = (x - 14) ** 2 + (y - 16) ** 2; if (d < 160) cv.set(x, y, d < 70 ? C.b4 : C.b3); });
    booster(cv, 11, 6, C.p3, C.p2, C.p4);
    booster(cv, 4, 4, C.r2, C.r1, C.r3);
    for (const [x, y] of [[25, 3], [2, 27], [27, 22]]) sparkle(cv, x, y, C.white, true);
    text(cv, "NEW", 48, 2, (x, y) => (y < 5 ? C.g4 : C.g3), { font: "big", outline: C.ink, shadow: C.ink2 });
    text(cv, "PACKS", 48, 11, C.white, { font: "big", outline: C.ink, shadow: C.ink2 });
    ribbon(cv, 33, 22, 30, 7, C.r2, C.r1, C.r0);
    text(cv, "OUT NOW!", 48, 23, C.white);
    corners(cv, C.navy);
    return cv;
  },
};
const billboard = (name) => ({
  name, w: 10, h: 4,
  base: () => region(SHEET, 0, 4, 10, 4),                       // the blank billboard, read before the sheet is rewritten
  draw: (cv) => cv.paste(BILLBOARDS[name](), FACE.x, 0),
});

// ---------- plaque signs: the pack's plain bakery sign (8x5 tiles), bread and word cleared, in a 10x5 cell ----------
// Plaque (cell art pixels): x 12..67, rows 11..34; top border rows 11-16, word area x 16..63 rows 17..30.
const PLAQUE_X = ART;
async function plainPlaque() {
  const sign = await region(path.join(THEMES, "5_Floor_Modular_Buildings_32x32.png"), 11, 143, 8, 5);
  const at = (x, y) => sign.get(x, y);
  // top border rows: the colour each row has left of the bread, across the middle; the inside: plain brown
  const border = [11, 12, 13, 14, 15, 16].map((y) => [y, at(10, y)]);
  for (let y = 0; y <= 10; y++) for (let x = 0; x < sign.w; x++) sign.clear(x, y);
  for (const [y, c] of border) for (let x = 12; x <= 51; x++) sign.set(x, y, c);
  const inside = at(8, 17);
  for (let y = 17; y <= 30; y++) for (let x = 8; x <= 55; x++) sign.set(x, y, inside);
  const cell = new Canvas(10 * ART, 5 * ART);
  cell.paste(sign, PLAQUE_X, 0);
  return cell;
}
/** A plaque word in the bold script, on a dark inset strip like the pack's "Bakery". */
function plaqueWord(cv, word) {
  const center = PLAQUE_X + 31.5, top = 19;
  const mask = textMask(word, center, top, "script");
  const pts = [...mask].map((k) => k.split(",").map(Number));
  const xs = pts.map(([x]) => x);
  const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1;
  for (let y = top + 3; y <= top + 9; y++) for (let x = x0; x <= x1; x++) cv.set(x, y, (x * 7 + y * 3) % 5 ? C.w0 : C.r0);
  for (const [x, y] of pts) for (const [dx, dy] of [[1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]])
    if (!mask.has(`${x + dx},${y + dy}`) && (y + dy < top + 3 || y + dy > top + 9)) cv.set(x + dx, y + dy, C.r0);
  for (const [x, y] of pts) cv.set(x, y, mask.has(`${x},${y + 1}`) ? [208, 190, 156] : [185, 158, 134]);
}
const PLAQUES = {
  cards(cv) {
    const x = PLAQUE_X + 31 - 13;
    const monster = [["....", ".ww.", "wwww", ".w.w"], { w: C.white }];
    bigCard(cv, x, 4, C.t2, C.t1, [C.b4, ["..g..", ".ggg.", "ggggg", "..g.."], { g: C.g3 }]);           // spell
    bigCard(cv, x + 16, 4, C.m1, mix(C.m1, C.ink, 0.35), [C.p3, ["g...g", ".g.g.", "..g..", ".g.g."], { g: C.r3 }]); // trap
    bigCard(cv, x + 8, 1, C.o2, C.g1, [C.b3, ...monster]);                                                  // monster
    for (const [sx, sy] of [[x - 3, 3], [x + 30, 1], [x + 29, 8]]) sparkle(cv, sx, sy, C.g4, true);
    plaqueWord(cv, "Cards");
  },
  packs(cv) {
    smallPack(cv, PLAQUE_X + 30, 0, C.p3, C.p2, C.p4);
    smallPack(cv, PLAQUE_X + 19, 2, C.r2, C.r1, C.r3);
    die(cv, PLAQUE_X + 51, 11);
    sparkle(cv, PLAQUE_X + 16, 3, C.g4, true); sparkle(cv, PLAQUE_X + 45, 2, C.g4, true);
    plaqueWord(cv, "Packs");
  },
};
const plaque = (name) => ({ name, w: 10, h: 5, base: plainPlaque, draw: PLAQUES[name] });

// ---------- shop signs: the pack's empty sign frame (10x5 tiles), a panel inside (60x24 art pixels at 10,7) ----------
const PANEL = { x: 10, y: 7, w: 60, h: 24 };
const PANELS = {
  cardShopFrame() {
    const cv = new Canvas(PANEL.w, PANEL.h, C.off);
    cv.rect(0, PANEL.h - 2, PANEL.w, 2, C.lav2);
    cv.rect(0, 0, PANEL.w, 1, C.white);
    cardBack(cv, 3, 8);
    cardFront(cv, 8, 6, C.t2, C.t1, [C.b4, C.sky, C.g3]);
    cardFront(cv, 13, 4, C.o2, C.g1, [C.b3, C.white, C.r2]);
    sparkle(cv, 24, 4, C.g2, true);
    text(cv, "CARD", 42, 3, C.r2, { font: "big", shadow: C.lav });
    text(cv, "SHOP", 42, 13, C.ink2, { font: "big", shadow: C.lav });
    return cv;
  },
  duelArena() {
    const cv = new Canvas(PANEL.w, PANEL.h, C.ink2);
    bands(cv, [C.p1, C.ink2, C.navy]);
    for (const [x, y] of [[13, 2], [47, 21], [8, 20], [53, 3]]) sparkle(cv, x, y, C.off);
    bolt(cv, 2, 8, C.g3, C.g1);
    bolt(cv, 54, 8, C.g3, C.g1);
    text(cv, "DUEL", 30, 2, (x, y) => (y < 5 ? C.g4 : C.g3), { font: "big", outline: C.ink, shadow: C.r1 });
    text(cv, "ARENA", 30, 13, C.white, { font: "big", outline: C.ink, shadow: C.r1 });
    return cv;
  },
};
const frame = (name) => ({
  name, w: 10, h: 5,
  base: () => region(path.join(THEMES, "5_Floor_Modular_Buildings_32x32.png"), 10, 487, 10, 5),
  draw: (cv) => cv.paste(PANELS[name](), PANEL.x, PANEL.y),
});

// ---------- mall wall ads: the pack's small ad on the mall wall (5x2 tiles), picture 31x9 art pixels at 7,1 ----------
const AD = { x: 7, y: 1, w: 31, h: 9 };
const ADS = {
  duelistAd() {
    const cv = new Canvas(AD.w, AD.h, C.b4);
    cv.each((x, y) => { if (x * 2 + y > 30) cv.set(x, y, C.r2); });       // blue | red, a slanted split
    cv.each((x, y) => { if (x * 2 + y === 30 || x * 2 + y === 31) cv.set(x, y, C.g3); });
    duelist(cv, 1, 0);
    text(cv, "VS", 15, 2, C.g3, { outline: C.ink });
    cv.sprite(DRAGON, { k: C.ink, w: C.white, l: C.sky, h: C.sky, r: C.ink2 }, 22, 1);
    return cv;
  },
  duelAd() {
    const cv = new Canvas(AD.w, AD.h, C.off);
    text(cv, "DUEL!", 10, 2, C.r2, { shadow: C.lav });
    cv.rect(20, 1, 1, 7, C.lav);
    const card = { k: C.ink, b: C.w1, o: C.w0, y: C.o2, a: C.b3, t: C.s3 };
    cv.sprite(["kkkkk", "kbbbk", "kbobk", "kbobk", "kbobk", "kbbbk", "kkkkk"], card, 22, 1);
    cv.sprite(["kkkkk", "kyyyk", "kaaak", "kaaak", "kyyyk", "ktttk", "kkkkk"], card, 25, 0);
    return cv;
  },
};
const ad = (name) => ({
  name, w: 5, h: 2,
  base: () => region(path.join(THEMES, "9_Shopping_Center_and_Markets_32x32.png"), 2, 22, 5, 2),
  draw: (cv) => cv.paste(ADS[name](), AD.x, AD.y),
});

const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
/** The most frequent colour of row y between x0 and x1, leaving out the colours in `skip` ("r,g,b"). */
function commonColour(cv, y, x0, x1, skip = []) {
  const n = new Map();
  for (let x = x0; x <= x1; x++) {
    const c = cv.get(x, y);
    if (c && !skip.includes(c.slice(0, 3).join())) { const k = c.join(); n.set(k, [c, (n.get(k)?.[1] ?? 0) + 1]); }
  }
  return [...n.values()].sort((a, b) => b[1] - a[1])[0][0];
}
const hash = (x, y) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

// ---------- game store: the pack's gun store sign (10x4 tiles, on its shop's facade), gun and words cleared ----------
// Plaque (art pixels): x 4..75, rows 2..29; left border x 4..6 (mirrored on the right), inside x 7..72.
const SIGN_FONT = {
  A: [".##.", "#..#", "####", "#..#", "#..#"],
  E: ["####", "#...", "###.", "#...", "####"],
  G: [".###", "#...", "#.##", "#..#", ".###"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  O: [".##.", "#..#", "#..#", "#..#", ".##."],
  R: ["###.", "#..#", "###.", "#.#.", "#..#"],
  S: [".###", "#...", ".##.", "...#", "###."],
  T: ["#####", "..#..", "..#..", "..#..", "..#.."],
};
/** Worn dark lettering like the pack's "GUN STORE" (4x5 capitals), left edge at x. */
function signWord(cv, word, x, y) {
  for (const ch of word) {
    const rows = SIGN_FONT[ch];
    rows.forEach((r, j) => [...r].forEach((p, i) => {
      if (p !== "#") return;
      const h = hash(x + i, y + j);
      cv.set(x + i, y + j, h % 9 === 0 ? C.ink : h % 4 === 0 ? [126, 97, 81] : [94, 80, 81]);
    }));
    x += rows[0].length + 1;
  }
}
async function gunStoreSign() {
  const cv = await region(path.join(THEMES, "5_Floor_Modular_Buildings_32x32.png"), 4, 494, 10, 4);
  for (let y = 0; y < 2; y++) for (let x = 0; x < cv.w; x++) cv.clear(x, y);
  for (let y = 2; y <= 29; y++) {
    const fill = commonColour(cv, y, 56, 72);
    for (let x = 7; x <= 72; x++) cv.set(x, y, fill);
    for (let x = 4; x <= 6; x++) cv.set(79 - x, y, cv.get(x, y));
  }
  for (let y = 12; y <= 26; y++) for (let x = 7; x <= 72; x++) if (hash(x, y) % 23 === 0) cv.set(x, y, [171, 154, 143]);   // wear
  return cv;
}
/** A game pad 31x15 (left edge x, top y): grey body, d-pad, four coloured buttons, start/select. */
function gamepad(cv, x, y) {
  const pad = maskOf((i, j) => {
    const lx = i - x, ly = j - y;
    return (lx >= 7 && lx <= 23 && ly >= 0 && ly <= 11) || (lx - 7) ** 2 + (ly - 7) ** 2 <= 56 || (lx - 23) ** 2 + (ly - 7) ** 2 <= 56;
  }, x, y, x + 30, y + 14);
  const shade = new Set();
  for (const k of pad) { const [i, j] = k.split(",").map(Number); for (const [dx, dy] of [[1, 2], [2, 2], [1, 3]]) if (!pad.has(`${i + dx},${j + dy}`)) shade.add(`${i + dx},${j + dy}`); }
  for (const k of shade) { const [i, j] = k.split(",").map(Number); const c = cv.get(i, j); if (c) cv.set(i, j, mix(c, C.ink, 0.35)); }
  const grey = [[177, 186, 200], [157, 163, 183], [139, 139, 171], [125, 127, 153]];
  cv.shape(pad, (i, j) => { const ly = j - y; return grey[ly <= 1 ? 0 : ly <= 6 ? 1 : ly <= 10 ? 2 : 3]; }, C.ink);
  cv.sprite(["..k..", "..k..", "kkakk", "..k..", "..k.."], { k: [70, 70, 94], a: [86, 89, 114] }, x + 5, y + 5);   // d-pad
  cv.rect(x + 22, y + 4, 2, 2, C.g3); cv.rect(x + 19, y + 7, 2, 2, C.b3);                                   // buttons
  cv.rect(x + 25, y + 7, 2, 2, C.r2); cv.rect(x + 22, y + 10, 2, 2, C.t2);
  cv.rect(x + 12, y + 9, 2, 1, [86, 89, 114]); cv.rect(x + 16, y + 9, 2, 1, [86, 89, 114]);                 // select, start
  cv.rect(x + 13, y + 3, 4, 1, C.r2);                                                                         // logo
}
/** A level star (Yu-Gi-Oh's red disc with a yellow star), 7x7. */
function levelStar(cv, x, y) {
  cv.sprite([
    ".rrrrr.",
    "rrryrrr",
    "rryyyrr",
    "ryyyyyR",
    "rryRyRR",
    "rrRRRRR",
    ".RRRRR.",
  ], { r: C.r2, R: C.r1, y: C.g3 }, x, y);
}

// ---------- gadget hardware: the pack's hardware sign (16x8 tiles), hammer cleared, a Duel Disk instead ----------
// Plaque (art pixels): x 5..122, rows 28..63, symmetric about x 63.5; red panel rows 37..56, x 11..116, its word
// "HARDWARE" kept. Above row 28 there is only the hammer.
const PANEL_ROWS = [37, 56], PANEL_X = [11, 116];
async function hardwareSign() {
  const cv = await region(path.join(THEMES, "4_Generic_Buildings_32x32.png"), 18, 325, 16, 8);
  const orig = new Canvas(cv.w, cv.h);
  orig.paste(cv, 0, 0);
  const inPanel = (x, y) => y >= PANEL_ROWS[0] && y <= PANEL_ROWS[1] && x >= PANEL_X[0] && x <= PANEL_X[1];
  // the hammer on the panel: its grey head and wooden/blue handle colours, plus their dark outline
  const hammerColours = ["108,110,133", "139,139,171", "125,127,153", "157,163,183", "177,186,200", "86,89,114", "70,70,94",
    "168,95,70", "213,147,94", "218,164,99", "181,117,77", "202,136,84", "126,97,81", "113,100,103", "92,74,68",
    "140,140,141", "80,133,180", "45,66,117", "65,96,149", "100,153,186", "116,170,191"];
  const hammer = new Set();
  orig.each((x, y) => { const c = orig.get(x, y); if (c && inPanel(x, y) && x >= 50 && hammerColours.includes(c.slice(0, 3).join())) hammer.add(`${x},${y}`); });
  for (const k of [...hammer]) {
    const [x, y] = k.split(",").map(Number);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const c = orig.get(x + dx, y + dy);
      if (c && inPanel(x + dx, y + dy) && ["58,58,80", "107,80,82", "145,102,98"].includes(c.slice(0, 3).join())) hammer.add(`${x + dx},${y + dy}`);
    }
  }
  // above the plaque: only the hammer; the top frame (rows 28-36, where the head lies across the middle): each row's
  // own colour, its ends mirrored; the rest of the frame: mirrored from the clean left half; the panel: its row colour
  // right of the word the panel is plain (the handle's outline and shadow there use the panel's own dark reds)
  const cream = ["224,208,178", "238,225,183", "208,190,156"];
  let wordEnd = 0;
  orig.each((x, y) => { const c = orig.get(x, y); if (c && inPanel(x, y) && x < 100 && cream.includes(c.slice(0, 3).join())) wordEnd = Math.max(wordEnd, x); });
  for (let y = 0; y < 28; y++) for (let x = 0; x < cv.w; x++) cv.clear(x, y);
  const mirror = (x, y) => { const m = orig.get(127 - x, y); m ? cv.set(x, y, m) : cv.clear(x, y); };
  const lettering = [...cream, "58,58,80", "107,80,82", "145,102,98", "195,172,144", "185,158,134"];
  for (let y = 28; y < cv.h; y++) {
    const fill = commonColour(orig, y, 12, 48, inPanel(20, y) ? lettering : []);
    for (let x = 50; x < cv.w; x++) {
      if (y < PANEL_ROWS[0]) x <= 110 ? cv.set(x, y, fill) : mirror(x, y);
      else if (!inPanel(x, y)) { if (x >= 64) mirror(x, y); }
      else if (x === PANEL_X[1]) mirror(x, y);
      else if (hammer.has(`${x},${y}`) || x > wordEnd + 1) cv.set(x, y, fill);
    }
  }
  // the head's shadow on the word: back to the letters' cream
  cv.each((x, y) => {
    if (!inPanel(x, y) || x < 55 || x > 80) return;
    const k = cv.get(x, y)?.slice(0, 3).join();
    if (k === "195,172,144") cv.set(x, y, [224, 208, 178]);
    if (k === "185,158,134") cv.set(x, y, [208, 190, 156]);
  });
  return cv;
}
/** A Duel Disk: a purple hub with a life point display, its blade running down-right at 45° with two rows of five
 *  card zones (monsters above, spells/traps below), a few cards on them. */
function duelDisk(cv, hx, hy) {
  const u = [Math.SQRT1_2, Math.SQRT1_2], n = [Math.SQRT1_2, -Math.SQRT1_2];
  const c0 = [hx + 4, hy + 4], len = 46, half0 = 10, half1 = 8;
  const along = (x, y) => (x - c0[0]) * u[0] + (y - c0[1]) * u[1];
  const across = (x, y) => (x - c0[0]) * n[0] + (y - c0[1]) * n[1];
  const halfAt = (t) => half0 + (half1 - half0) * (t / len);
  const blade = maskOf((x, y) => { const t = along(x, y); return t >= 0 && t <= len && Math.abs(across(x, y)) <= halfAt(t); }, 0, 0, cv.w - 1, cv.h - 1);
  const silver = [[216, 208, 224], [177, 186, 200], [157, 163, 183], [139, 139, 171], [108, 110, 133]];
  cv.shape(blade, (x, y) => {
    const t = along(x, y), s = across(x, y), half = halfAt(t);
    if (s > half - 1.5) return C.g2;                                               // gold trim on the upper edge
    const zone = Math.floor((t - 9) / 7.5);
    const inZone = t >= 9 && zone < 5 && (t - 9) % 7.5 < 5 && Math.abs(s) > 1 && Math.abs(s) < half - 2;
    if (inZone) {
      const edge = (t - 9) % 7.5 < 1;                                              // the lit edge of each zone
      if (s > 0 && (zone === 1 || zone === 3)) return edge ? C.g3 : C.o2;          // monsters
      if (s < 0 && zone === 2) return edge ? C.t2 : C.t1;                          // a spell
      if (s < 0 && zone === 4) return edge ? C.w3 : C.w1;                          // a face-down card
      return edge ? silver[2] : silver[4];
    }
    return silver[s > half - 3 ? 0 : s > 0 ? 1 : s > -half + 2.5 ? 2 : 3];
  }, C.ink);
  // hub
  const hub = maskOf((x, y) => (x - hx) ** 2 + (y - hy) ** 2 <= 110, hx - 11, hy - 11, hx + 11, hy + 11);
  cv.shape(hub, (x, y) => {
    const d = (x - hx) ** 2 + (y - hy) ** 2;
    if (d > 80) return x + y < hx + hy ? C.p4 : C.p2;                              // rim, lit top-left
    return d > 64 ? C.g2 : C.p3;                                                   // gold ring, purple face
  }, C.ink);
  cv.rect(hx - 5, hy - 2, 10, 5, C.ink);                                           // life point display
  cv.rect(hx - 4, hy - 1, 8, 3, [33, 152, 61]);
  cv.sprite(["#.##.##.", "..#..#.#", "#.##.##."], { "#": [111, 187, 73] }, hx - 4, hy - 1);
  cv.rect(hx - 1, hy - 7, 3, 3, C.r2); cv.set(hx - 1, hy - 7, C.r3);              // jewel
  cv.rect(hx - 6, hy + 5, 4, 3, C.w1); cv.rect(hx - 6, hy + 5, 4, 1, C.w3);        // the deck in its slot
}

// Every piece and its top-left tile in the sheet. Rows 0-14 are the hand-made tiles; keep each piece where it is
// (placed tiles keep their ids), put new ones in free space.
const PIECES = [
  [billboard("tournament"), 0, 15], [billboard("cardShop"), 0, 19], [billboard("museum"), 0, 23], [billboard("booster"), 0, 27],
  [plaque("cards"), 0, 31], [plaque("packs"), 0, 36],
  [frame("cardShopFrame"), 0, 41], [frame("duelArena"), 0, 46],
  [ad("duelistAd"), 0, 51], [ad("duelAd"), 5, 51],
  [{ name: "gameStore", w: 10, h: 4, base: gunStoreSign, draw: (cv) => {
    gamepad(cv, 8, 3);
    signWord(cv, "GAME", 42, 14); levelStar(cv, 64, 13);
    signWord(cv, "STORE", 44, 21);
  } }, 10, 15],
  [{ name: "gadgets", w: 16, h: 8, base: hardwareSign, draw: (cv) => duelDisk(cv, 78, 16) }, 0, 53],
];

// ---------- sheet ----------
const sheet = await sharp(SHEET).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = COLS * TILE, rows = Math.max(...PIECES.map(([p, , row]) => row + p.h));
const used = new Set();
for (const [piece, col, row] of PIECES) {
  if (row < KEEP_ROWS || col + piece.w > COLS) throw new Error(`${piece.name}: outside the generated area`);
  for (let j = row; j < row + piece.h; j++) for (let i = col; i < col + piece.w; i++) {
    if (used.has(`${i},${j}`)) throw new Error(`${piece.name}: overlaps another piece at tile ${i},${j}`);
    used.add(`${i},${j}`);
  }
}
const height = rows * TILE;
const out = Buffer.alloc(W * height * 4);
const keepW = Math.min(W, sheet.info.width) * 4;                 // the hand-made rows, also from a narrower sheet
for (let y = 0; y < KEEP_ROWS * TILE; y++) sheet.data.copy(out, y * W * 4, y * sheet.info.width * 4, y * sheet.info.width * 4 + keepW);
for (const [piece, col, row] of PIECES) {
  const cv = await piece.base();
  if (cv.w !== piece.w * ART || cv.h !== piece.h * ART) throw new Error(`${piece.name}: base is ${cv.w}x${cv.h} art pixels`);
  piece.draw(cv);
  cv.each((x, y) => {
    const c = cv.get(x, y);
    if (!c) return;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++)
      out.set([c[0], c[1], c[2], c[3] ?? 255], (((row * TILE + y * 2 + dy) * W) + col * TILE + x * 2 + dx) * 4);
  });
  console.log(`${piece.name}: tiles ${col}-${col + piece.w - 1} x ${row}-${row + piece.h - 1}`);
}
await sharp(out, { raw: { width: W, height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(SHEET);
const tsj = JSON.parse(readFileSync(TSJ, "utf-8"));
Object.assign(tsj, { columns: COLS, imagewidth: W, imageheight: height, tilecount: COLS * rows });
writeFileSync(TSJ, JSON.stringify(tsj, null, 1) + "\n");
console.log(`→ ${path.relative(ROOT, SHEET)} (${W}x${height}), ${path.relative(ROOT, TSJ)}`);
