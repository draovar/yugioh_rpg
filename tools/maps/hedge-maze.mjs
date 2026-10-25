// Builds the hedge maze map for Tiled from a wall layout:
//   node tools/maps/hedge-maze.mjs data/maps/maze-layout.json data/maps/maze.tmj
// Layout: { size, h, v, rooms } — h[j][i] = "1" when grid line j has a wall over cell column i, v[i][j] = "1" when
// grid line i has a wall beside cell row j (lines 0..size), rooms = open squares (flower beds go there).
// The map: the maze in the middle, a meadow on each side (start on the left by the entrance, the exit on the right)
// and thick pine forest above and below, so the only way across is through the maze.
// The hedges are drawn in 3/4 view from LimeZu Modern Exteriors' hedge ring (sheet columns 18-23, rows 426-435):
// a horizontal hedge is a 2-tile top surface over a 2-tile front face, a vertical one is a 2-tile-wide surface. Each
// tile is picked from its neighbours like a blob autotile (outer corner, edge, inner corner per quadrant). Hedges next
// to the right path after each fork use the flowered ring (14 rows lower), a subtle hint.
// Collision is the hidden "collision" layer (every tile there blocks), on top of the tileset's `collision` property:
// hedge footprints (faces, vertical hedges, and junctions under a vertical hedge, so nobody squeezes behind a hedge
// past a wall), the forests and the seals around them. The top 2 rows of a horizontal hedge stay free to walk behind.
// Forest trees overlap through two ground layers (ground2 behind, ground3 in front); only the rows next to walkable
// ground are on "walls", where they sort against the player.
// Regenerating overwrites the .tmj (edits in Tiled are lost).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [layoutPath, outPath] = process.argv.slice(2);
if (!outPath) throw new Error("usage: node tools/maps/hedge-maze.mjs <layout.json> <out.tmj>");
const layout = JSON.parse(readFileSync(layoutPath, "utf-8"));
const tileset = JSON.parse(readFileSync(path.join(path.dirname(outPath), "modern-exteriors.tsj"), "utf-8"));
const N = layout.size;
const hWall = (j, i) => layout.h[j]?.[i] === "1";
const vWall = (i, j) => layout.v[i]?.[j] === "1";

/** Sizes in tiles: hedges 2 wide, horizontal hedges 4 tall (surface + face), corridors 3. */
const WALL = 2, CELL = 3, ROW = 4;
const STEP_X = WALL + CELL, STEP_Y = ROW + CELL;
/** Meadows left and right, forest above and below. The height stays under 4096 px (phones' texture limit). */
const MEADOW = 16, FOREST_TOP = 16, FOREST_BOTTOM = 18;
const MAZE_W = N * STEP_X + WALL, MAZE_H = N * STEP_Y + ROW;
const W = 2 * MEADOW + MAZE_W, H = FOREST_TOP + MAZE_H + FOREST_BOTTOM;
const lineX = (i) => MEADOW + i * STEP_X, lineY = (j) => FOREST_TOP + j * STEP_Y;
const MAZE_BOTTOM = FOREST_TOP + MAZE_H - 1;
/** The top 2 rows of a grid line's hedges (walked behind). */
const topRow = (y) => y >= FOREST_TOP && (y - FOREST_TOP) % STEP_Y < 2;

const COLUMNS = 352;
const id = (col, row) => row * COLUMNS + col;
const collides = new Set(tileset.tiles.filter((t) => t.properties?.some((p) => p.name === "collision" && p.value)).map((t) => t.id));

/** Surface quadrants by kind: outer corner, edge along the hedge (h), edge across it (v), inner corner. */
const SURFACE = {
  TL: { outer: id(18, 426), h: id(20, 426), v: id(18, 428), inner: id(22, 432) },
  TR: { outer: id(23, 426), h: id(21, 426), v: id(23, 428), inner: id(19, 432) },
  BL: { outer: id(18, 433), h: id(20, 427), v: id(18, 429), inner: id(22, 427) },
  BR: { outer: id(23, 433), h: id(21, 427), v: id(23, 429), inner: id(19, 427) },
};
/**
 * In the top rows of a horizontal hedge (walked behind, no collision) a vertical hedge's sides use the ring's
 * non-colliding side tiles (rows 427 and 432; the tileset marks rows 428-431 as colliding).
 */
