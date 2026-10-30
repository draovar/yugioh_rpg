// The main city (data/maps/main-city.tmj), planned by hand on top of the island template: the ground comes from the
// island blockout (data/maps/island/), so its edges still meet the neighbouring maps (the dirt road from `junction` in
// the west, the meadow of `city-north`), and the plan below lays the city out on it.
//   node tools/maps/build-main-city.mjs     then npm run build-tiles
// A scaffold like hedge-maze.mjs: it OVERWRITES the .tmj (Tiled edits are lost).
//
// Districts: the suburb in the west (villas in fenced gardens, thinning out towards the wild), downtown in the middle
// (the town hall at the head of the central plaza, shops, hotel, police, post office), the rough east (back alleys, a
// worksite, a trailer park, a junkyard, the shady shop, the container port on the peninsula) and the harbour in the
// south (the beach, the promenade, the docks with boats). The avenue crosses the whole city west to east; Harbour
// Avenue runs from the plaza down to the ferry pier.
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { MAPS, MapBuilder, hash } from "../lib/map-builder.mjs";

const NAME = "main-city";
const layout = JSON.parse(readFileSync(path.join(MAPS, "island/layout.json"), "utf-8"));
const [MX, MY, W, H] = layout.maps[NAME];
const b = new MapBuilder(W, H, ["terrains-and-fences", "camping", "city-terrains", "autotiles", "city-props", "beach",
  "generic-buildings", "villas", "additional-houses", "shopping-center-and-markets", "hotel-and-hospital", "worksite",
  "post-office", "police-station", "garden", "garage-sales", "floor-modular-buildings", "vehicles", "military-base"]);

// --- tile classes ----------------------------------------------------------------------------------------------------
const WATER = 0, SAND = 1, GRASS = 2, PAVE = 3, ROAD = 4, DIRT = 5;
const cls = new Uint8Array(W * H);
{
  // the island blockout under this map: sea, land, the dirt road coming in from the west
  const { data, info } = await sharp(path.join(MAPS, "island", layout.blockout)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const legend = Object.entries(layout.legend);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = ((MY + y) * info.width + MX + x) * 3;
    let best = "sea", bd = Infinity;
    for (const [name, [r, g, bb]] of legend) {
      const d = (data[i] - r) ** 2 + (data[i + 1] - g) ** 2 + (data[i + 2] - bb) ** 2;
      if (d < bd) { bd = d; best = name; }
    }
    cls[y * W + x] = best === "sea" ? WATER : best === "road" ? DIRT : GRASS;
  }
}
const at = (x, y) => cls[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
/** Fills [x0, x1) x [y0, y1) with a class; `onlyLand` leaves water alone. */
function fill(c, x0, y0, x1, y1, onlyLand = false) {
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
    if (onlyLand && cls[y * W + x] === WATER) continue;
    cls[y * W + x] = c;
  }
}
/** Fills a polygon (tile corners) with a class. */
function poly(c, pts, onlyLand = false) {
  const ys = pts.map((p) => p[1]);
  for (let y = Math.max(0, Math.min(...ys)); y < Math.min(H, Math.max(...ys)); y++) {
    const yc = y + 0.5, xs = [];
    for (let k = 0; k < pts.length; k++) {
      const [x1, y1] = pts[k], [x2, y2] = pts[(k + 1) % pts.length];
      if ((y1 <= yc) !== (y2 <= yc)) xs.push(x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1));
    }
    xs.sort((a, b2) => a - b2);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.round(xs[k])); x < Math.min(W, Math.round(xs[k + 1])); x++) {
        if (onlyLand && cls[y * W + x] === WATER) continue;
        cls[y * W + x] = c;
      }
    }
  }
}

// --- the plan: ground ------------------------------------------------------------------------------------------------
// The coast: a sandy bay in the south-west, a straight quay along the docks, the peninsula in the south-east, and the
// east shore pushed out a little for the worksite.
poly(WATER, [[20, 158], [60, 156], [104, 152], [300, 152], [300, 280], [20, 280]]);
poly(WATER, [[0, 186], [20, 160], [20, 280], [0, 280]]);
poly(GRASS, [[222, 30], [250, 30], [276, 56], [288, 88], [292, 150], [222, 150]]);
poly(GRASS, [[212, 150], [290, 150], [290, 228], [278, 240], [226, 240], [212, 228]]);
poly(SAND, [[16, 176], [14, 160], [22, 138], [40, 128], [104, 128], [104, 152], [60, 156], [20, 158]], true);

