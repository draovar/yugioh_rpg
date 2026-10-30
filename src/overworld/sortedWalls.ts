import Phaser from "phaser";

/** Everything y-sorted lives in depth 2..3: lower on screen = drawn later. */
export function depthForY(y: number) {
  return 2 + y / 100000;
}

/** The largest side of one baked texture: phones may not hold textures over 4096 px (a big map takes several). */
const CHUNK = 2048;

/**
 * Baked pieces are shown only in the cells (squares of CELL px) the camera's view reaches, plus this margin (px): the
 * camera's view is last frame's.
 */
const CELL = 256, VIEW_MARGIN = 64;

/** A piece of baked map art: a frame of a baked texture (none = all of it), shown at (x, y) in the world, w x h px. */
interface Piece { key: string; frame?: string; x: number; y: number; w: number; h: number; depth: number }

/**
 * The current map's baked art. Its textures stay in the texture manager when the scene shuts down, so back from a
 * duel (or the deck editor, the lobby) the map shows again without baking. Only one map is kept: baking another
 * frees it.
 */
let baked: { map: string; keys: string[]; pieces: Piece[] } | null = null;
/** Numbers each bake's texture keys, so a new bake never meets an old key. */
let bakes = 0;
let watchingContext = false;

/** Whether the map's art is still baked: `showMap` then needs no ground layers. */
export function isBaked(textures: Phaser.Textures.TextureManager, name: string) {
  return baked?.map === name && baked.keys.every((k) => textures.exists(k));
}

/** Frees the kept map's textures (the next `showMap` bakes again). */
function forget(textures: Phaser.Textures.TextureManager) {
  for (const key of baked?.keys ?? []) textures.remove(key);
  baked = null;
}

/**
 * Shows the map: its ground layers (every `ground*` layer, under everything) and its walls layers' tiles in y-sorted
 * strips (see `wallPieces`), baked into textures the first time (a tilemap layer re-culls and re-submits every visible
 * tile each frame, which kept phones busy and hot while nothing moved). The walls layers themselves stay for collision.
 * While `isBaked`, the map needs no ground layers.
 */
export function showMap(scene: Phaser.Scene, name: string, map: Phaser.Tilemaps.Tilemap, tileset: Phaser.Tilemaps.Tileset,
  walls: Phaser.Tilemaps.TilemapLayer[], blockers: Phaser.Tilemaps.TilemapLayer | null) {
  const textures = scene.textures;
  if (!baked || !isBaked(textures, name)) {
    forget(textures);
    const prefix = `baked-${++bakes}`;
    const grounds = map.layers.filter((l) => l.name.startsWith("ground")).map((l) => map.createLayer(l.name, tileset, 0, 0)!);
    const pieces = [...groundPieces(textures, prefix, grounds), ...wallPieces(textures, prefix, map, tileset, walls, blockers)];
    baked = { map: name, keys: [...new Set(pieces.map((p) => p.key))], pieces };
  }
  if (!watchingContext) {
    // A lost WebGL context comes back with blank textures: bake again on the next visit.
    scene.game.renderer.on(Phaser.Renderer.Events.RESTORE_WEBGL, () => forget(textures));
    watchingContext = true;
  }
  showNearCamera(scene, baked.pieces);
}

/**
 * Puts baked pieces on the display list only while they're near the camera (in a cell its view reaches), as Images
 * made the first time. A forest has thousands of pieces: even hidden, the scene sorted them all by depth every frame
 * the player moved (~1 ms for 8,500). The cells in view change only every CELL px of walking.
 */