const TOP_ROWS = {
  [id(18, 428)]: id(18, 432), [id(18, 429)]: id(18, 427),
  [id(23, 428)]: id(23, 432), [id(23, 429)]: id(23, 427),
};
/** Front face rows (upper, lower): rounded ends where nothing continues sideways, else the middle. */
const FACE = {
  top: { leftEnd: id(18, 434), rightEnd: id(23, 434), left: id(20, 428), right: id(21, 428) },
  bottom: { leftEnd: id(18, 435), rightEnd: id(23, 435), left: id(20, 429), right: id(21, 429) },
};
/** The same hedge with flowers, unless that tile's collision differs from the plain one. */
const flowered = (tile) => (collides.has(tile) === collides.has(tile + 14 * COLUMNS) ? tile + 14 * COLUMNS : tile);

/** Pines (4 wide), bottom rows aligned: 3 heights, plain and with cones. */
const PINES = [324, 328, 332].flatMap((col, k) => [
  { col, top: 20 - k, base: 25 }, { col, top: 32 - k, base: 37 },
]);
const GRASS = [2128, 2129, 2130, 2131, 2480, 2481, 2482, 2483];
const GRASS_RARE = [2132, 2484];
/** Ground decorations: [column, row, width, height] in the sheet. */
const SMALL = {
  sprigs: [114, 12, 2, 2], tuft: [112, 12, 2, 2], stone: [116, 20, 1, 1], pebble: [122, 20, 1, 1],
  red: [102, 14, 2, 2], blue: [102, 16, 2, 2], yellow: [102, 18, 2, 2], patch: [30, 4, 2, 2],
};
const BEDS = [[104, 14], [108, 14], [112, 14], [104, 18], [108, 18], [112, 18]].map(([c, r]) => [c, r, 4, 3]);
/** Any tile works in the hidden collision layer; this one is a hedge, so the layer reads as walls in Tiled. */
const BLOCK = id(18, 430);

// Seeded so regenerating gives the same map.
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const pick = (list) => list[Math.floor(rand() * list.length)];

const grid = () => new Array(W * H).fill(0);
const ground = grid(), ground2 = grid(), ground3 = grid(), walls = grid(), collision = grid();
const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const put = (layer, x, y, tile) => { if (inside(x, y)) layer[y * W + x] = 1 + tile; };
const block = (x, y, w, h) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(collision, xx, yy, BLOCK); };
for (let k = 0; k < W * H; k++) ground[k] = 1 + (rand() < 0.05 ? GRASS_RARE[k % 2] : pick(GRASS));

// ---- Hedges. Wall masks at tile level: S = top surface, F = front face.
const S = new Uint8Array(W * H), F = new Uint8Array(W * H);
const at = (m, x, y) => (inside(x, y) ? m[y * W + x] : 0);
const fill = (m, x, y, w, h) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) m[yy * W + xx] = 1; };

for (let j = 0; j <= N; j++) {
  for (let i = 0; i <= N; i++) {
    const left = hWall(j, i - 1), right = hWall(j, i), up = vWall(i, j - 1), down = vWall(i, j);
    if (!(left || right || up || down)) continue;
    // A post: surface on top; its lower half continues the vertical hedge downwards, or shows the face.
    fill(S, lineX(i), lineY(j), WALL, 2);
    fill(down ? S : F, lineX(i), lineY(j) + 2, WALL, 2);
    // Under a vertical hedge the top rows block too: else the 2-tile gap behind the hedge would let you pass it.
    if (up) block(lineX(i), lineY(j), WALL, 2);
    if (right) {
      fill(S, lineX(i) + WALL, lineY(j), CELL, 2);
      fill(F, lineX(i) + WALL, lineY(j) + 2, CELL, 2);
    }
    if (down) fill(S, lineX(i), lineY(j) + ROW, WALL, CELL);
  }
}
// Footprints: everything but the top rows; the outer hedge's top rows too (they'd lead around the maze).
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((at(S, x, y) || at(F, x, y)) && !topRow(y)) block(x, y, 1, 1);
block(lineX(0), lineY(0), MAZE_W, 2);

// The right path, entrance to exit, and its forks (cells with 3+ ways).
const entrance = [...Array(N).keys()].find((j) => !vWall(0, j)) ?? 0;
const exit = [...Array(N).keys()].find((j) => !vWall(N, j)) ?? N - 1;
const ways = (i, j) => [
  [i + 1, j, !vWall(i + 1, j)], [i - 1, j, !vWall(i, j)], [i, j + 1, !hWall(j + 1, i)], [i, j - 1, !hWall(j, i)],
].filter(([a, b, open]) => open && a >= 0 && b >= 0 && a < N && b < N);
const from = new Map([[`0,${entrance}`, null]]);
for (const queue = [[0, entrance]]; queue.length;) {
  const [i, j] = queue.shift();
  for (const [a, b] of ways(i, j)) if (!from.has(`${a},${b}`)) { from.set(`${a},${b}`, [i, j]); queue.push([a, b]); }
}
const route = [];
for (let c = [N - 1, exit]; c; c = from.get(`${c[0]},${c[1]}`)) route.unshift(c);