// Paved areas (sidewalk), then the green spots inside them.
fill(PAVE, 84, 20, 214, 128, true);            // downtown
fill(PAVE, 104, 128, 214, 152, true);          // the harbour front (west of it the beach)
fill(PAVE, 214, 30, 292, 150, true);           // the east
fill(PAVE, 216, 148, 288, 228, true);          // the container port, a strip of grass along its shore
fill(GRASS, 84, 0, 214, 20);                   // north park, behind the town hall
fill(GRASS, 176, 20, 214, 34);                 // ... reaching down beside the hotel
fill(GRASS, 122, 8, 178, 66);                  // the town hall's gardens
fill(GRASS, 254, 34, 284, 74, true);           // the worksite (dirt, below)
fill(GRASS, 254, 88, 292, 118, true);          // trailer park
fill(GRASS, 256, 118, 292, 140, true);         // junkyard
fill(GRASS, 266, 186, 290, 232, true);         // the lighthouse's patch of grass
// the plaza's four lawns
for (const [x0, y0] of [[126, 90], [156, 90], [126, 106], [156, 106]]) fill(GRASS, x0, y0, x0 + 18, y0 + 10);

// Roads (asphalt; the curbs take one tile off each side: a 10-tile road shows 8 tiles of asphalt).
const roads = [];
function road(x0, y0, x1, y1, { centre = true } = {}) {
  fill(ROAD, x0, y0, x1, y1, true);
  roads.push({ x0, y0, x1, y1, centre });
}
/** A street through grass: asphalt with a sidewalk strip each side. */
function street(x0, y0, x1, y1, opts) {
  if (x1 - x0 > y1 - y0) fill(PAVE, x0, y0 - 2, x1, y1 + 2, true);
  else fill(PAVE, x0 - 2, y0, x1 + 2, y1, true);
  road(x0, y0, x1, y1, opts);
}
street(12, 78, 76, 88);                        // the avenue: suburb part (the dirt road from the junction ends here)
road(76, 78, 282, 88);                         // the avenue through downtown and the east
fill(PAVE, 276, 74, 290, 92, true);            // its turning place by the east shore
street(76, 12, 84, 126, { centre: false });    // West Street (north end: a path into the meadow)
road(214, 30, 222, 148, { centre: false });    // East Street
road(144, 126, 156, 144);                      // Harbour Avenue, plaza → ferry pier
street(14, 118, 76, 126, { centre: false });   // Market Street: suburb part
road(76, 118, 254, 126, { centre: false });    // Market Street
road(222, 140, 254, 148, { centre: false });   // Harbour Road (east)
road(248, 56, 254, 148, { centre: false });    // Rust Lane, between the east blocks
road(236, 148, 244, 226, { centre: false });   // the port road down the peninsula
street(14, 36, 76, 44, { centre: false });     // Oak Street (suburb)
street(38, 44, 46, 118, { centre: false });    // Maple Lane (suburb)

fill(DIRT, 0, 80, 14, 88);                     // the dirt road from the junction
fill(DIRT, 78, 0, 82, 14);                     // the path north into the meadow
fill(DIRT, 82, 2, 214, 6);                     // north park: a path along it, behind the town hall ...
for (const x of [116, 184]) fill(DIRT, x, 6, x + 4, 20); // ... down to the streets
fill(DIRT, 258, 38, 282, 72);                  // the worksite's dug-up ground
fill(DIRT, 260, 92, 290, 116);                 // the trailer park's yard
fill(DIRT, 262, 122, 290, 138);                // the junkyard
// villas: [x, y, name, lot (the fenced garden, x0 y0 x1 y1), where the shed / trampoline goes]; paths from their doors
// out to the sidewalk
const VILLAS = [[50, 6, "Villa_2", [48, 4, 74, 34], [68, 14]], [18, 6, "Villa_3", [4, 4, 36, 34], [8, 14]],
  [50, 48, "Villa_1", [48, 46, 74, 76], [68, 56]], [50, 88, "Villa_5", [48, 88, 74, 116], [68, 96]],
  [18, 88, "Villa_4", [4, 88, 36, 116], [8, 96]]];
for (const [x, y] of VILLAS) fill(PAVE, x + 2, y + 26, x + 8, y + 30, true);

