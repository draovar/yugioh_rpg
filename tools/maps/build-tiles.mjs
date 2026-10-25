// Packs the overworld maps' tiles. The paid tileset (LimeZu Modern Exteriors, 5632x16448) is taller than most GPUs'
// max texture size and may not go into the public repo, so each map gets only the tiles it uses:
//   data/maps/<name>.tmj + its tileset data/maps/*.tsj (Tiled, committed) + vendor/paid/<tileset image> (private assets repo, gitignored)
//   → public/maps/<name>.png (used tiles, 32 per row) + public/maps/<name>.json (the map with its tile ids remapped)
// vendor/paid is a clone of the private Draovar/yugioh_rpg-assets repo (the deploy checks it out with a deploy key).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "../..");
const MAPS = path.join(ROOT, "data/maps");
const PAID = path.join(ROOT, "vendor/paid");
const OUT = path.join(ROOT, "public/maps");
const COLUMNS = 32;
const FLIP_BITS = 0xe0000000;
mkdirSync(OUT, { recursive: true });

/** Tileset images by file name, decoded once (the full sheet is ~370 MB as RGBA). */
const sheets = new Map();
async function sheet(image) {
  const file = path.join(PAID, path.basename(image));
  if (!existsSync(file)) {
    throw new Error(`${file} is missing: clone the private assets repo first:\n  git clone https://github.com/Draovar/yugioh_rpg-assets.git vendor/paid`);
  }
  if (!sheets.has(file)) {
    sheets.set(file, await sharp(file, { limitInputPixels: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
  }
  return sheets.get(file);
}

async function pack(name) {
  const map = JSON.parse(readFileSync(path.join(MAPS, `${name}.tmj`), "utf-8"));
  if (map.tilesets.length !== 1) throw new Error(`${name}: expected one tileset`);
  // External tilesets (data/maps/*.tsj, what Tiled and the Tiled MCP server edit) are inlined: Phaser needs them embedded.
  const ref = map.tilesets[0];
  const set = ref.source ? { ...JSON.parse(readFileSync(path.join(MAPS, ref.source), "utf-8")), firstgid: ref.firstgid } : ref;
  if (!set.image) throw new Error(`${name}: expected an image tileset`);
  const { tilewidth: tw, tileheight: th } = set;
  const layers = map.layers.filter((l) => l.type === "tilelayer");

  // old gid → new gid, in order of first use
  const remap = new Map();
  for (const layer of layers) {
    for (const raw of layer.data) {
      const gid = (raw & ~FLIP_BITS) >>> 0;
      if (gid !== 0 && !remap.has(gid)) remap.set(gid, remap.size + 1);
    }
  }

  const { data: src, info } = await sheet(set.image);
  const rows = Math.ceil(remap.size / COLUMNS);
  const width = COLUMNS * tw, height = rows * th;
  const dst = Buffer.alloc(width * height * 4);
  for (const [oldGid, newGid] of remap) {
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
  // Custom tile properties (collision) for the tiles we kept.
  const tiles = (set.tiles ?? []).filter((t) => remap.has(t.id + set.firstgid)).map((t) => ({ ...t, id: remap.get(t.id + set.firstgid) - 1 }));
  const { type, version, tiledversion, ...embedded } = set;
  map.tilesets[0] = { ...embedded, firstgid: 1, image: `${name}.png`, columns: COLUMNS, tilecount: remap.size,
    imagewidth: width, imageheight: height, margin: 0, spacing: 0, tiles };
  writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(map));
  console.log(`${name}: ${remap.size} tiles → public/maps/${name}.png (${width}x${height})`);
}

for (const file of readdirSync(MAPS).filter((f) => f.endsWith(".tmj"))) await pack(path.basename(file, ".tmj"));