function showNearCamera(scene: Phaser.Scene, pieces: Piece[]) {
  const key = (cx: number, cy: number) => cy * 65536 + cx;
  const cells = new Map<number, number[]>();
  pieces.forEach((p, i) => {
    for (let cy = Math.floor(p.y / CELL); cy <= Math.floor((p.y + p.h - 1) / CELL); cy++) {
      for (let cx = Math.floor(p.x / CELL); cx <= Math.floor((p.x + p.w - 1) / CELL); cx++) {
        const list = cells.get(key(cx, cy));
        if (list) list.push(i);
        else cells.set(key(cx, cy), [i]);
      }
    }
  });
  const images = new Map<number, Phaser.GameObjects.Image>();
  let shown = new Set<number>(), range = "";
  const update = () => {
    const v = scene.cameras.main.worldView;
    const x0 = Math.max(0, Math.floor((v.x - VIEW_MARGIN) / CELL)), x1 = Math.floor((v.right + VIEW_MARGIN) / CELL);
    const y0 = Math.max(0, Math.floor((v.y - VIEW_MARGIN) / CELL)), y1 = Math.floor((v.bottom + VIEW_MARGIN) / CELL);
    if (`${x0},${y0},${x1},${y1}` === range) return;
    range = `${x0},${y0},${x1},${y1}`;
    const next = new Set<number>();
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) for (const i of cells.get(key(cx, cy)) ?? []) next.add(i);
    for (const i of shown) if (!next.has(i)) images.get(i)!.removeFromDisplayList();
    for (const i of next) {
      if (shown.has(i)) continue;
      let image = images.get(i);
      if (!image) {
        const p = pieces[i];
        images.set(i, image = new Phaser.GameObjects.Image(scene, p.x, p.y, p.key, p.frame).setOrigin(0).setDepth(p.depth));
      }
      image.addToDisplayList();
    }
    shown = next;
  };
  scene.events.on("prerender", update);
  // The display list destroys only what's on it.
  scene.events.once("shutdown", () => {
    scene.events.off("prerender", update);
    for (const image of images.values()) image.destroy();
  });
}

/** The ground layers drawn together into textures of at most CHUNK px; the layers are destroyed. */
function groundPieces(textures: Phaser.Textures.TextureManager, prefix: string,
  layers: (Phaser.Tilemaps.TilemapLayer | Phaser.Tilemaps.TilemapGPULayer)[]): Piece[] {
  if (!layers.length) return [];
  const pieces: Piece[] = [];
  const { width, height } = layers[0];
  for (let cy = 0; cy < height; cy += CHUNK) {
    for (let cx = 0; cx < width; cx += CHUNK) {
      const key = `${prefix}-ground-${pieces.length}`;
      const w = Math.min(CHUNK, width - cx), h = Math.min(CHUNK, height - cy);
      textures.addDynamicTexture(key, w, h, false)!.draw(layers, -cx, -cy).render();
      pieces.push({ key, x: cx, y: cy, w, h, depth: 0 });
    }
  }
  for (const l of layers) l.destroy();
  return pieces;
}

/**
 * Part of a wall strip, in tiles, at most a page big. Once baked: `page` / `at` = where it sits in the pages, `frame`
 * = its frame there.
 */
interface Part {
  left: number; top: number; w: number; h: number; tiles: Phaser.Tilemaps.Tile[]; depth: number;
  page?: number; at?: { x: number; y: number }; frame?: { key: string; name: string };
}

/**
 * Wall tiles that share a base y form a strip, whose depth comes from the base y the same way characters get theirs
 * from their feet. So walls, the player and NPCs all sort together. Every walls layer gets its own strips (two layers
 * can fill the same cell); a later layer is drawn over an earlier one on the same base.
 * Each group of touching tiles in a strip (a tree, a house, a lamp) is a piece of its own, covering only its tiles'
 * rows and columns: a strip spanning a forest row baked mostly empty space (forest-south: ~800 MB). Pieces showing the
 * same tiles in the same layout (a forest's pines, the street lamps) share one baked frame. The frames are packed side
 * by side into a few shared textures (pages of at most CHUNK px): a texture each (~1700 in the main city) took most of
 * a second to create and kept the GPU switching textures.
 */