// --- terrain layers -----------------------------------------------------------------------------------------------
const opaque = (r, g, bb, a) => a > 128;
const nearer = (f, bg) => (r, g, bb, a) => a > 128 && (r - f[0]) ** 2 + (g - f[1]) ** 2 + (bb - f[2]) ** 2 < (r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (bb - bg[2]) ** 2;
const TERRAIN = {
  grass: await b.edgeSet("terrains-and-fences", [0, 22, 10, 30], opaque),
  sand: await b.edgeSet("terrains-and-fences", [32, 120, 42, 128], opaque),
  dirt: await b.edgeSet("terrains-and-fences", [0, 12, 10, 20],
    nearer(await b.colourAt("terrains-and-fences", 8, 16), await b.colourAt("terrains-and-fences", 2, 14))),
  // sidewalk (light) on asphalt: the pack's autotile sheet, block 18 (8 tile rows a block)
  sidewalk: await b.edgeSet("autotiles", [0, 144, 24, 152],
    nearer(await b.colourAt("autotiles", 9, 146), await b.colourAt("autotiles", 0, 150, 1, 1)), { scored: true }),
  greySidewalk: await b.edgeSet("autotiles", [0, 176, 24, 184],
    nearer(await b.colourAt("autotiles", 9, 178), await b.colourAt("autotiles", 0, 182, 1, 1)), { scored: true }),
};
const FENCE = await b.blobSet("autotiles", 16 * 8);
const WATER_PIECE = b.piece("terrains-and-fences", 24, 16);
const ASPHALT = b.piece("city-terrains", 0, 10);

const VW = b.VW;
const count = (x, y, set) => [at(x - 1, y - 1), at(x, y - 1), at(x - 1, y), at(x, y)].filter((c) => set.includes(c)).length;
const sandCore = b.tidy(b.vertexMask((x, y) => count(x, y, [SAND]) >= 2));
const grass = b.tidy(b.vertexMask((x, y) => count(x, y, [GRASS, DIRT]) >= 2));
// sand reaches one vertex under the grass next to it, so grass edges lie on sand, not on water
const sand = sandCore.map((v, k) => {
  if (v || !grass[k]) return v;
  const i = k % VW, j = (k - i) / VW;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (b.vAt(sandCore, i + di, j + dj)) return 1;
  return 0;
});
const roadV = b.vertexMask((x, y) => count(x, y, [ROAD]) >= 3);
const sidewalk = roadV.map((v) => 1 - v);
const dirt = b.tidy(b.vertexMask((x, y) => count(x, y, [DIRT]) >= 2).map((v, k) => v & grass[k]), true);
const cellHas = (cx, cy, set) => [at(2 * cx, 2 * cy), at(2 * cx + 1, 2 * cy), at(2 * cx, 2 * cy + 1), at(2 * cx + 1, 2 * cy + 1)].some((c) => set.includes(c));

for (let cy = 0; cy < H / 2; cy++) for (let cx = 0; cx < W / 2; cx++) b.put2("ground", cx, cy, WATER_PIECE);
// the east gets the set's grey sidewalk (block 22), the rest the light one
const east = (cx) => 2 * cx >= 212;
b.paint("ground2", sidewalk, TERRAIN.sidewalk, 4, { where: (cx, cy) => !east(cx) && cellHas(cx, cy, [PAVE, ROAD]), background: ASPHALT, variants: 0.08 });
b.paint("ground2", sidewalk, TERRAIN.greySidewalk, 4, { where: (cx, cy) => east(cx) && cellHas(cx, cy, [PAVE, ROAD]), background: ASPHALT, variants: 0.08 });
b.paint("ground3", sand, TERRAIN.sand, 1);
b.paint("ground4", grass, TERRAIN.grass, 2);
b.paint("ground5", dirt, TERRAIN.dirt, 3);

// Lane markings: a dashed centre line down the middle of the wider roads.
const LINE_H = b.piece("autotiles", 4, 24 * 8 + 6), LINE_V = b.piece("autotiles", 0, 24 * 8 + 2);
const roadCell = (cx, cy) => b.vAt(roadV, cx, cy) && b.vAt(roadV, cx + 1, cy) && b.vAt(roadV, cx, cy + 1) && b.vAt(roadV, cx + 1, cy + 1);
for (const r of roads.filter((r) => r.centre)) {
  if (r.x1 - r.x0 > r.y1 - r.y0) {
    const cy = (r.y0 + r.y1) / 4 - 0.5;
    if (Number.isInteger(cy)) for (let cx = r.x0 / 2; cx < r.x1 / 2; cx++) if (roadCell(cx, cy) && roadCell(cx, cy - 1) && roadCell(cx, cy + 1)) b.put2("ground6", cx, cy, LINE_H);
  } else {
    const cx = (r.x0 + r.x1) / 4 - 0.5;
    if (Number.isInteger(cx)) for (let cy = r.y0 / 2; cy < r.y1 / 2; cy++) if (roadCell(cx, cy) && roadCell(cx - 1, cy) && roadCell(cx + 1, cy)) b.put2("ground6", cx, cy, LINE_V);
  }
}

// Collision: water (a tile takes its nearest cell corner) where no ground covers it.
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (x + 1) >> 1, j = (y + 1) >> 1;
  const land = b.vAt(grass, i, j) || b.vAt(sand, i, j) || at(x, y) === PAVE || at(x, y) === ROAD;
  if (!land) b.collision[y * W + x] = 1;
}

