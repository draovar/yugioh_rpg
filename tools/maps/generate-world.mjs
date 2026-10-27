// A world template from a blockout picture: data/maps/<world>/layout.json names the blockout (1 px = 1 tile, colours in
// its legend: sea, grass, desert, forest, mountain, city, harbour, road) and cuts it into maps: the layout's named
// `maps` (x, y, width, height in tiles; laid out along the terrain, not overlapping), and if it has a `grid`, a grid of
// cells for the rest (a cell a named map covers in part is cut into rectangles, named -a, -b...; a named map grows to a
// grid line its edge is within `minSide` of, so no sliver is left). All sizes even; maps of open sea are left out, and
// so is land no map covers (walking into it stops at the edge). Writes each map as data/maps/<name>.tmj
// (layers zlib-compressed) plus the Tiled world placing them side by side. `spawn` and `areas` (labelled city zones)
// are world tile positions.
//   node tools/maps/generate-world.mjs data/maps/island/layout.json [--only NAME[,NAME]] [--force]
// The theme tilesets are drawn at 16 px, so every 32 px piece of the pack is 2x2 tiles: terrain is laid out on a grid
// of 2-tile cells. Each terrain is a layer of edge pieces chosen by which corners of the cell it covers (pieces found
// in the sheets by looking at their corners), stacked: water < sand < grass < rocky ground (mountains) < dirt (roads) <
// pavement.
// Trees (forest, a few on grass) and rocks are scattered with a seeded hash, so maps cut from one blockout always
// fit at their edges. A scaffold: existing maps are only overwritten with --force (Tiled edits are lost).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "../..");
const MAPS = path.join(ROOT, "data/maps");
const args = process.argv.slice(2);
const layoutFile = args.find((a) => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--only"));
if (!layoutFile) throw new Error("usage: generate-world.mjs data/maps/<world>/layout.json [--only NAME] [--force]");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const force = args.includes("--force");
const layout = JSON.parse(readFileSync(layoutFile, "utf-8"));
const dir = path.dirname(path.resolve(layoutFile));

// --- tilesets (firstgid order fixed) ---------------------------------------------------------------------------
const SETS = ["terrains-and-fences", "camping", "city-terrains"];
const sets = {};
let nextGid = 1;
for (const name of SETS) {
  const tsj = JSON.parse(readFileSync(path.join(MAPS, "tilesets", `${name}.tsj`), "utf-8"));
  sets[name] = { firstgid: nextGid, columns: tsj.columns, image: path.join(MAPS, "tilesets", tsj.image) };
  nextGid += tsj.tilecount;
}
const gid = (set, x, y) => sets[set].firstgid + y * sets[set].columns + x;
/** A 2x2 piece at tile (x, y) of a set: its four gids (TL, TR, BL, BR). */
const piece = (set, x, y) => [gid(set, x, y), gid(set, x + 1, y), gid(set, x, y + 1), gid(set, x + 1, y + 1)];

const images = {};
async function rgba(set) {
  images[set] ??= await sharp(sets[set].image, { limitInputPixels: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return images[set];
}

/**
 * Edge pieces of a terrain set by corner signature (TL 8, TR 4, BL 2, BR 1: corners the terrain covers): every 2x2
 * piece in the region whose four corners are clearly covered or clearly not. `covered` tells for a corner's pixels.
 * Signature 15 (the fill) keeps every variant; the rest keep the first piece found.
 */
async function edgeSet(set, [x0, y0, x1, y1], covered) {
  const { data, info } = await rgba(set);
  const bySig = new Map();
  for (let ty = y0; ty < y1; ty += 2) for (let tx = x0; tx < x1; tx += 2) {
    const px = tx * 16, py = ty * 16;
    // the outermost 2x2 pixels of each corner of the 32px piece (inner corners notch only the very corner)
    const corner = (cx, cy) => {
      const votes = [];
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const x = px + (cx ? 31 - dx : dx), y = py + (cy ? 31 - dy : dy), i = (y * info.width + x) * 4;
        votes.push(covered(data[i], data[i + 1], data[i + 2], data[i + 3]));
      }
      return votes.every((v) => v) ? 1 : votes.every((v) => !v) ? 0 : -1;
    };
    const c = [corner(0, 0), corner(1, 0), corner(0, 1), corner(1, 1)];
    if (c.includes(-1)) continue;
    const sig = c[0] * 8 + c[1] * 4 + c[2] * 2 + c[3];
    if (sig === 0) continue;
    if (!bySig.has(sig)) bySig.set(sig, []);
    if (sig === 15 || !bySig.get(sig).length) bySig.get(sig).push(piece(set, tx, ty));
  }
  if (!bySig.has(15)) throw new Error(`${set} ${[x0, y0]}: no fill piece found`);
  return bySig;
}
const opaque = (r, g, b, a) => a > 128;
/** Opaque sets drawn over another terrain: covered = nearer `fill`'s colour than `background`'s. */
const nearer = (fill, background) => (r, g, b) =>
  (r - fill[0]) ** 2 + (g - fill[1]) ** 2 + (b - fill[2]) ** 2 < (r - background[0]) ** 2 + (g - background[1]) ** 2 + (b - background[2]) ** 2;
async function colourAt(set, tx, ty) {
  const { data, info } = await rgba(set);
  const i = ((ty * 16 + 8) * info.width + tx * 16 + 8) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}

// Terrain sets (tile coordinates in the theme sheets): grass and sand patches on transparent ground, the dirt patch of
// the grass/dirt set (opaque: dirt over that set's grass), the khaki set (rocky ground over grass). Cities get plain sidewalk (opaque everywhere, no edge
// pieces to find): a placeholder for the streets drawn in Tiled.
const TERRAIN = {
  grass: await edgeSet("terrains-and-fences", [0, 22, 10, 30], opaque),
  sand: await edgeSet("terrains-and-fences", [32, 120, 42, 128], opaque),
  dirt: await edgeSet("terrains-and-fences", [0, 12, 10, 20],
    nearer(await colourAt("terrains-and-fences", 8, 16), await colourAt("terrains-and-fences", 2, 14))),
  rock: await edgeSet("terrains-and-fences", [0, 100, 10, 108],
    nearer(await colourAt("terrains-and-fences", 2, 102), await colourAt("terrains-and-fences", 2, 14))),
  pavement: new Map([[15, [piece("city-terrains", 2, 2)]]]),
};
const WATER = piece("terrains-and-fences", 24, 16);

// Props: [set, x, y, w, h] in tiles; trunk = collision cells (dx, dy) inside the prop.
const prop = (set, x, y, w, h, trunk) => ({ set, x, y, w, h, trunk });
const PINES = [prop("camping", 36, 120, 4, 8, [[1, 6], [2, 6]]), prop("camping", 40, 120, 4, 8, [[1, 6], [2, 6]]),
  prop("camping", 40, 132, 4, 8, [[1, 6], [2, 6]])];
const ROUND_TREES = [prop("camping", 8, 148, 4, 6, [[1, 4], [2, 4]]), prop("camping", 34, 104, 6, 6, [[2, 4], [3, 4]])];
const ROCKS = [0, 1, 2].map((i) => prop("camping", 38 + i * 2, 74, 2, 2, [[0, 1], [1, 1]]));

// --- blockout → tile classes ---------------------------------------------------------------------------------------
const { data: bo, info: boInfo } = await sharp(path.join(dir, layout.blockout)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const classes = Object.keys(layout.legend);
// Without a grid: one cell the size of the blockout (rounded up to even), which makes no maps itself.
const { width: GW, height: GH } = layout.grid ?? { width: boInfo.width + (boInfo.width % 2), height: boInfo.height + (boInfo.height % 2) };
if (GW % 2 || GH % 2) throw new Error("grid cells must be even (2-tile cells)");
const COLS = Math.ceil(boInfo.width / GW), ROWS = Math.ceil(boInfo.height / GH);
const W = COLS * GW, H = ROWS * GH;
const mapName = (col, row) => layout.grid.name.replace("{col}", String(col).padStart(2, "0")).replace("{row}", String(row).padStart(2, "0"));

/** The maps as rectangles in tiles: the named ones (edges snapped to nearby grid lines), then the grid's leftovers. */
function mapRects() {
  const min = layout.grid?.minSide ?? 0;
  // Outwards only: a named map never loses any of its rectangle.
  const down = (v, step) => (v - Math.floor(v / step) * step <= min ? Math.floor(v / step) * step : v);
  const up = (v, step) => (Math.ceil(v / step) * step - v <= min ? Math.ceil(v / step) * step : v);
  const named = Object.entries(layout.maps ?? {}).map(([name, [x, y, w, h]]) => {
    if ([x, y, w, h].some((v) => v % 2)) throw new Error(`${name}: map rectangles must be even (2-tile cells)`);
    const x0 = down(x, GW), y0 = down(y, GH), x1 = Math.min(W, up(x + w, GW)), y1 = Math.min(H, up(y + h, GH));
    return { name, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  });
  const rects = [...named];
  if (!layout.grid) return rects;
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    // The cell's free 2x2 blocks, taken greedily: the first free block, as far right as it goes, then as far down as the
    // whole row stays free.
    const cw = GW / 2, ch = GH / 2, cx0 = col * GW, cy0 = row * GH;
    const free = new Uint8Array(cw * ch);
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      const x = cx0 + 2 * i, y = cy0 + 2 * j;
      free[j * cw + i] = named.some((n) => x >= n.x && x < n.x + n.w && y >= n.y && y < n.y + n.h) ? 0 : 1;
    }
    const pieces = [];
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      if (!free[j * cw + i]) continue;
      let i1 = i;
      while (i1 + 1 < cw && free[j * cw + i1 + 1]) i1++;
      let j1 = j;
      while (j1 + 1 < ch && free.subarray((j1 + 1) * cw + i, (j1 + 1) * cw + i1 + 1).every((v) => v)) j1++;
      for (let jj = j; jj <= j1; jj++) free.fill(0, jj * cw + i, jj * cw + i1 + 1);
      pieces.push({ x: cx0 + 2 * i, y: cy0 + 2 * j, w: 2 * (i1 - i + 1), h: 2 * (j1 - j + 1) });
    }
    pieces.forEach((p, k) => rects.push({ name: mapName(col, row) + (pieces.length > 1 ? "-" + "abcdefgh"[k] : ""), ...p }));
  }
  return rects;
}
const tile = new Uint8Array(W * H).fill(classes.indexOf("sea"));
for (let y = 0; y < Math.min(H, boInfo.height); y++) for (let x = 0; x < Math.min(W, boInfo.width); x++) {
  const i = (y * boInfo.width + x) * 3;
  let best = 0, bd = Infinity;
  classes.forEach((c, k) => {
    const [r, g, b] = layout.legend[c], d = (bo[i] - r) ** 2 + (bo[i + 1] - g) ** 2 + (bo[i + 2] - b) ** 2;
    if (d < bd) { bd = d; best = k; }
  });
  tile[y * W + x] = best;
}
const C = Object.fromEntries(classes.map((c, k) => [c, k]));
// Roads are drawn over the ground they cross: a road tile's ground is the most common other class within 2 tiles.
const isRoad = tile.map((c) => (c === C.road ? 1 : 0));
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (!isRoad[y * W + x]) continue;
  const n = new Array(classes.length).fill(0);
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx >= 0 && yy >= 0 && xx < W && yy < H && !isRoad[yy * W + xx]) n[tile[yy * W + xx]]++;
  }
  tile[y * W + x] = n.some((v) => v) ? n.indexOf(Math.max(...n)) : C.grass;
}
const clamp = (x, y) => Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x));
const at = (x, y) => tile[clamp(x, y)];
const roadAt = (x, y) => isRoad[clamp(x, y)] === 1;

