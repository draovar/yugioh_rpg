// A map's ground layers (every ground* layer) sorted into the three hand editing uses:
//   ground   the main ground: the lowest visible terrain tile of each cell
//   ground2  terrain overlapping it where needed (edges, transitions, piers over water)
//   ground3  non-collision decorations on the ground (flowers, graffiti, boats, towels...)
// Terrain is any tile of the terrain sheets (TERRAIN_SETS), a pier, or a tile no catalogue object names; the rest of
// the catalogue is decoration. Terrain hidden under an opaque terrain tile is dropped. A cell needing three terrain
// tiles keeps the two that change the fewest pixels (each one is printed); a cell with two decorations stops the run.
// Otherwise Tiled and the game draw the same pixels. Walls layers are left alone (they sort by base, see sortedWalls).
//   node tools/maps/flatten-ground.mjs data/maps/<name>.tmj [--dry]
// Save the map in Tiled first and reload it afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync, gunzipSync, gzipSync, inflateSync } from "node:zlib";
import sharp from "sharp";

const TERRAIN_SETS = new Set(["terrains-and-fences", "autotiles", "city-terrains"]);
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) throw new Error("usage: flatten-ground.mjs data/maps/<name>.tmj [--dry]");
const dry = args.includes("--dry");
const FLIPS = 0xe0000000;

const map = JSON.parse(readFileSync(file, "utf-8"));
const W = map.width, cells = map.width * map.height;
const grounds = map.layers.filter((l) => l.type === "tilelayer" && l.name.startsWith("ground"));
if (!grounds.length) throw new Error(`${file}: no ground layers`);
for (const l of grounds) {
  if ((l.opacity ?? 1) !== 1 || l.offsetx || l.offsety || l.tintcolor) throw new Error(`${l.name}: opacity, offset or tint would be lost`);
  if (l.compression === "zstd") throw new Error(`${l.name}: zstd layers are not supported (pick zlib in Tiled's map properties)`);
}

function decode(l) {
  if (Array.isArray(l.data)) return Uint32Array.from(l.data);
  let buf = Buffer.from(l.data, "base64");
  if (l.compression === "zlib") buf = inflateSync(buf);
  else if (l.compression === "gzip") buf = gunzipSync(buf);
  return new Uint32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
}

function encode(like, data) {
  if (like.encoding !== "base64") return Array.from(data);
  const raw = Buffer.from(data.buffer);
  const packed = like.compression === "zlib" ? deflateSync(raw) : like.compression === "gzip" ? gzipSync(raw) : raw;
  return packed.toString("base64");
}

// Tilesets by first gid (images load when a tile's pixels are needed), and the catalogue's object names by gid.
const dir = path.dirname(path.resolve(file));
const sets = map.tilesets.map((t) => {
  if (!t.source) throw new Error("embedded tilesets are not supported");
  const tsj = JSON.parse(readFileSync(path.join(dir, t.source), "utf-8"));
  return { name: path.basename(t.source, ".tsj"), first: t.firstgid, columns: tsj.columns,
    image: path.resolve(path.dirname(path.join(dir, t.source)), tsj.image) };
}).sort((a, b) => a.first - b.first);
const setOf = (id) => sets.findLast((s) => s.first <= id);
const named = new Map();
for (const e of JSON.parse(readFileSync(path.join(import.meta.dirname, "../../data/maps/tile-catalog.json"), "utf-8")).entries) {
  const s = sets.find((s) => s.name === e.tileset);
  if (s) for (let dy = 0; dy < e.h; dy++) for (let dx = 0; dx < e.w; dx++) named.set(s.first + (e.y + dy) * s.columns + e.x + dx, e.name);
}
function isTerrain(gid) {
  const id = gid & ~FLIPS, name = named.get(id);
  return TERRAIN_SETS.has(setOf(id).name) || !name || name.startsWith("Pier");
}

