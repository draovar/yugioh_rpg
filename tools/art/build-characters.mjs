// Slices the overworld character sheet (data/characters/reshef-sheet.png: every character of Yu-Gi-Oh! Reshef of
// Destruction, ripped by Darkbolt99, green cell backgrounds on a purple grid) into clean transparent sprites, laid out
// by data/characters/characters.json:
//   public/assets/overworld/characters.png + .json – one row per character, 9 frames of 32x32:
//                                                    down, side (facing right), up × stand, step, step
//   public/assets/overworld/props.png + .json      – single 32x32 frames (poses, objects)
//   public/assets/overworld/balloons.png + .json   – reaction balloons, one row per balloon, 16x16 frames
//   docs/characters.png                            – contact sheet with every name, for picking sprites
// Characters drawn for this game come as ready-made 96x96 sheets in data/characters/ (same 3x3 layout), named by
// { "sheet": "file.png" } in the manifest.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SRC = path.join(ROOT, "data/characters");
const OUT = path.join(ROOT, "public/assets/overworld");
const spec = JSON.parse(readFileSync(path.join(SRC, "characters.json"), "utf-8"));
const { grid, background: [BR, BG, BB] } = spec;
const S = grid.size;
const DIRS = ["down", "side", "up"];

const sheet = await sharp(path.join(SRC, "reshef-sheet.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = sheet.info.width, H = sheet.info.height;
const isColour = (x, y, [r, g, b]) => {
  const i = (y * W + x) * 4, d = sheet.data;
  return d[i] === r && d[i + 1] === g && d[i + 2] === b;
};
const isBg = (x, y) => isColour(x, y, [BR, BG, BB]);
const isGrid = (x, y) => isColour(x, y, [178, 0, 255]);

/** A w x h RGBA region of the sheet with the background (and the grid of empty cells) made transparent; null when it holds only background. */
function region(x0, y0, w, h, flip = false) {
  const px = Buffer.alloc(w * h * 4);
  let any = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x0 + (flip ? w - 1 - x : x), sy = y0 + y;
    if (isBg(sx, sy) || isGrid(sx, sy)) continue;
    any = true;
    sheet.data.copy(px, (y * w + x) * 4, (sy * W + sx) * 4, (sy * W + sx) * 4 + 4);
  }
  return any ? px : null;
}
const cell = ([c, r], flip) => region(grid.x + grid.pitch * c, grid.y + grid.pitch * r, S, S, flip);

/** A frame moved dy pixels down (negative = up); rows that move out are dropped, new rows are transparent. */
function shiftY(px, dy) {
  if (!dy) return px;
  const out = Buffer.alloc(px.length), row = S * 4;
  for (let y = 0; y < S; y++) if (y - dy >= 0 && y - dy < S) px.copy(out, y * row, (y - dy) * row, (y - dy + 1) * row);
  return out;
}

/** Cell lists per direction for one manifest entry. */
function cellsOf(entry) {
  if (Array.isArray(entry)) entry = { at: entry };
  if (!entry.at) return entry;
  const [c, r] = entry.at, rows = entry.rows ?? DIRS, out = { ...entry };
  rows.forEach((dir, i) => { out[dir] = [0, 1, 2].map((k) => [c + k, r + i]); });
  return out;
}

/** Packs frames (RGBA buffers, all w x h) into rows of `perRow`. */
async function pack(rows, w, h, perRow, file) {
  const raw = Buffer.alloc(perRow * w * rows.length * h * 4);
  rows.forEach((frames, r) => frames.forEach((px, k) => {
    for (let y = 0; y < h; y++) px.copy(raw, (((r * h + y) * perRow + k) * w) * 4, y * w * 4, (y + 1) * w * 4);
  }));
  await sharp(raw, { raw: { width: perRow * w, height: rows.length * h, channels: 4 } }).png({ compressionLevel: 9 }).toFile(file);
  return raw;
}

/** The 9 frames of a ready-made 3x3 sheet (rows down / side / up). */
async function sheetFrames(file) {
  const { data, info } = await sharp(path.join(SRC, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== 3 * S || info.height !== 3 * S) throw new Error(`${file}: ${info.width}x${info.height}, expected ${3 * S}x${3 * S}`);
  const frames = [];
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) {
    const px = Buffer.alloc(S * S * 4);
    for (let y = 0; y < S; y++) data.copy(px, y * S * 4, ((r * S + y) * info.width + k * S) * 4, ((r * S + y) * info.width + (k + 1) * S) * 4);
    frames.push(px);
  }
  return frames;
}

// Characters: 3 frames per direction; a missing step repeats the stand frame, a missing direction borrows another.
const names = Object.keys(spec.characters);
const sheets = Object.fromEntries(await Promise.all(names.filter((n) => spec.characters[n].sheet)
  .map(async (n) => [n, await sheetFrames(spec.characters[n].sheet)])));
const charRows = names.map((name) => {
  if (sheets[name]) return sheets[name];
  if (spec.characters[name].recolor) return null; // below, once the base character's frames exist
  const entry = cellsOf(spec.characters[name]);
  const dirs = {};
  for (const dir of DIRS) {
    const frames = (entry[dir] ?? []).map((at) => cell(at, dir === "side" && entry.flip));
    if (entry[dir] && !frames[0]) throw new Error(`${name}: ${dir} stand cell ${entry[dir][0]} is empty`);
    if (frames.length) dirs[dir] = [0, 1, 2].map((k) => shiftY(frames[k] ?? frames[0], entry.nudge?.[dir]?.[k] ?? 0));
  }
  for (const dir of DIRS) if (!dirs[dir]) {
    const from = DIRS.find((d) => dirs[d]);
    console.warn(`${name}: no ${dir} frames, using ${from}`);
    dirs[dir] = dirs[from];
  }
  return DIRS.flatMap((dir) => dirs[dir]);
});

/**
 * Recoloured variants: { recolor: base, hair: [dark, mid, light], shirt: [dark, mid, light] } swaps the base's ramps
 * (spec.recolors[base]) for new ones. The shirt ramp is swapped everywhere. The hair ramp only in the head (rows above
 * the first shirt pixel), never next to white (eyes), and its darkest colour (also the outline) only where all four
 * neighbours are hair too, so outlines and pupils stay.
 */
const key = ([r, g, b]) => (r << 16) | (g << 8) | b;
function recolor(frames, ramps, entry) {
  const hair = new Map(ramps.hair.map((c, i) => [key(c), entry.hair?.[i]]));
  const shirt = new Map(ramps.shirt.map((c, i) => [key(c), entry.shirt?.[i]]));
  const outline = key(ramps.hair[0]), white = key([240, 240, 240]);
  return frames.map((src) => {
    const px = Buffer.from(src);
    const at = (x, y) => (x < 0 || y < 0 || x >= S || y >= S || !src[(y * S + x) * 4 + 3] ? -1 : key(src.subarray((y * S + x) * 4)));
    let neck = S;
    for (let y = 0; y < S && neck === S; y++) for (let x = 0; x < S; x++) if (shirt.has(at(x, y))) { neck = y; break; }
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const c = at(x, y), around = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
      let to = shirt.get(c);
      if (!to && y < neck && hair.has(c) && !around.includes(white) && (c !== outline || around.every((n) => hair.has(n)))) to = hair.get(c);
      if (to) px.set(to, (y * S + x) * 4);
    }
    return px;
  });
}
names.forEach((name, i) => {
  const entry = spec.characters[name];
  if (!entry.recolor) return;
  const base = charRows[names.indexOf(entry.recolor)], ramps = spec.recolors?.[entry.recolor];
  if (!base || !ramps) throw new Error(`${name}: recolor needs "${entry.recolor}" in characters and recolors`);
  charRows[i] = recolor(base, ramps, entry);
});
await pack(charRows, S, S, 9, path.join(OUT, "characters.png"));
writeFileSync(path.join(OUT, "characters.json"), JSON.stringify({ frameSize: S, framesPerCharacter: 9, names }, null, 1) + "\n");