// --- cell corners (vertices every 2 tiles) ----------------------------------------------------------------------
const VW = W / 2 + 1, VH = H / 2 + 1;
/** A vertex mask: vertex (i, j) sits on tile corner (2i, 2j); `test` sees the 4 tiles around it. */
function vertexMask(test) {
  const m = new Uint8Array(VW * VH);
  for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) {
    const around = [at(2 * i - 1, 2 * j - 1), at(2 * i, 2 * j - 1), at(2 * i - 1, 2 * j), at(2 * i, 2 * j)];
    m[j * VW + i] = test(around, 2 * i, 2 * j) ? 1 : 0;
  }
  return m;
}
const vAt = (m, i, j) => i < 0 || j < 0 || i >= VW || j >= VH ? 0 : m[j * VW + i];
const majority = (cs) => (around) => around.filter((c) => cs.includes(c)).length >= 2;
/** Smooths a mask: lone vertices go, one-vertex gaps fill, and no cell keeps a diagonal-only pair of corners. */
function tidy(m, keepThin = false) {
  for (let pass = 0; pass < 4; pass++) {
    const copy = m.slice();
    for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) {
      let n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (di || dj) n += vAt(copy, i + di, j + dj);
      if (!keepThin && copy[j * VW + i] && n <= 2) m[j * VW + i] = 0;
      if (!copy[j * VW + i] && n >= 6) m[j * VW + i] = 1;
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (let j = 0; j < VH - 1; j++) for (let i = 0; i < VW - 1; i++) {
      const s = vAt(m, i, j) * 8 + vAt(m, i + 1, j) * 4 + vAt(m, i, j + 1) * 2 + vAt(m, i + 1, j + 1);
      if (s === 9 || s === 6) { m[j * VW + i] = m[j * VW + i + 1] = m[(j + 1) * VW + i] = m[(j + 1) * VW + i + 1] = 1; changed = true; }
    }
  }
  return m;
}
const and = (a, b) => a.map((v, k) => v & b[k]);
/** Vertices whose 8 neighbours are all in `m` too. */
const inner = (m) => m.map((v, k) => {
  const i = k % VW, j = (k - i) / VW;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (!vAt(m, i + di, j + dj)) return 0;
  return v;
});