/** A tile's 16x16 RGBA pixels, flips applied. */
const pixelCache = new Map();
async function pixels(gid) {
  if (pixelCache.has(gid)) return pixelCache.get(gid);
  const id = gid & ~FLIPS, s = setOf(id);
  s.image_ ??= await sharp(s.image, { limitInputPixels: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = s.image_, n = id - s.first;
  const sx = (n % s.columns) * 16, sy = Math.floor(n / s.columns) * 16;
  const h = gid & 0x80000000, v = gid & 0x40000000, d = gid & 0x20000000;
  const out = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let tx = h ? 15 - x : x, ty = v ? 15 - y : y;
    if (d) [tx, ty] = [ty, tx];
    out.set(data.subarray(((sy + ty) * info.width + sx + tx) * 4, ((sy + ty) * info.width + sx + tx) * 4 + 4), (y * 16 + x) * 4);
  }
  pixelCache.set(gid, out);
  return out;
}
const isOpaque = async (gid) => (await pixels(gid)).every((v, k) => k % 4 !== 3 || v === 255);
async function composite(stack) {
  const out = new Float32Array(16 * 16 * 4);
  for (const gid of stack) {
    const p = await pixels(gid);
    for (let k = 0; k < 256; k++) {
      const a = p[k * 4 + 3] / 255;
      for (let c = 0; c < 3; c++) out[k * 4 + c] = p[k * 4 + c] * a + out[k * 4 + c] * (1 - a);
      out[k * 4 + 3] = a + out[k * 4 + 3] * (1 - a);
    }
  }
  return out;
}
async function changedPixels(a, b) {
  const [x, y] = [await composite(a), await composite(b)];
  let n = 0;
  for (let k = 0; k < 256; k++) if ([0, 1, 2, 3].some((c) => Math.abs(x[k * 4 + c] - y[k * 4 + c]) > (c === 3 ? 0.02 : 2))) n++;
  return n;
}

const before = grounds.map(decode);
const out = [new Uint32Array(cells), new Uint32Array(cells), new Uint32Array(cells)];
let hidden = 0;
const trimmed = [], doubled = [], bare = [], reordered = [];
for (let i = 0; i < cells; i++) {
  const stack = before.map((d) => d[i]).filter((g) => g);
  if (!stack.length) continue;
  const at = `${i % W},${Math.floor(i / W)}`;
  let terrain = stack.filter(isTerrain);
  const decor = stack.filter((g) => !isTerrain(g));
  if (stack.findIndex((g) => !isTerrain(g)) < stack.findLastIndex(isTerrain) && decor.length) reordered.push(at);
  let from = 0;
  for (let k = terrain.length - 1; k > 0; k--) if (await isOpaque(terrain[k])) { from = k; break; }
  hidden += from;
  terrain = terrain.slice(from);
  if (terrain.length > 2) {
    // keep the pair (in order) that looks most like the whole stack
    let best = null;
    for (let a = 0; a < terrain.length; a++) for (let b = a + 1; b < terrain.length; b++) {
      const n = await changedPixels(terrain, [terrain[a], terrain[b]]);
      if (!best || n < best.n) best = { pair: [terrain[a], terrain[b]], n };
    }
    trimmed.push(`${at} (${best.n} px)`);
    terrain = best.pair;
  }
  if (decor.length > 1) doubled.push(at);
  if (!terrain.length) bare.push(at);
  if (terrain[0]) out[0][i] = terrain[0];
  if (terrain[1]) out[1][i] = terrain[1];
  if (decor[0]) out[2][i] = decor[0];
}
if (doubled.length) throw new Error(`two decorations on one tile (only ground3 holds them), nothing written: ${doubled.join(" ")}`);

// The new layers reuse the old ground layers' entries (ids, properties, shown or hidden in Tiled; the game draws them
// all) at the first one's place.
const names = ["ground", "ground2", "ground3"];
const result = names.map((name, k) => ({ ...(grounds[k] ?? { ...grounds[0], id: map.nextlayerid++, visible: true }), name,
  encoding: grounds[0].encoding, compression: grounds[0].compression, data: encode(grounds[0], out[k]) }));
const at = map.layers.indexOf(grounds[0]);
map.layers = map.layers.filter((l) => !grounds.includes(l));
map.layers.splice(at, 0, ...result);

const count = (d) => d.reduce((n, g) => n + (g ? 1 : 0), 0);
console.log(`${file}: ${grounds.length} ground layers → ground (main), ground2 (overlaps), ground3 (decorations); ${hidden} hidden tiles dropped`);
for (const [k, d] of out.entries()) console.log(`  ${names[k].padEnd(8)} ${count(d)} tiles`);
if (trimmed.length) console.log(`three terrain tiles on one cell, kept the two closest to the old look: ${trimmed.join(", ")}`);
if (reordered.length) console.log(`decorations that were under terrain, now drawn over it: ${reordered.join(" ")}`);
if (bare.length) console.log(`decorations with no ground under them (${bare.length}): ${bare.slice(0, 20).join(" ")}${bare.length > 20 ? " ..." : ""}`);
if (dry) console.log("(dry run, nothing written)");
else writeFileSync(file, JSON.stringify(map, null, 1) + "\n");