// --- piers (camping sheet: vertical planks; the last 6 rows end in the deck's edge over the water) --------------------
async function pier(x, y0, y1, w = 8) {
  for (let x2 = x; x2 < x + w; x2 += 8) {
    for (let y = y0; y < y1 - 6; y += 2) await b.blit("ground5", "camping", 6, 22, 8, 2, x2, y);
    await b.blit("ground5", "camping", 6, 24, 8, 6, x2, y1 - 6);
  }
  // mooring posts at the end, standing in the water
  await b.stamp("Pier_Pole_1", x - 2, y1 - 6, { layers: ["walls"], block: "base" });
  await b.stamp("Pier_Pole_2", x + w, y1 - 6, { layers: ["walls"], block: "base" });
  for (let y = y0; y < y1 - 2; y++) for (let x2 = x; x2 < x + w; x2++) b.collision[y * W + x2] = 0;
}
// a boardwalk along the quay, its edge over the water
for (let x = 104; x < 212; x += 8) {
  await b.blit("ground5", "camping", 6, 22, 8, 2, x, 146);
  await b.blit("ground5", "camping", 6, 22, 8, 2, x, 148);
  await b.blit("ground5", "camping", 6, 28, 8, 2, x, 150);
}
for (let x = 104; x < 212; x++) b.collision[151 * W + x] = 1;
await pier(110, 150, 166);
await pier(142, 150, 174, 16);   // the ferry pier, at the foot of Harbour Avenue
await pier(186, 150, 166);

// --- objects ---------------------------------------------------------------------------------------------------------
const put = (name, x, y, opts = {}) => b.stamp(name, x, y, { force: true, ...opts });
/** By the bottom edge (buildings stand on a sidewalk line). */
const putB = async (name, x, bottom, opts) => put(name, x, bottom - (await b.object(name)).h, opts);
/** Props placed by hand that found no free layer there (reported at the end). */
const missed = [];
const placed = async (name, x, y, opts) => (await b.stamp(name, x, y, opts)) || (missed.push(`${name}@${x},${y}`), false);
const prop = (name, x, y, opts = {}) => placed(name, x, y, { block: "base", ...opts });
const flat = (name, x, y) => placed(name, x, y, { layers: ["ground6", "ground7"], block: "none" });
const tree = (name, x, y) => placed(name, x, y, { block: "trunk" });
const isCls = (...cs) => (x, y) => cs.includes(at(x, y)) && !b.collision[y * W + x];
/** Trees (or any props) on a jittered grid, where they fit on free ground of the given classes. */
async function scatter(names, [x0, y0, x1, y1], step, chance, salt, ok, block = "trunk") {
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
    if (hash(x, y, salt) > chance) continue;
    const name = names[Math.floor(hash(x, y, salt + 1) * names.length)];
    const jx = x + Math.floor(hash(x, y, salt + 2) * 3) - 1, jy = y + Math.floor(hash(x, y, salt + 3) * 3) - 1;
    const o = await b.object(name);
    if (jx + o.w > x1 || jy + o.h > y1) continue;
    if (await b.fits(name, jx, jy, ok, ["walls", "walls2", "walls3"])) await b.stamp(name, jx, jy, { block });
  }
}
/** A prop only where it fits on free ground of the given classes (nothing on any walls layer under it). */
async function propIfFree(name, x, y, ok, opts = {}) {
  if (await b.fits(name, x, y, ok, ["walls", "walls2", "walls3"])) return b.stamp(name, x, y, { block: "base", ...opts });
  return false;
}
/** Lamps (every `step` tiles) and trees between them along both sidewalks of a road. */
async function lineRoad(r, { lamp = "Street_Lamp_2", step = 16, trees = null, offset = 0 } = {}) {
  const horizontal = r.x1 - r.x0 > r.y1 - r.y0;
  const o = await b.object(lamp);
  for (let t = (horizontal ? r.x0 : r.y0) + 4 + offset; t < (horizontal ? r.x1 : r.y1) - 4; t += step) {
    // horizontal: north sidewalk (base on the row above the road) and south (the curb row below, reaching up over it)
    const spots = horizontal ? [[t, r.y0 - o.h], [t, r.y1 + 1 - o.h]] : [[r.x0 - o.w, t], [r.x1, t]];
    for (const [x, y] of spots) {
      const base = (xx, yy) => yy !== y + o.h - 1 || at(xx, yy) === PAVE;
      await propIfFree(lamp, x, y, (xx, yy) => base(xx, yy) && !b.collision[yy * W + xx]);
    }
    if (trees && horizontal) {
      const tn = trees[Math.floor(hash(t, r.y0, 70) * trees.length)], to = await b.object(tn);
      for (const y of [r.y0 - to.h, r.y1 + 1 - to.h]) {
        await propIfFree(tn, t + step / 2 - to.w / 2, y, (xx, yy) => yy !== y + to.h - 1 || at(xx, yy) === PAVE, { block: "trunk" });
      }
    }
  }
}
/** A zebra crossing over a road at column (horizontal road) or row (vertical road) `pos`, 4 tiles wide. */
async function crossing(r, pos) {
  if (r.x1 - r.x0 > r.y1 - r.y0) for (let y = r.y0 + 1; y < r.y1 - 1; y += 4) await b.blit("ground7", "city-terrains", 14, 8, 4, Math.min(4, r.y1 - 1 - y), pos, y);
  else for (let x = r.x0 + 1; x < r.x1 - 1; x += 4) await b.blit("ground7", "city-terrains", 14, 12, Math.min(4, r.x1 - 1 - x), 4, x, pos);
}
/** A modular shop building: roof, floors (8 rows each), a ground floor whose shopfront is its lowest 6 rows. */
async function tower(x, bottom, roof, floors, ground) {
  let top = bottom - 6;
  for (const f of floors) { top -= 8; await put(f, x, top); }
  await put(roof, x, top - (await b.object(roof)).h);
  await putB(ground, x, bottom, { layers: ["walls", "walls2"] }); // its sign reaches up over the floor above
}
const TREES = ["Camping/Tree_1", "Camping/Tree_10", "Camping/Tree_13", "Camping/Tree_121", "Camping/Tree_124", "Camping/Tree_127"];
const BIG_TREES = ["Camping/Tree_157", "Camping/Tree_160", "Camping/Tree_163", "Camping/Tree_166"];
const CITY_TREES = ["City_Props/Tree_11", "City_Props/Tree_12", "City_Props/Tree_2", "City_Props/Tree_3"];