const land = [C.grass, C.forest, C.mountain, C.city];
const sand = tidy(vertexMask(majority([C.desert])));
const grass = tidy(vertexMask(majority(land)));
// Roads: any road tile within a tile of the vertex (the blockout's roads are 1 px wide) → ~2 cells wide paths.
const roadNear = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 1; dx++) if (roadAt(x + dx, y + dy)) return true; return false; };
const roadNearV = (x, y) => { for (let dy = -2; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (roadAt(x + dx, y + dy)) return true; return false; };
const mountain = tidy(vertexMask(majority([C.mountain])));
const road = tidy(vertexMask((around, x, y) => roadNear(x, y) || roadNearV(x, y)), true);
const grassInner = inner(grass);
const dirt = tidy(and(road, grassInner), true);
const rock = tidy(and(mountain, grassInner));
const pavement = tidy(vertexMask(majority([C.city, C.harbour])));

// --- layers over the whole world (tile gids) ---------------------------------------------------------------------
const hash = (x, y, salt) => {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const world = { ground: new Uint32Array(W * H), ground2: new Uint32Array(W * H), ground3: new Uint32Array(W * H),
  ground4: new Uint32Array(W * H), ground5: new Uint32Array(W * H), ground6: new Uint32Array(W * H), walls: new Uint32Array(W * H),
  walls2: new Uint32Array(W * H), walls3: new Uint32Array(W * H), collision: new Uint8Array(W * H) };
const put2 = (layer, cx, cy, p) => {
  layer[2 * cy * W + 2 * cx] = p[0]; layer[2 * cy * W + 2 * cx + 1] = p[1];
  layer[(2 * cy + 1) * W + 2 * cx] = p[2]; layer[(2 * cy + 1) * W + 2 * cx + 1] = p[3];
};
function paint(layer, mask, bySig, salt) {
  for (let cy = 0; cy < H / 2; cy++) for (let cx = 0; cx < W / 2; cx++) {
    const sig = vAt(mask, cx, cy) * 8 + vAt(mask, cx + 1, cy) * 4 + vAt(mask, cx, cy + 1) * 2 + vAt(mask, cx + 1, cy + 1);
    if (!sig) continue;
    const options = bySig.get(sig) ?? bySig.get(15);
    // The fill's variants: mostly the first (plain), now and then another.
    const pick = sig === 15 && options.length > 1 && hash(cx, cy, salt) < 0.25 ? 1 + Math.floor(hash(cy, cx, salt) * (options.length - 1)) : 0;
    put2(layer, cx, cy, options[pick]);
  }
}
for (let cy = 0; cy < H / 2; cy++) for (let cx = 0; cx < W / 2; cx++) put2(world.ground, cx, cy, WATER);
paint(world.ground2, sand, TERRAIN.sand, 1);
paint(world.ground3, grass, TERRAIN.grass, 2);
paint(world.ground4, rock, TERRAIN.rock, 5);
paint(world.ground5, dirt, TERRAIN.dirt, 3);
paint(world.ground6, pavement, TERRAIN.pavement, 4);

// Collision: a tile takes its nearest cell corner. Water (no land, no pavement) and mountains block.
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (x + 1) >> 1, j = (y + 1) >> 1;
  const walkable = vAt(grass, i, j) || vAt(sand, i, j) || vAt(pavement, i, j);
  if (!walkable || (vAt(mountain, i, j) && !vAt(road, i, j))) world.collision[y * W + x] = 1;
}

// --- props --------------------------------------------------------------------------------------------------------
const free = new Uint8Array(W * H); // tiles a prop already covers on the given walls layer
/**
 * Places a prop with its top-left at (x, y) if every tile is ok. One on a map edge is split between the two maps (each
 * shows its part; the camera never looks past a map's edge).
 */
function place(p, x, y, layerName, ok) {
  if (x < 0 || y < 0 || x + p.w > W || y + p.h > H) return false;
  for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) if (!ok(x + dx, y + dy)) return false;
  for (const [dx, dy] of p.trunk) if (world.collision[(y + dy) * W + x + dx] || free[(y + dy) * W + x + dx]) return false;
  const layer = world[layerName];
  for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) if (layer[(y + dy) * W + x + dx]) return false;
  for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) layer[(y + dy) * W + x + dx] = gid(p.set, p.x + dx, p.y + dy);
  for (const [dx, dy] of p.trunk) { world.collision[(y + dy) * W + x + dx] = 1; free[(y + dy) * W + x + dx] = 1; }
  return true;
}
const vertexOf = (x, y) => [(x + 1) >> 1, (y + 1) >> 1];
const isOn = (mask) => (x, y) => vAt(mask, ...vertexOf(x, y));
/** No road, pavement, water or mountain within `r` tiles. */
const clearOfPaths = (r) => (x, y) => {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const xx = x + dx, yy = y + dy;
    if (isOn(dirt)(xx, yy) || isOn(pavement)(xx, yy) || !isOn(grass)(xx, yy)) return false;
  }
  return true;
};
// Forest: rows of pines 3 tiles apart (each row on the next walls layer, so crowns overlap), staggered, a few gaps.
const WALLS = ["walls", "walls2", "walls3"];
for (let row = 0, y = 0; y < H; row++, y += 3) {
  for (let x = (row % 2) * 2; x < W; x += 4) {
    if (hash(x, y, 10) < 0.12) continue;
    const jx = x + Math.floor(hash(x, y, 11) * 3) - 1;
    const p = PINES[Math.floor(hash(x, y, 12) * PINES.length)];
    place(p, jx, y, WALLS[row % 3], (xx, yy) => at(xx, yy) === C.forest && clearOfPaths(1)(xx, yy));
  }
}
// Grassland: a tree here and there.
for (let y = 0; y < H; y += 5) for (let x = 0; x < W; x += 5) {
  if (hash(x, y, 20) > 0.07) continue;
  const p = ROUND_TREES[Math.floor(hash(x, y, 21) * ROUND_TREES.length)];
  place(p, x + Math.floor(hash(x, y, 22) * 3), y + Math.floor(hash(x, y, 23) * 3), "walls", (xx, yy) => at(xx, yy) === C.grass && clearOfPaths(2)(xx, yy));
}
// Rocks on mountains (thick) and in the desert (sparse). Mountains block anyway: their rocks need no trunk check.
for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
  const onMountain = isOn(mountain)(x, y) && isOn(mountain)(x + 1, y + 1), onSand = at(x, y) === C.desert && isOn(sand)(x, y) && !isOn(grass)(x, y);
  if (!(onMountain && hash(x, y, 30) < 0.08) && !(onSand && hash(x, y, 31) < 0.012)) continue;
  const p = ROCKS[Math.floor(hash(x, y, 32) * ROCKS.length)];
  if (onMountain) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) world.walls2[(y + dy) * W + x + dx] ||= gid(p.set, p.x + dx, p.y + dy);
  else place(p, x, y, "walls2", (xx, yy) => isOn(sand)(xx, yy) && !isOn(grass)(xx, yy) && !isOn(dirt)(xx, yy));
}

