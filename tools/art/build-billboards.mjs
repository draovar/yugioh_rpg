// Billboards for the custom Yu-Gi-Oh tileset (vendor/paid/custom/yugioh_tileset.png, data/maps/tilesets/yugioh.tsj).
// The sheet's blank billboard (160x64, tile rows 4-7: two posts, a white face) gets one design per entry of DESIGNS,
// written below the hand-made tiles from tile row 15 on, four tile rows each, in DESIGNS order:
//   tournament (rows 15-18), cardShop (19-22), museum (23-26), booster (27-30)
// Rows 0-14 are copied byte for byte; the .tsj's imageheight/tilecount follow the new size. Append new designs at the
// end of DESIGNS, so placed billboards keep their tile ids.
// Like the pack's 32x32 art (16x16 art doubled), designs are drawn in 2x2 "art pixels": the face is 70x32 of them
// (sheet x 10..149). Small text is tiny5 (the game's 3x5 font), headlines a 5x7 font below; colours mostly the pack's.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SHEET = path.join(ROOT, "vendor/paid/custom/yugioh_tileset.png");
const TSJ = path.join(ROOT, "data/maps/tilesets/yugioh.tsj");
const FONTS = path.join(ROOT, "public/assets/fonts");
const KEEP_ROWS = 15, BLANK_ROW = 4, BOARD_ROWS = 4, TILE = 16;
const FACE = { x: 5, w: 70, h: 32 };

const C = {
  ink: [58, 58, 80], ink2: [45, 66, 117], navy: [60, 81, 127],
  b1: [61, 86, 210], b2: [62, 100, 213], b3: [66, 128, 221], b4: [73, 149, 227], sky: [186, 210, 224],
  white: [248, 248, 248], off: [235, 228, 242],
  g1: [230, 140, 22], g2: [242, 178, 43], g3: [248, 210, 57], g4: [255, 241, 168],
  r0: [107, 56, 59], r1: [158, 43, 45], r2: [217, 50, 50], r3: [252, 92, 70],
  w0: [92, 74, 68], w1: [126, 97, 81], w2: [168, 95, 70], w3: [181, 117, 77],
  s0: [157, 124, 91], s1: [199, 140, 89], s2: [218, 164, 99], s3: [237, 196, 130],
  p0: [30, 26, 54], p1: [44, 38, 78], p2: [62, 52, 104], p3: [86, 72, 136], p4: [124, 104, 176],
  t1: [28, 125, 77], t2: [33, 152, 61], m1: [165, 72, 115], o2: [233, 157, 29], dune: [237, 147, 30],
};
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

class Canvas {
  constructor(w, h, fill) { this.w = w; this.h = h; this.px = Array.from({ length: w * h }, () => fill); }
  get(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y * this.w + x] : null; }
  set(x, y, c) { if (c && x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c; }
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
const glyph = (font, ch) => {
  const g = font === "big" ? BIG[ch] && { rows: BIG[ch], xo: 0, yo: 0, adv: BIG[ch][0].length + 1 } : SMALL[ch];
  if (!g) throw new Error(`no "${ch}" in the ${font} font`);
  return g;
};
const textWidth = (str, font) => [...str].reduce((w, ch) => w + glyph(font, ch).adv, 0) - 1;
/** Text centred on x = `center`, with an optional outline (8 neighbours) and drop shadow; colour may be fn(x, y). */
function text(cv, str, center, y, colour, { font = "small", outline, shadow } = {}) {
  const mask = new Set();
  let x = Math.round(center - textWidth(str, font) / 2);
  for (const ch of str) {
    const g = glyph(font, ch);
    g.rows.forEach((r, j) => [...r].forEach((p, i) => { if (p === "#") mask.add(`${x + g.xo + i},${y + g.yo + j}`); }));
    x += g.adv;
  }
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
  cv.sprite([
    "......h.",
    ".....hh.",
    "...wwww.",
    ".wwwwrwl",
    "wwwwwwwl",
    "kkkk.wwl",
    ".wwwwwwl",
    "....wwwl",
  ], { k: C.ink, w: C.white, l: C.sky, h: C.sky, r: C.r2 }, x + 3, y + 9);
  cv.set(x + 1, y + 4, C.white); cv.set(x + 1, y + 5, C.white);   // shine
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

// ---------- designs (face coordinates: 70x32 art pixels) ----------
const DESIGNS = {
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

// ---------- sheet ----------
const sheet = await sharp(SHEET).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = sheet.info.width, rowBytes = W * 4 * TILE;
if (W !== 160) throw new Error(`${SHEET}: expected 160 px wide, got ${W}`);
const kept = sheet.data.subarray(0, KEEP_ROWS * rowBytes);
const blank = sheet.data.subarray(BLANK_ROW * rowBytes, (BLANK_ROW + BOARD_ROWS) * rowBytes);
const boards = Object.entries(DESIGNS).map(([name, draw], k) => {
  const cv = draw(), buf = Buffer.from(blank);
  cv.each((x, y) => {
    const c = cv.get(x, y);
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const i = ((y * 2 + dy) * W + (FACE.x + x) * 2 + dx) * 4;
      buf.set([...c, 255], i);
    }
  });
  console.log(`${name}: tile rows ${KEEP_ROWS + k * BOARD_ROWS}-${KEEP_ROWS + (k + 1) * BOARD_ROWS - 1}`);
  return buf;
});
const height = (KEEP_ROWS + boards.length * BOARD_ROWS) * TILE;
await sharp(Buffer.concat([kept, ...boards]), { raw: { width: W, height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(SHEET);
const tsj = JSON.parse(readFileSync(TSJ, "utf-8"));
Object.assign(tsj, { imageheight: height, tilecount: (W / TILE) * (height / TILE) });
writeFileSync(TSJ, JSON.stringify(tsj, null, 1) + "\n");
console.log(`→ ${path.relative(ROOT, SHEET)} (${W}x${height}), ${path.relative(ROOT, TSJ)}`);
