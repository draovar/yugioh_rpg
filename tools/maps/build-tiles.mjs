// Packs the overworld maps' tiles. The paid tilesets (LimeZu Modern Exteriors: the complete sheet, 5632x16448, taller
// than most GPUs' max texture size, and its theme sheets) may not go into the public repo, so each map gets only the
// tiles it uses, from any number of tilesets:
//   data/maps/<name>.tmj + its tilesets data/maps/**/*.tsj (Tiled, committed) + their images in vendor/paid/ (private
//   assets repo, gitignored)
//   → public/maps/<name>.png (used tiles, 32 per row) + public/maps/<name>.json (the map with one tileset, "world", and
//     its tile ids remapped)
// vendor/paid is a clone of the private Draovar/yugioh_rpg-assets repo (the deploy checks it out with a deploy key).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "../..");
const MAPS = path.join(ROOT, "data/maps");
const OUT = path.join(ROOT, "public/maps");
const COLUMNS = 32;
const FLIP_BITS = 0xe0000000;
mkdirSync(OUT, { recursive: true });

/** Tileset images by path, decoded once (the complete sheet is ~370 MB as RGBA). */
const sheets = new Map();
async function sheet(file) {
  if (!existsSync(file)) {
    throw new Error(`${file} is missing: clone the private assets repo first:\n  git clone https://github.com/Draovar/yugioh_rpg-assets.git vendor/paid`);
  }
  if (!sheets.has(file)) {
    sheets.set(file, await sharp(file, { limitInputPixels: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
  }
  return sheets.get(file);
}

/** The map's tilesets, external ones (what Tiled and the Tiled MCP server edit) read in; image = absolute path. */
function tilesets(map) {
  return map.tilesets.map((ref) => {
    const dir = ref.source ? path.dirname(path.join(MAPS, ref.source)) : MAPS;
    const set = ref.source ? { ...JSON.parse(readFileSync(path.join(MAPS, ref.source), "utf-8")), firstgid: ref.firstgid } : ref;
    if (!set.image) throw new Error(`${ref.source ?? set.name}: expected an image tileset`);
    return { ...set, image: path.join(dir, set.image) };
  }).sort((a, b) => a.firstgid - b.firstgid);
}

async function pack(name) {
  const map = JSON.parse(readFileSync(path.join(MAPS, `${name}.tmj`), "utf-8"));
  const sets = tilesets(map);
  const { tilewidth: tw, tileheight: th } = sets[0];
  if (sets.some((s) => s.tilewidth !== tw || s.tileheight !== th)) throw new Error(`${name}: tilesets of different tile sizes`);
  const setOf = (gid) => sets.findLast((s) => s.firstgid <= gid);
  const layers = map.layers.filter((l) => l.type === "tilelayer");

  // old gid → new gid, in order of first use
  const remap = new Map();
  for (const layer of layers) {
    for (const raw of layer.data) {
      const gid = (raw & ~FLIP_BITS) >>> 0;
      if (gid !== 0 && !remap.has(gid)) remap.set(gid, remap.size + 1);
    }
  }

  const rows = Math.ceil(remap.size / COLUMNS);
  const width = COLUMNS * tw, height = rows * th;
  const dst = Buffer.alloc(width * height * 4);
  for (const [oldGid, newGid] of remap) {
    const set = setOf(oldGid);
    const { data: src, info } = await sheet(set.image);
    const s = oldGid - set.firstgid, d = newGid - 1;
    const sx = (s % set.columns) * tw, sy = Math.floor(s / set.columns) * th;
    const dx = (d % COLUMNS) * tw, dy = Math.floor(d / COLUMNS) * th;
    for (let y = 0; y < th; y++) {
      const from = ((sy + y) * info.width + sx) * 4;
      src.copy(dst, ((dy + y) * width + dx) * 4, from, from + tw * 4);
    }
  }
  await sharp(dst, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path.join(OUT, `${name}.png`));

  for (const layer of layers) {
    layer.data = layer.data.map((raw) => {
      const gid = (raw & ~FLIP_BITS) >>> 0;
      return gid === 0 ? 0 : (remap.get(gid) | (raw & FLIP_BITS)) >>> 0;
    });
  }
  // Custom tile properties (collision) for the tiles we kept, plus `sheet` and `sheetId`: the tileset's name and the
  // tile's id in it, so game code can tell tiles apart by what they show (the hedge faces hedge ambushes come out of).
  const custom = new Map(sets.map((set) => [set, new Map((set.tiles ?? []).map((t) => [t.id, t]))]));
  const tiles = [...remap].map(([oldGid, newGid]) => {
    const set = setOf(oldGid);
    const t = custom.get(set).get(oldGid - set.firstgid);
    const properties = [...(t?.properties ?? []), { name: "sheet", type: "string", value: set.name },
      { name: "sheetId", type: "int", value: oldGid - set.firstgid }];
    return { ...t, id: newGid - 1, properties };
  });
  map.tilesets = [{ name: "world", firstgid: 1, image: `${name}.png`, columns: COLUMNS, tilecount: remap.size,
    imagewidth: width, imageheight: height, tilewidth: tw, tileheight: th, margin: 0, spacing: 0, tiles }];
  writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(map));
  console.log(`${name}: ${remap.size} tiles from ${sets.length} tileset(s) → public/maps/${name}.png (${width}x${height})`);
}

for (const file of readdirSync(MAPS).filter((f) => f.endsWith(".tmj"))) await pack(path.basename(file, ".tmj"));