// After each fork, one hedge beside the cell to take next gets flowers.
const FLOWER = new Uint8Array(W * H);
for (let k = 0; k + 1 < route.length; k++) {
  if (ways(...route[k]).length < 3) continue;
  const [i, j] = route[k + 1];
  const sides = [
    hWall(j + 1, i) && [lineX(i) + WALL, lineY(j + 1), CELL, ROW],
    hWall(j, i) && [lineX(i) + WALL, lineY(j), CELL, ROW],
    vWall(i + 1, j) && [lineX(i + 1), lineY(j) + ROW, WALL, CELL],
    vWall(i, j) && [lineX(i), lineY(j) + ROW, WALL, CELL],
  ].filter(Boolean);
  if (sides.length) fill(FLOWER, ...pick(sides));
}

/** Which side of a 2-wide hedge a tile is on: the edge it lies on, else alternating from the hedge's grid line. */
const sideX = (x) => ((x - MEADOW) % STEP_X) % 2 === 0 ? "L" : "R";
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let tile = 0;
    if (at(S, x, y)) {
      // Every quadrant this tile could be (a side with no hedge must be one of its edges), most telling kind first:
      // a junction tile is the inner corner facing the gap, not a plain edge.
      const solidL = at(S, x - 1, y), solidR = at(S, x + 1, y), solidU = at(S, x, y - 1), solidD = at(S, x, y + 1);
      const hSides = !solidL ? ["L"] : !solidR ? ["R"] : sideX(x) === "L" ? ["L", "R"] : ["R", "L"];
      const vSides = !solidU ? ["T"] : !solidD ? ["B"] : y % 2 === 0 ? ["T", "B"] : ["B", "T"];
      const RANK = { outer: 0, inner: 1, h: 2, v: 2, full: 3 };
      let best = null;
      for (const vs of vSides) for (const hs of hSides) {
        const dx = hs === "L" ? -1 : 1, dy = vs === "T" ? -1 : 1;
        const h = at(S, x + dx, y), v = at(S, x, y + dy), d = at(S, x + dx, y + dy);
        const kind = !h && !v ? "outer" : !v ? "h" : !h ? "v" : !d ? "inner" : "full";
        if (!best || RANK[kind] < RANK[best.kind]) best = { kind, set: SURFACE[vs + hs] };
      }
      tile = best.set[best.kind === "full" ? "h" : best.kind];
      if (topRow(y)) tile = TOP_ROWS[tile] ?? tile;
    } else if (at(F, x, y)) {
      const row = at(F, x, y - 1) ? FACE.bottom : FACE.top;
      const cont = (xx) => at(F, xx, y) || at(S, xx, y);
      tile = !cont(x - 1) ? row.leftEnd : !cont(x + 1) ? row.rightEnd : sideX(x) === "L" ? row.left : row.right;
    } else continue;
    put(walls, x, y, at(FLOWER, x, y) ? flowered(tile) : tile);
  }
}

// ---- Forests: rows of pines 5 tiles apart, every other row shifted by half a tree.
/**
 * Trees by row, top row first; a row's trees take the front layer (ground3) where they overlap the row above.
 * `sorted(k)`: row k goes on "walls" (sorted against the player), its trunk row too unless `trunksOnGround`.
 */