// Downtown, north of the avenue: two shop towers, the town hall, the hotel.
await tower(88, 76, "Roof_1", ["Middle_Floor_1", "Middle_Floor_2", "Middle_Floor_1"], "Ground_Floor_Bakery_1");
await tower(104, 76, "Roof_7", ["Middle_Floor_3", "Middle_Floor_4", "Middle_Floor_3", "Middle_Floor_4"], "Ground_Floor_Gym_1");
await putB("Garden/Palace_Example_2", 125, 78);
await put("Hotel_Modular_3", 177, 36);
await put("Hotel_Modular_2", 177, 50);
await put("Hotel_Modular_1", 177, 58);
await put("Hotel_Signboard_1", 185, 36, { layers: ["walls2"], block: "none" });

// The central plaza: lawns with trees, the fountain in the middle, benches, lamps.
await put("Garden/Fountain_3_1", 146, 97);
for (const [x, y, n] of [[127, 90, "City_Props/Tree_11"], [137, 92, "City_Props/Tree_12"], [165, 90, "City_Props/Tree_11"],
  [157, 92, "City_Props/Tree_12"], [127, 106, "City_Props/Tree_12"], [137, 107, "City_Props/Tree_11"], [165, 106, "City_Props/Tree_12"],
  [157, 107, "City_Props/Tree_11"]]) await tree(n, x, y);
for (const [x, y] of [[132, 99], [160, 99], [132, 114], [160, 114], [140, 99], [152, 114]]) await flat(x % 8 ? "Flower_Bush_3" : "Flower_Bush_1", x, y);
for (const [x, y] of [[144, 88], [154, 88], [144, 110], [154, 110]]) await prop("Street_Lamp_5", x, y);
await prop("Bench_1", 140, 103); await prop("Bench_1", 156, 103);
for (const [x, y] of [[122, 98], [176, 98]]) await prop("Trashbin_1", x, y);
await prop("Bus_Stop_Sign_1", 120, 70);
await prop("Phone_Booth_1", 178, 66);

// Downtown, between the avenue and Market Street: the mall, police, post office.
await putB("Mall_1", 87, 116);
await putB("Police_Station_Small_1", 178, 116);
await putB("Post_Office/Building_1", 196, 116);

