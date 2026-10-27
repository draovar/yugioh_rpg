// Tilesets for new maps: LimeZu's Modern Exteriors theme sheets (ME_Theme_Sorter_32x32: Terrains_and_Fences, Garden,
// Villas...), one Tiled tileset each, small enough to browse in Tiled. The town and the maze keep the complete sheet
// (modern-exteriors.tsj): the theme sheets lack some of its tiles (its plain grass among them).
//   node tools/maps/build-theme-tilesets.mjs [theme sorter folder] [--force]
//   (default ../../assets/Modern_Exteriors_32x32/ME_Theme_Sorter_32x32, the unzipped pack, not in any repo)
//   → vendor/paid/themes/<sheet>.png (copied; commit them to the private assets repo) + data/maps/tilesets/<theme>.tsj
// A .tsj that exists is kept (Tiled edits: collision, wang sets...) unless --force. New ones get `collision` on every
// tile whose art has it in modern-exteriors.tsj.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tileHashes } from "../lib/tile-hash.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const force = args.includes("--force");
const SOURCE = path.resolve(args.find((a) => !a.startsWith("--")) ?? path.join(ROOT, "../../assets/Modern_Exteriors_32x32/ME_Theme_Sorter_32x32"));
const IMAGES = path.join(ROOT, "vendor/paid/themes");
const TILESETS = path.join(ROOT, "data/maps/tilesets");
const T = 16;
if (!existsSync(SOURCE)) throw new Error(`${SOURCE} is missing: pass the pack's ME_Theme_Sorter_32x32 folder`);
mkdirSync(IMAGES, { recursive: true });
mkdirSync(TILESETS, { recursive: true });

// Collision art from the complete sheet's tileset.
const complete = JSON.parse(readFileSync(path.join(ROOT, "data/maps/modern-exteriors.tsj"), "utf-8"));
const completeHashes = (await tileHashes(path.join(ROOT, "data/maps", complete.image), T)).hashes;
const solid = new Set((complete.tiles ?? [])
  .filter((t) => t.properties?.some((p) => p.name === "collision" && p.value))
  .map((t) => completeHashes[t.id]).filter(Boolean));

for (const file of readdirSync(SOURCE).filter((f) => /^\d+_.*_32x32\.png$/.test(f))) {
  const theme = file.replace(/^\d+_/, "").replace(/_32x32\.png$/, "").replace("MIlitary", "Military");
  const tsj = path.join(TILESETS, `${theme.toLowerCase().replaceAll("_", "-")}.tsj`);
  copyFileSync(path.join(SOURCE, file), path.join(IMAGES, file));
  if (existsSync(tsj) && !force) {
    console.log(`${path.relative(ROOT, tsj)} kept`);
    continue;
  }
  const sheet = await tileHashes(path.join(IMAGES, file), T);
  const tiles = [];
  sheet.hashes.forEach((hash, id) => {
    if (solid.has(hash)) tiles.push({ id, properties: [{ name: "collision", type: "bool", value: true }] });
  });
  const set = {
    columns: sheet.w, image: path.relative(TILESETS, path.join(IMAGES, file)).replaceAll("\\", "/"),
    imageheight: sheet.height, imagewidth: sheet.width, margin: 0, name: theme, spacing: 0, tilecount: sheet.w * sheet.h,
    tiledversion: "1.12.2", tileheight: T, tiles, tilewidth: T, type: "tileset", version: "1.10",
  };
  writeFileSync(tsj, JSON.stringify(set, null, 1) + "\n");
  console.log(`${path.relative(ROOT, tsj)}: ${set.tilecount} tiles, ${tiles.length} with collision`);
}