// Props: one frame each, 16 per row.
const propNames = Object.keys(spec.props);
const propFrames = propNames.map((name) => cell(spec.props[name]));
const propRows = [];
for (let i = 0; i < propFrames.length; i += 16) propRows.push(propFrames.slice(i, i + 16));
const blank = Buffer.alloc(S * S * 4);
while (propRows.at(-1).length < 16) propRows.at(-1).push(blank);
await pack(propRows, S, S, 16, path.join(OUT, "props.png"));
writeFileSync(path.join(OUT, "props.json"), JSON.stringify({ frameSize: S, perRow: 16, names: propNames }, null, 1) + "\n");

// Balloons: boxes (frames) are the non-grid rectangles in their area; each row splits into runs (a gap wider than
// between frames) = one balloon each.
const [ax, ay, aw, ah] = spec.balloons.area;
const boxes = [];
for (let y = ay; y < ay + ah; y++) for (let x = ax; x < ax + aw; x++) {
  if (isGrid(x, y) || !isGrid(x - 1, y) || !isGrid(x, y - 1)) continue;
  let x1 = x, y1 = y;
  while (!isGrid(x1 + 1, y)) x1++;
  while (!isGrid(x, y1 + 1)) y1++;
  boxes.push({ x, y, w: x1 - x + 1, h: y1 - y + 1 });
}
const bw = boxes[0].w, bh = boxes[0].h;
if (boxes.some((b) => b.w !== bw || b.h !== bh)) throw new Error(`balloon boxes differ in size: ${JSON.stringify(boxes)}`);
const runs = [];
for (const rowY of [...new Set(boxes.map((b) => b.y))].sort((a, b) => a - b)) {
  const row = boxes.filter((b) => b.y === rowY).sort((a, b) => a.x - b.x);
  const step = Math.min(...row.slice(1).map((b, i) => b.x - row[i].x));
  row.forEach((b, i) => {
    if (i && b.x - row[i - 1].x <= step) runs.at(-1).push(b);
    else runs.push([b]);
  });
}
if (runs.length !== spec.balloons.names.length) throw new Error(`found ${runs.length} balloons, named ${spec.balloons.names.length}`);
const longest = Math.max(...runs.map((r) => r.length));
const balloonRows = runs.map((run) => {
  const frames = run.map((b) => region(b.x, b.y, bw, bh) ?? Buffer.alloc(bw * bh * 4));
  while (frames.length < longest) frames.push(Buffer.alloc(bw * bh * 4));
  return frames;
});
await pack(balloonRows, bw, bh, longest, path.join(OUT, "balloons.png"));
const balloons = Object.fromEntries(spec.balloons.names.map((name, i) => [name, { row: i, frames: runs[i].length }]));
writeFileSync(path.join(OUT, "balloons.json"), JSON.stringify({ frameWidth: bw, frameHeight: bh, perRow: longest, balloons }, null, 1) + "\n");