// The harbour front: a bait shop, the coffee kiosk, the ticket booth, the ship bar, fish stalls; the promenade.
await putB("Roof_2", 106, 140);
await putB("Ground_Floor_Bait_Shop_1", 106, 146, { layers: ["walls", "walls2"] });
await putB("Kiosk_Coffee_Cup", 124, 146);
await putB("Kiosk_Infopoint_1", 160, 146);
await putB("Ship_Bar", 174, 146);
for (let k = 0; k < 4; k++) await prop(`Fish_Crate_${k + 1}`, 192 + (k % 2) * 6, 136 + Math.floor(k / 2) * 5);
for (let x = 92; x < 210; x += 16) if (x < 140 || x > 160) await prop("Street_Lamp_5", x, 142);
for (const x of [100, 132, 170, 204]) await prop("Life_Buoy_1", x, 147);

// Boats along the piers.
await flat("Boat_2_Left_1", 158, 160);
await flat("Boat_2_Right_1", 130, 158);
await flat("Boat_1_Left_1", 120, 156);
await flat("Boat_3_Right_1", 196, 154);
await flat("Boat_1_Up_1", 104, 156);

// The beach: palms along the back, umbrellas and towels, the beach bar, volleyball, rocks by the water.
for (const [x, y] of [[20, 132], [34, 128], [50, 128], [66, 128], [82, 128]]) await tree(x % 32 ? "Palm_Tree" : "Swimming_Pool/Palm_1", x, y);
const UMBRELLAS = ["Blue_Beach_Umbrella_Opened", "Green_Beach_Umbrella_Opened", "Yellow_Beach_Umbrella_Opened", "Lightblue_Beach_Umbrella_Opened"];
const TOWELS = ["Blue_Beach_Towel_1", "Green_Beach_Towel_1", "Yellow_Beach_Towel_1", "Multicolor_Beach_Towel_1", "Purple_Beach_Towel_1"];
for (const [k, [x, y]] of [[28, 142], [44, 144], [70, 142], [86, 140]].entries()) {
  await prop(UMBRELLAS[k % UMBRELLAS.length], x, y);
  await flat(TOWELS[k % TOWELS.length], x + 6, y + 4);
}
await put("Bamboo_Bar_Counter_1_Sand", 94, 130, { block: "base", baseRows: 3 });
await flat("Bamboo_Bar_Chiar_1_Sand", 92, 138); await flat("Bamboo_Bar_Chiar_2_Sand", 100, 138);
await prop("Beach_Volley_Net_Left", 54, 138); await prop("Beach_Volley_Net_Middle_Modular", 58, 138); await prop("Beach_Volley_Net_Right", 60, 138);
await flat("Sand_Castle_1_Vers_2", 36, 142); await flat("Red_Float", 78, 152); await flat("Example_Bucket_With_Shovel", 42, 144);
for (const [x, y, n] of [[56, 146, "Seagull_Front"], [92, 146, "Seagull_Left"], [70, 134, "Blue_Beach_Towel_2"], [48, 134, "Purple_Beach_Towel_2"]]) await flat(n, x, y);
await prop("Yellow_Beach_Umbrella_Opened", 60, 128);
for (const [x, y, n] of [[22, 152, "Big_Sea_Rock_Vers_1"], [16, 144, "Medium_Sea_Rock_1_Vers_1"]]) await prop(n, x, y, { baseRows: 2 });
await scatter(["Blue_Big_Starfish", "Brown_Shell_1_Vers_1", "Pink_Shell_2_Vers_1", "Gold_Shell_2_Vers_1", "White_Shell_3"],
  [18, 134, 104, 156], 4, 0.12, 40, isCls(SAND), "none");
await prop("Beach_Sign", 98, 120 + 2);