function wallPieces(textures: Phaser.Textures.TextureManager, prefix: string, map: Phaser.Tilemaps.Tilemap,
  tileset: Phaser.Tilemaps.Tileset, layers: Phaser.Tilemaps.TilemapLayer[], blockers: Phaser.Tilemaps.TilemapLayer | null): Piece[] {
  if (!layers.length) return [];
  const tw = map.tileWidth, th = map.tileHeight, cols = Math.floor(CHUNK / tw), rows = Math.floor(CHUNK / th);
  const strips = new Map<string, { order: number; baseY: number; tiles: Phaser.Tilemaps.Tile[] }>();
  for (const [tile, baseY] of wallBaseY(layers, blockers)) {
    const order = layers.indexOf(tile.tilemapLayer as Phaser.Tilemaps.TilemapLayer), key = `${order}:${baseY}`;
    if (!strips.has(key)) strips.set(key, { order, baseY, tiles: [] });
    strips.get(key)!.tiles.push(tile);
  }
  const parts: Part[] = [];
  for (const { order, baseY, tiles } of strips.values()) {
    // -0.5 so a character standing exactly on the base is drawn in front.
    const depth = depthForY(baseY - 0.5) + order * 1e-7;
    for (const group of touchingGroups(tiles)) {
      const xs = group.map((t) => t.x), ys = group.map((t) => t.y);
      const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
      // Pieces bigger than a page are cut into page-sized parts.
      for (let y = top; y <= bottom; y += rows) {
        for (let x = left; x <= right; x += cols) {
          const w = Math.min(cols, right - x + 1), h = Math.min(rows, bottom - y + 1);
          const inside = group.filter((t) => t.x >= x && t.x < x + w && t.y >= y && t.y < y + h);
          if (inside.length) parts.push({ left: x, top: y, w, h, tiles: inside, depth });
        }
      }
    }
  }

  // Each part is baked by the first part with the same tiles in the same layout (its source).
  const firsts = new Map<string, Part>();
  const sources = parts.map((p) => {
    const cells = new Array<number>(p.w * p.h).fill(-1);
    for (const t of p.tiles) cells[(t.y - p.top) * p.w + t.x - p.left] = t.index;
    const layout = `${p.w}:${cells.join(",")}`;
    if (!firsts.has(layout)) firsts.set(layout, p);
    return firsts.get(layout)!;
  });

  // Shelf packing, tallest first: each row of parts on a page is as tall as its first part.
  const baking = [...firsts.values()].sort((a, b) => b.h - a.h);
  const pages: { w: number; h: number }[] = [];
  let x = 0, y = 0, shelf = 0;
  for (const p of baking) {
    if (pages.length && x + p.w > cols) { x = 0; y += shelf; shelf = 0; }
    if (!pages.length || y + p.h > rows) { pages.push({ w: 0, h: 0 }); x = y = shelf = 0; }
    const page = pages[pages.length - 1];
    p.page = pages.length - 1;
    p.at = { x, y };
    x += p.w;
    shelf = Math.max(shelf, p.h);
    page.w = Math.max(page.w, x);
    page.h = Math.max(page.h, y + p.h);
  }

  // Each page is drawn from one blank layer holding all its parts' tiles where they sit on the page.
  pages.forEach((page, i) => {
    const key = `${prefix}-walls-${i}`;
    const onPage = baking.filter((p) => p.page === i);
    const layer = map.createBlankLayer(key, tileset, 0, 0, page.w, page.h)!;
    for (const p of onPage) for (const t of p.tiles) layer.putTileAt(t.index, p.at!.x + t.x - p.left, p.at!.y + t.y - p.top);
    const texture = textures.addDynamicTexture(key, page.w * tw, page.h * th, false)!;
    texture.draw(layer, 0, 0).render();
    layer.destroy();
    onPage.forEach((p, j) => {
      texture.add(String(j), 0, p.at!.x * tw, p.at!.y * th, p.w * tw, p.h * th);
      p.frame = { key, name: String(j) };
    });
  });
  return parts.map((p, i) => {
    const { key, name } = sources[i].frame!;
    return { key, frame: name, x: p.left * tw, y: p.top * th, w: p.w * tw, h: p.h * th, depth: p.depth };
  });
}

/** The tiles in groups that touch (side by side, not just at corners). */
function touchingGroups(tiles: Phaser.Tilemaps.Tile[]): Phaser.Tilemaps.Tile[][] {
  const key = (x: number, y: number) => y * 65536 + x;
  const left = new Map(tiles.map((t) => [key(t.x, t.y), t]));
  const groups: Phaser.Tilemaps.Tile[][] = [];
  for (const start of tiles) {
    if (!left.delete(key(start.x, start.y))) continue;
    const group = [start];
    for (let i = 0; i < group.length; i++) {
      const { x, y } = group[i];
      for (const k of [key(x + 1, y), key(x - 1, y), key(x, y + 1), key(x, y - 1)]) {
        const t = left.get(k);
        if (t && left.delete(k)) group.push(t);
      }
    }
    groups.push(group);
  }
  return groups;
}