// --- paved areas: the labelled ones (layout areas) as rectangles in every map they reach -----------------------------
const areaRects = [];
for (const { note, at: [ax, ay] } of layout.areas ?? []) {
  let seed = null, best = Infinity;
  for (let y = Math.max(0, ay - 60); y < Math.min(H, ay + 60); y++) for (let x = Math.max(0, ax - 60); x < Math.min(W, ax + 60); x++) {
    const d = (x - ax) ** 2 + (y - ay) ** 2;
    if (d < best && isOn(pavement)(x, y)) { best = d; seed = [x, y]; }
  }
  if (!seed) { console.log(`area "${note}": no pavement near ${ax},${ay}`); continue; }
  const seen = new Set([seed[1] * W + seed[0]]), stack = [seed];
  let [x0, y0, x1, y1] = [seed[0], seed[1], seed[0], seed[1]];
  while (stack.length) {
    const [x, y] = stack.pop();
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H || seen.has(yy * W + xx) || !isOn(pavement)(xx, yy)) continue;
      seen.add(yy * W + xx);
      stack.push([xx, yy]);
    }
  }
  areaRects.push({ note, x0, y0, x1: x1 + 1, y1: y1 + 1, seed });
}
// The spawn: the paved tile nearest the layout's spawn point.
const spawnArea = areaRects.find((a) => a.x0 <= layout.spawn[0] && layout.spawn[0] < a.x1 && a.y0 <= layout.spawn[1] && layout.spawn[1] < a.y1);
const spawn = spawnArea?.seed ?? layout.spawn;