// The east: back-alley flats, a worksite on the shore, the hardware store, a trailer park, the junkyard with the shady
// shop at its gate, the container port and the lighthouse.
await putB("Condo_9", 224, 76);
await putB("Condo_8", 237, 76);
await putB("Condo_9_Example", 224, 50);
for (const [x, y, n] of [[238, 40, "Dumpster_3"], [242, 34, "Small_Trash_Pile_1"], [232, 30, "Hanging_Clothes_3"], [244, 66, "Dumpster_1"]]) await prop(n, x, y);
await flat("Graffiti_7", 236, 52);
// the worksite: a tower going up behind a fence
await putB("Building_Skeleton_2", 262, 70);
for (let x = 256; x < 282; x += 2) { await prop("Worksite/Fence_1_1", x, 36, { block: "all" }); await prop("Worksite/Fence_1_1", x, 72, { block: "all" }); }
await put("Excavator_2", 276, 54, { block: "base", baseRows: 4 });
await put("Excavator_1", 256, 44, { block: "base", baseRows: 4 });
await prop("Light_Tower_1", 276, 40);
for (const [x, y] of [[256, 60], [260, 60]]) await prop("Stacked_Material_1", x, y, { baseRows: 2 });
await prop("Portable_Toilet_1", 278, 64, { baseRows: 3 });
for (const x of [266, 270, 274]) await prop("Cone_1", x, 76);
// row 1: the hardware store, the trailer park
await putB("Hardware_Store", 224, 116);
await prop("Dumpster_3", 242, 100); await prop("Car_Up_2", 241, 108, { baseRows: 2 });
await prop("Dumpster_1", 242, 110);
for (const [x, y, n] of [[258, 90, "Mobile_House_Medium_1"], [278, 90, "Mobile_House_Small_1"], [258, 104, "Mobile_House_Small_1"], [274, 104, "Mobile_House_Medium_1"]]) await put(n, x, y);
await prop("Hanging_Clothes_1", 272, 92);
// row 2: the shady shop in the alley off Market Street, the junkyard
await putB("Junk_Shack_1", 228, 140);
for (const [x, y, n] of [[224, 132, "Graffiti_6"], [242, 128, "Graffiti_9"]]) await flat(n, x, y);
for (const [x, y, n] of [[240, 132, "Small_Trash_Pile_2"], [222, 128, "Dumpster_3"], [244, 136, "Danger_Sign_2"]]) await prop(n, x, y);
await putB("Post_Apocalyptic_House_1", 258, 140 - 2);
for (const [x, y, n] of [[284, 124, "Car_Wreck_1"], [282, 132, "Car_Wreck_4"], [258, 140, "Scrap_Metal_Pile_1"]]) await prop(n, x, y, { baseRows: 2 });
// the port: containers stacked by the quay, warehouses, the power house, a water tower; the lighthouse at the tip
await putB("Hangar", 250, 184);
await putB("Hangar", 250, 212);
for (let k = 0; k < 12; k++) await put(`Container_${(k % 4) + 1}`, 218 + (k % 2) * 9, 156 + Math.floor(k / 2) * 7, { block: "base", baseRows: 4 });
await putB("Power_House_1", 220, 226);
await put("Water_Tower_2", 274, 156, { block: "base", baseRows: 3 });
await put("Stacked_Barrels_1", 248, 156, { block: "base", baseRows: 3 });
await put("Stacked_Barrels_1", 256, 156, { block: "base", baseRows: 3 });
await put("Truck_Left_Side", 246, 214, { block: "base", baseRows: 4 });
await putB("Container_House_1", 226, 210);                   // the harbour master's office
for (let k = 0; k < 6; k++) await put(`Container_${(k % 2) + 5}`, 272 + (k % 3) * 6 - 2, 172 + Math.floor(k / 3) * 9, { block: "base", baseRows: 4 });
for (const [x, y, n] of [[246, 160, "Pier_Crates_4"], [246, 166, "Pier_Crates_5"], [264, 190, "Pier_Barrel_3"], [264, 216, "Pier_Barrel_4"],
  [226, 198, "Pier_Crates_5"], [230, 176, "Fish_Crate_5"]]) await prop(n, x, y, { baseRows: 2 });
for (const x of [246, 250, 254]) await prop("Cone_1", x, 172);
await putB("Example_Lighthouse", 276, 230, { block: "base", baseRows: 6 });

// The suburb: villas in fenced gardens facing the streets, a house by Maple Lane, trees thinning into the wild.
const GARDEN = ["Brown_Wood_Storage", "Villa_Yard_Toy_Trampoline_1", "Brown_Wood_Storage", "Villa_Yard_Toy_Trampoline_2", "Red_Brown_Wood_Storage"];
for (const [k, [x, y, n, [lx0, ly0, lx1, ly1], [gx, gy]]] of VILLAS.entries()) {
  await put(n, x, y);
  // the garden: an iron fence round the lawn of the lot; the path to the street (sidewalk) is its gate
  b.paintBlob("walls3", (cx, cy) => 2 * cx >= lx0 && 2 * cx < lx1 && 2 * cy >= ly0 && 2 * cy < ly1
    && [at(2 * cx, 2 * cy), at(2 * cx + 1, 2 * cy), at(2 * cx, 2 * cy + 1), at(2 * cx + 1, 2 * cy + 1)].every((c) => c === GRASS), FENCE);
  await prop(GARDEN[k], gx, gy, { baseRows: 2 });
  await tree(TREES[k % TREES.length], gx < x ? gx : gx - 2, gy + 10);
  await flat("Flower_Bush_3", x + 10, y + 26);
  await flat("Flower_Bush_1", x + 14, y + 26);
}
await putB("Additional_Houses/Terraced_House_1", 12, 76);
await flat("Flower_Bush_1", 30, 74);
await scatter(TREES, [0, 0, 14, 186], 5, 0.45, 50, isCls(GRASS));
await scatter([...TREES, ...BIG_TREES], [0, 0, 76, 140], 6, 0.3, 51, isCls(GRASS));