/**
 * For every wall tile, the y its "base" sits on. A tile is drawn behind a character when its base is above the
 * character's feet.
 *  - collision tiles use their own bottom edge
 *  - non-collision tiles (tree tops, roofs) use the bottom of the collision tiles below them in the same column,
 *    so a whole tree sorts by its trunk
 *  - if there is none in that column (edge of a tree crown), the lowest collision tile of the connected group
 *  - purely decorative groups with no collision use their own bottom edge
 * A cell of the "collision" layer (`blockers`) counts as a collision tile, with or without a wall tile on it (a tree
 * whose trunk is drawn on a ground layer still sorts by it). All walls layers count together: a crown on walls2 sorts
 * by the trunk below it on walls.
 */
function wallBaseY(layers: Phaser.Tilemaps.TilemapLayer[], blockers: Phaser.Tilemaps.TilemapLayer | null): Map<Phaser.Tilemaps.Tile, number> {
  const { width: w, height: h } = layers[0].layer;
  const tileH = layers[0].tilemap.tileHeight;
  // Per cell, read once (a forest made millions of tile lookups): a wall tile on any walls layer (`occupied`), and
  // a "collision" layer cell or a wall tile with the `collision` property (`solid`).
  const isTile = (t: Phaser.Tilemaps.Tile | null): t is Phaser.Tilemaps.Tile => !!t && t.index !== -1;
  const occupiedAt = new Uint8Array(w * h), solidAt = new Uint8Array(w * h), blockedAt = new Uint8Array(w * h);
  blockers?.layer.data.forEach((row, y) => row.forEach((t, x) => { if (isTile(t)) blockedAt[y * w + x] = solidAt[y * w + x] = 1; }));
  const walls = layers.map((l) => l.layer.data);
  for (const data of walls) {
    data.forEach((row, y) => row.forEach((t, x) => {
      if (!isTile(t)) return;
      occupiedAt[y * w + x] = 1;
      if ((t.properties as { collision?: boolean })?.collision) solidAt[y * w + x] = 1;
    }));
  }
  const collides = (t: Phaser.Tilemaps.Tile) => !!(t.properties as { collision?: boolean })?.collision || !!blockedAt[t.y * w + t.x];
  const occupied = (x: number, y: number) => occupiedAt[y * w + x] === 1;
  const solid = (x: number, y: number) => solidAt[y * w + x] === 1;

  // Groups of touching wall cells (any walls layer): the lowest collision bottom of each.
  const groupBase = new Int32Array(w * h).fill(-1);
  const seen = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (seen[y * w + x] || !occupied(x, y)) continue;
      const group: number[] = [];
      const stack = [y * w + x];
      seen[y * w + x] = 1;
      let base = -1;
      while (stack.length) {
        const k = stack.pop()!, cx = k % w, cy = (k - cx) / w;
        group.push(k);
        if (solid(cx, cy)) base = Math.max(base, (cy + 1) * tileH);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || !occupied(nx, ny)) continue;
          seen[ny * w + nx] = 1;
          stack.push(ny * w + nx);
        }
      }
      for (const k of group) groupBase[k] = base;
    }
  }

  const baseYs = new Map<Phaser.Tilemaps.Tile, number>();
  for (const data of walls) {
    for (const tile of data.flat()) {
      if (!isTile(tile)) continue;
      let baseY = tile.bottom;
      if (!collides(tile)) {
        // Walk down the column to the first collision tile, then to the end of that run.
        let y = tile.y + 1;
        while (y < h && occupied(tile.x, y) && !solid(tile.x, y)) y++;
        if (y < h && solid(tile.x, y)) {
          while (y < h && solid(tile.x, y)) baseY = (++y) * tileH;
        } else {
          const group = groupBase[tile.y * w + tile.x];
          baseY = group >= 0 ? group : tile.bottom;
        }
      }
      baseYs.set(tile, baseY);
    }
  }
  return baseYs;
}
