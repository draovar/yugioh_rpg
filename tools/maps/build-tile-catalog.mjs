// Names for the theme tilesets' tiles (data/maps/tilesets/*.tsj, made by build-theme-tilesets.mjs). LimeZu ships every
// object of Modern Exteriors as a named PNG ("Singles": ME_Singles_Garden_32x32_Hedge_3.png,
// 24_Additional_Houses_Victorian_House_1_32x32.png...); each one is found in the theme sheets by matching its 16x16
// cells pixel for pixel (its own theme's sheet first), so maps can be built by name instead of by tile id.
//   node tools/maps/build-tile-catalog.mjs [singles folder]
//   (default ../../assets/Modern_Exteriors_32x32/Modern_Exteriors_Complete_Singles_32x32, the unzipped pack, not in any repo)
//   → data/maps/tile-catalog.json, one entry per line (grep it): { theme, name, file, tileset, x, y, w, h } = a w x h
//     tile rectangle at column x, row y of data/maps/tilesets/<tileset>.tsj. Singles not found as one rectangle list
//     each cell as "<tileset>:<id>" in `cells` instead (row by row, null = transparent or not found). `empty` lists the
//     cells (row by row) of a rectangle that the single leaves transparent but the sheet fills with a neighbour's art.
// The singles are 32x32-pixel art, so most objects cover an even number of 16x16 tiles.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { idsByHash, tileHashes } from "../lib/tile-hash.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SINGLES = path.resolve(process.argv[2] ?? path.join(ROOT, "../../assets/Modern_Exteriors_32x32/Modern_Exteriors_Complete_Singles_32x32"));
const TILESETS = path.join(ROOT, "data/maps/tilesets");
const OUT = path.join(ROOT, "data/maps/tile-catalog.json");
const T = 16;
if (!existsSync(SINGLES)) throw new Error(`${SINGLES} is missing: pass the pack's Modern_Exteriors_Complete_Singles_32x32 folder`);

/** "Generic_Buildings", "MIlitary_Base", "Subwayand_Train_Station_" → "genericbuilding", "militarybase", "subwayandtrainstation" */
const key = (theme) => theme.toLowerCase().replace(/[^a-z]/g, "").replace(/s$/, "");

const sheets = [];
for (const file of readdirSync(TILESETS).filter((f) => f.endsWith(".tsj")).sort()) {
  const set = JSON.parse(readFileSync(path.join(TILESETS, file), "utf-8"));
  const { hashes } = await tileHashes(path.join(TILESETS, set.image), T);
  sheets.push({ name: path.basename(file, ".tsj"), key: key(set.name), set, hashes, ids: idsByHash(hashes) });
}

/** "ME_Singles_Garden_32x32_Hedge_3" → Garden / Hedge_3; "24_Additional_Houses_Victorian_House_1_32x32" → Additional_Houses / Victorian_House_1. */
function parseName(file) {
  const base = file.replace(/\.png$/, "");
  const me = /^ME_Singles_(.+?)_V?32x32_?(.*)$/.exec(base);
  if (me) return { theme: me[1], name: me[2] };
  const rest = base.replace(/^\d+_/, "").replace(/_32x32/, "");
  const theme = sheets.map((s) => s.set.name).find((t) => key(rest).startsWith(key(t)) && rest.length > t.length) ?? rest.split("_")[0];
  return { theme, name: rest.slice(theme.length + 1) };
}

/** Where the single sits in this sheet as one rectangle (its visible cells match), or null. */
function place(single, sheet) {
  const first = single.hashes.findIndex((h) => h);
  const fx = first % single.w, fy = Math.floor(first / single.w);
  const { columns } = sheet.set, rows = sheet.hashes.length / columns;
  for (const id of sheet.ids.get(single.hashes[first]) ?? []) {
    const x = (id % columns) - fx, y = Math.floor(id / columns) - fy;
    if (x < 0 || y < 0 || x + single.w > columns || y + single.h > rows) continue;
    if (single.hashes.every((h, i) => !h || sheet.hashes[(y + Math.floor(i / single.w)) * columns + x + (i % single.w)] === h)) return { x, y };
  }
  return null;
}

const entries = [];
let rects = 0, missing = 0;
for (const file of readdirSync(SINGLES).filter((f) => f.endsWith(".png")).sort()) {
  const single = await tileHashes(path.join(SINGLES, file), T);
  if (!single.hashes.some((h) => h)) continue;
  const entry = { ...parseName(file), file };
  const order = [...sheets].sort((a, b) => Number(b.key === key(entry.theme)) - Number(a.key === key(entry.theme)));
  let found = null;
  for (const sheet of order) {
    const at = place(single, sheet);
    if (at) { found = { tileset: sheet.name, ...at }; break; }
  }
  if (found) {
    // cells the single leaves transparent where the sheet has other art (a neighbouring object): not part of it
    const { columns } = sheets.find((s) => s.name === found.tileset).set;
    const sheetHashes = sheets.find((s) => s.name === found.tileset).hashes;
    const empty = single.hashes.flatMap((h, i) => (!h && sheetHashes[(found.y + Math.floor(i / single.w)) * columns + found.x + (i % single.w)] ? [i] : []));
    entries.push({ ...entry, ...found, w: single.w, h: single.h, ...(empty.length ? { empty } : {}) });
    rects++;
    continue;
  }
  const cells = single.hashes.map((h) => {
    const sheet = h && order.find((s) => s.ids.has(h));
    return sheet ? `${sheet.name}:${sheet.ids.get(h)[0]}` : null;
  });
  if (cells.every((c, i) => !single.hashes[i] || c)) entries.push({ ...entry, w: single.w, h: single.h, cells });
  else missing++;
}

writeFileSync(OUT, `{ "singles": "${path.basename(SINGLES)}", "entries": [\n` + entries.map((e) => JSON.stringify(e)).join(",\n") + "\n] }\n");
console.log(`${entries.length} singles → ${path.relative(ROOT, OUT)} (${rects} as one rectangle, ${entries.length - rects} cell by cell; ${missing} not in the theme sheets, left out)`);