// Parks: the north park behind the town hall, the town hall's gardens.
for (const [k, [x, y]] of [[86, 8], [96, 10], [106, 8], [122, 8], [176, 8], [192, 10], [202, 8], [178, 22], [190, 24], [200, 22],
  [208, 12]].entries()) await tree(TREES[k % TREES.length], x, y);
await scatter([...BIG_TREES, ...TREES], [214, 0, 260, 30], 7, 0.6, 63, isCls(GRASS));
for (const x of [110, 130, 166, 196]) await prop("Bench_1", x, 6);
await scatter(CITY_TREES, [122, 8, 178, 66], 6, 0.35, 61, isCls(GRASS));

// Streets: zebra crossings at the busy corners, lamps along every road, trees along Market Street's harbour side.
const [, avenue, westSt, eastSt, harbourAve, , market] = roads;
await crossing(avenue, 148);            // town hall stairs ↔ plaza
await crossing(avenue, 70); await crossing(avenue, 88); await crossing(avenue, 206); await crossing(avenue, 224);
await crossing(market, 132); await crossing(market, 166);
await crossing(westSt, 72); await crossing(eastSt, 90);
for (const r of roads) {
  await lineRoad(r, { lamp: r.x0 >= 214 ? "Street_Lamp_1" : "Street_Lamp_2", trees: r === market ? CITY_TREES : null, offset: r === harbourAve ? -2 : 0 });
}
// a viewpoint where the avenue ends at the east shore
await prop("Bench_1", 280, 76); await prop("Bench_1", 284, 80); await prop("Street_Lamp_5", 288, 74);
// graffiti on the east's walls
for (const [x, y, n] of [[226, 66, "Graffiti_5"], [238, 70, "Graffiti_8"], [226, 108, "Graffiti_2"], [260, 128, "Graffiti_11"]]) {
  await b.stamp(n, x, y, { layers: ["walls2", "walls3"], block: "none" });
}
// potholes and litter on the east's streets
await scatter(["Holes_1", "Holes_3", "Manhole_1", "Single_Trash_1", "Paper_Trash", "Milk_Trash_1", "Single_Trash_3"],
  [214, 30, 292, 150], 6, 0.18, 80, isCls(PAVE, ROAD), "none");

// Fences block where their bars are.
const fenceGids = new Set([...FENCE.values()].flat());
const walls3 = b.layer("walls3");
for (let k = 0; k < W * H; k++) if (fenceGids.has(walls3[k]) && (await b.opacity(walls3[k])).solid > 0.08) b.collision[k] = 1;

// Every land tile needs ground under it (a sliver between two masks would show the sea).
{
  const holes = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (at(x, y) === WATER || b.collision[y * W + x]) continue;
    if (!["ground2", "ground3", "ground4", "ground5"].some((l) => b.layer(l)[y * W + x])) holes.push(`${x},${y}`);
  }
  if (holes.length) console.log(`${holes.length} walkable tiles without ground: ${holes.slice(0, 12).join(" ")}`);
}

// --- objects layer + write -----------------------------------------------------------------------------------------
const objects = [];
objects.push({ name: "spawn", x: 150 * 16, y: 112 * 16, width: 0, height: 0, point: true });
// the districts, labelled for editing in Tiled (the game ignores "area" objects)
for (const [note, x0, y0, x1, y1] of [["Suburb", 0, 0, 76, 128], ["Downtown", 76, 0, 214, 128], ["East side", 214, 0, 292, 150],
  ["Beach", 0, 128, 104, 186], ["Harbour", 104, 126, 214, 176], ["Container port", 212, 150, 292, 240]]) {
  objects.push({ name: "area", x: x0 * 16, y: y0 * 16, width: (x1 - x0) * 16, height: (y1 - y0) * 16,
    properties: [{ name: "note", type: "string", value: note }] });
}
b.write(path.join(MAPS, `${NAME}.tmj`), ["ground", "ground2", "ground3", "ground4", "ground5", "ground6", "ground7", "walls", "walls2", "walls3"],
  objects, WATER_PIECE[0]);
console.log(`${NAME}: ${W}x${H}, ${b.objects.length} objects`);
if (missed.length) console.log(`not placed (no free layer): ${missed.join(" ")}`);