// --- write the maps ----------------------------------------------------------------------------------------------
/** Tiled's base64 + zlib layer data (little-endian uint32 per cell). */
const encode = (cells) => deflateSync(Buffer.from(new Uint32Array(cells).buffer)).toString("base64");
const tilesets = SETS.map((name) => ({ firstgid: sets[name].firstgid, source: `tilesets/${name}.tsj` }));
const worldFile = { maps: [], onlyShowAdjacentMaps: false, type: "world" };
let written = 0, startMap = null;
for (const { name, x: mx, y: my, w: mw, h: mh } of mapRects()) {
  let landTiles = 0;
  for (let y = my; y < my + mh; y++) for (let x = mx; x < mx + mw; x++) if (!world.collision[y * W + x] || isOn(grass)(x, y) || isOn(sand)(x, y)) landTiles++;
  if (!landTiles) continue;
  worldFile.maps.push({ fileName: `${name}.tmj`, x: mx * 16, y: my * 16, width: mw * 16, height: mh * 16 });
  const hasSpawn = spawn[0] >= mx && spawn[0] < mx + mw && spawn[1] >= my && spawn[1] < my + mh;
  if (hasSpawn) startMap = name;
  if (only && !only.includes(name)) continue;
  const file = path.join(MAPS, `${name}.tmj`);
  if (existsSync(file) && !force) { console.log(`${name}: exists, kept (--force overwrites)`); continue; }
  const cut = (layer) => { const out = []; for (let y = my; y < my + mh; y++) for (let x = mx; x < mx + mw; x++) out.push(layer[y * W + x]); return out; };
  const collisionGid = WATER[0];
  let id = 1;
  const tileLayer = (lname, cells, visible = true) => ({ id: id++, name: lname, type: "tilelayer", x: 0, y: 0, width: mw, height: mh,
    opacity: 1, visible, encoding: "base64", compression: "zlib", data: encode(cells) });
  const layers = ["ground", "ground2", "ground3", "ground4", "ground5", "ground6", "walls", "walls2", "walls3"].map((l) => tileLayer(l, cut(world[l])));
  layers.push(tileLayer("collision", cut(world.collision).map((c) => (c ? collisionGid : 0)), false));
  // Objects: the labelled areas' parts in this map, and the spawn.
  const objects = [];
  let objectId = 1;
  for (const a of areaRects) {
    const x0 = Math.max(a.x0, mx), y0 = Math.max(a.y0, my), x1 = Math.min(a.x1, mx + mw), y1 = Math.min(a.y1, my + mh);
    if (x0 >= x1 || y0 >= y1) continue;
    objects.push({ id: objectId++, name: "area", type: "", x: (x0 - mx) * 16, y: (y0 - my) * 16, width: (x1 - x0) * 16, height: (y1 - y0) * 16,
      rotation: 0, visible: true, properties: [{ name: "note", type: "string", value: a.note }] });
  }
  if (hasSpawn) {
    objects.push({ id: objectId++, name: "spawn", type: "", x: (spawn[0] - mx) * 16 + 8, y: (spawn[1] - my) * 16, width: 0, height: 0,
      rotation: 0, visible: true, point: true });
  }
  layers.push({ id: id++, name: "objects", type: "objectgroup", x: 0, y: 0, opacity: 1, visible: true, draworder: "topdown", objects });
  const map = { compressionlevel: -1, width: mw, height: mh, infinite: false, orientation: "orthogonal", renderorder: "right-down",
    tiledversion: "1.12.2", version: "1.10", type: "map", tilewidth: 16, tileheight: 16, nextlayerid: id, nextobjectid: objectId,
    layers, tilesets };
  writeFileSync(file, JSON.stringify(map));
  written++;
}
writeFileSync(path.resolve(dir, layout.world), JSON.stringify(worldFile, null, 1));
console.log(`${Object.keys(layout.maps ?? {}).length} named maps${layout.grid ? ` + ${COLS}x${ROWS} grid of ${GW}x${GH}` : ""}: ${worldFile.maps.length} maps (${written} written), start map ${startMap}`);
console.log(`world → ${path.relative(ROOT, path.resolve(dir, layout.world))}`);