function forest(bases, { sorted, trunksOnGround = false, pines = () => PINES }) {
  const owner = new Map();
  bases.forEach((base, k) => {
    for (let x = -2 * (k % 2); x < W; x += 4) {
      const pine = pick(pines(k));
      for (let r = pine.top; r <= pine.base; r++) {
        for (let c = 0; c < 4; c++) {
          const tx = x + c, ty = base - (pine.base - r);
          if (!inside(tx, ty)) continue;
          const tile = id(pine.col + c, r), key = ty * W + tx;
          if (sorted(k) && !(trunksOnGround && r === pine.base)) put(walls, tx, ty, tile);
          else put(owner.has(key) ? ground3 : ground2, tx, ty, tile);
          owner.set(key, k);
        }
      }
    }
  });
}
// Above: bottom row on "walls" (seen against the maze and the meadows), the rest behind it.
const topBases = [];
for (let b = FOREST_TOP - 1; b >= 0; b -= 5) topBases.unshift(b);
forest(topBases, { sorted: (k) => k === topBases.length - 1 });
block(0, 0, W, FOREST_TOP);
// Below: the first row on "walls" (you walk behind its tops in the meadows) but its trunks on the ground, so the
// second row (the tallest pines, reaching up to those trunks) is drawn over them; it still sorts by them (collision).
const bottomBases = [MAZE_BOTTOM + 8];
for (let b = MAZE_BOTTOM + 15; b - 7 < H; b += 5) bottomBases.push(b);
const TALL = PINES.filter((p) => p.base - p.top === 7);
forest(bottomBases, { sorted: (k) => k === 0, trunksOnGround: true, pines: (k) => (k === 1 ? TALL : PINES) });
block(0, bottomBases[0], W, H - bottomBases[0]);
block(lineX(0), MAZE_BOTTOM + 1, MAZE_W, bottomBases[0] - MAZE_BOTTOM - 1);

// ---- Decorations (ground2, no collision).
const free = (x, y, w, h) => {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (!inside(xx, yy) || ground2[yy * W + xx] || walls[yy * W + xx] || collision[yy * W + xx]) return false;
  return true;
};
const stamp = ([col, row, w, h], x, y) => {
  if (!free(x, y, w, h)) return false;
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) put(ground2, x + c, y + r, id(col + c, row + r));
  return true;
};
// Rooms: two flower beds side by side in the middle.
layout.rooms?.forEach((room, n) => {
  const cx = lineX(room.x) + Math.floor((room.w * STEP_X + WALL) / 2), cy = lineY(room.y) + Math.floor((room.h * STEP_Y + ROW) / 2);
  stamp(BEDS[n * 3 % BEDS.length], cx - 5, cy - 1);
  stamp(BEDS[(n * 3 + 1) % BEDS.length], cx + 1, cy - 1);
});
// Corridors: dead ends get a flower patch now and then, other cells grass or a stone.
const small = Object.values(SMALL);
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const x = lineX(i) + WALL + Math.floor(rand() * 2), y = lineY(j) + ROW + Math.floor(rand() * 2);
    if (ways(i, j).length === 1 && rand() < 0.5) stamp(pick([SMALL.patch, SMALL.red, SMALL.blue, SMALL.yellow]), x, y);
    else if (rand() < 0.18) stamp(pick([SMALL.sprigs, SMALL.tuft, SMALL.sprigs, SMALL.stone, SMALL.pebble]), x, y);
  }
}
// Meadows: flowers, grass and a couple of beds.
for (const x0 of [0, lineX(N) + WALL]) {
  for (let n = 0; n < 60; n++) stamp(pick(small), x0 + 1 + Math.floor(rand() * (MEADOW - 3)), FOREST_TOP + Math.floor(rand() * (MAZE_H - 2)));
  for (let n = 0; n < 3; n++) stamp(pick(BEDS), x0 + 2 + Math.floor(rand() * (MEADOW - 7)), FOREST_TOP + 8 + Math.floor(rand() * (MAZE_H - 20)));
}

// The player starts in the left meadow, in front of the entrance.
const spawn = { id: 1, name: "spawn", type: "", point: true, rotation: 0, visible: true, width: 0, height: 0,
  x: (MEADOW - 4) * 16, y: (lineY(entrance) + ROW) * 16 + 8 };

const layer = (lid, name, data, extra = {}) => ({ data, height: H, id: lid, name, opacity: 1, type: "tilelayer", visible: true, width: W, x: 0, y: 0, ...extra });
const map = {
  compressionlevel: -1, height: H, infinite: false,
  layers: [layer(1, "ground", ground), layer(2, "ground2", ground2), layer(5, "ground3", ground3), layer(3, "walls", walls),
    layer(6, "collision", collision, { opacity: 0.5, visible: false }),
    { draworder: "topdown", id: 4, name: "objects", objects: [spawn], opacity: 1, type: "objectgroup", visible: true, x: 0, y: 0 }],
  nextlayerid: 7, nextobjectid: 2, orientation: "orthogonal", renderorder: "right-down", tiledversion: "1.12.2",
  tileheight: 16, tilesets: [{ firstgid: 1, source: "modern-exteriors.tsj" }], tilewidth: 16, type: "map",
  version: "1.10", width: W,
};
writeFileSync(outPath, JSON.stringify(map, null, 1) + "\n");
console.log(`${outPath}: ${W}x${H} tiles (${W * 16}x${H * 16} px), route ${route.length} cells`);