// Contact sheet (docs/characters.png): every character's 9 frames with its name, then the props, at 2x.
const COLS = 4, CW = 9 * S + 16, CH = S + 14, PCW = S + 40, PCH = S + 14, SCALE = 2;
const charH = Math.ceil(names.length / COLS) * CH, propCols = Math.floor((COLS * CW) / PCW);
const sheetW = COLS * CW, sheetH = charH + 20 + Math.ceil(propNames.length / propCols) * PCH;
const parts = [], labels = [];
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
names.forEach((name, i) => {
  const x = (i % COLS) * CW + 8, y = Math.floor(i / COLS) * CH;
  charRows[i].forEach((px, k) => parts.push({ input: px, raw: { width: S, height: S, channels: 4 }, left: x + k * S, top: y + 12 }));
  labels.push(`<text x="${x}" y="${y + 10}">${i} ${esc(name)}</text>`);
});
propNames.forEach((name, i) => {
  const x = (i % propCols) * PCW + 8, y = charH + 20 + Math.floor(i / propCols) * PCH;
  parts.push({ input: propFrames[i], raw: { width: S, height: S, channels: 4 }, left: x, top: y + 12 });
  labels.push(`<text x="${x}" y="${y + 10}">${esc(name)}</text>`);
});
labels.push(`<text x="8" y="${charH + 14}" font-weight="bold">PROPS</text>`);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}" height="${sheetH}"><style>text{font:9px sans-serif;fill:#ddd}</style>${labels.join("")}</svg>`;
const contact = await sharp({ create: { width: sheetW, height: sheetH, channels: 4, background: "#2b2b38" } })
  .composite([...parts, { input: Buffer.from(svg), left: 0, top: 0 }]).png().toBuffer();
await sharp(contact).resize(sheetW * SCALE, sheetH * SCALE, { kernel: "nearest" }).png().toFile(path.join(ROOT, "docs/characters.png"));

console.log(`${names.length} characters, ${propNames.length} props, ${runs.length} balloons (${runs.map((r) => r.length).join("/")} frames)`);
