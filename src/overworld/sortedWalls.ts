import Phaser from "phaser";

/** Everything y-sorted lives in depth 2..3: lower on screen = drawn later. */
export function depthForY(y: number) {
  return 2 + y / 100000;
}

/** The largest side of one baked texture: phones may not hold textures over 4096 px (a big map takes several). */
const CHUNK = 2048;

/**
 * Static tile layers drawn once into textures (pieces of at most CHUNK px), which replace them: a tilemap layer re-culls
 * and re-submits every visible tile each frame, which kept phones busy (and hot) while nothing moved. All layers share
 * the first's area.
 */
export function bake(scene: Phaser.Scene, layers: (Phaser.Tilemaps.TilemapLayer | Phaser.Tilemaps.TilemapGPULayer)[], depth: number) {
  const { x, y, width, height } = layers[0];
  for (let cy = 0; cy < height; cy += CHUNK) {
    for (let cx = 0; cx < width; cx += CHUNK) {
      scene.add.renderTexture(x + cx, y + cy, Math.min(CHUNK, width - cx), Math.min(CHUNK, height - cy))
        .setOrigin(0).setDepth(depth).draw(layers, -x - cx, -y - cy).render();
    }
  }
  for (const l of layers) l.destroy();
}

/**
 * Wall tiles that share a base y go into one layer, whose depth comes from the base y the same way characters get
 * theirs from their feet. So walls, the player and NPCs all sort together. Each layer only covers its tiles' rows and columns.
 * Every walls layer gets its own strips (two layers can fill the same cell); a later layer is drawn over an earlier
 * one on the same base.
 */
export function buildSortedWalls(scene: Phaser.Scene, map: Phaser.Tilemaps.Tilemap, tileset: Phaser.Tilemaps.Tileset,
  layers: Phaser.Tilemaps.TilemapLayer[], blockers: Phaser.Tilemaps.TilemapLayer | null) {
  const strips = new Map<string, { order: number; baseY: number; tiles: Phaser.Tilemaps.Tile[] }>();
  for (const [tile, baseY] of wallBaseY(layers, blockers)) {
    const order = layers.indexOf(tile.tilemapLayer as Phaser.Tilemaps.TilemapLayer), key = `${order}:${baseY}`;
    if (!strips.has(key)) strips.set(key, { order, baseY, tiles: [] });
    strips.get(key)!.tiles.push(tile);
  }
  for (const [key, { order, baseY, tiles }] of strips) {
    const top = Math.min(...tiles.map((t) => t.y)), bottom = Math.max(...tiles.map((t) => t.y));
    const left = Math.min(...tiles.map((t) => t.x)), right = Math.max(...tiles.map((t) => t.x));
    const sorted = map.createBlankLayer(`walls_${key}`, tileset, left * map.tileWidth, top * map.tileHeight, right - left + 1, bottom - top + 1)!;
    for (const t of tiles) sorted.putTileAt(t.index, t.x - left, t.y - top);
    // -0.5 so a character standing exactly on the base is drawn in front.
    bake(scene, [sorted], depthForY(baseY - 0.5) + order * 1e-7);
  }
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
  const tilesAt = (x: number, y: number) => layers.map((l) => l.getTileAt(x, y)).filter((t): t is Phaser.Tilemaps.Tile => !!t && t.index !== -1);
  const blocked = (x: number, y: number) => !!blockers?.hasTileAt(x, y);
  const collides = (t: Phaser.Tilemaps.Tile) => !!(t.properties as { collision?: boolean })?.collision || blocked(t.x, t.y);
  const occupied = (x: number, y: number) => tilesAt(x, y).length > 0;
  const solid = (x: number, y: number) => blocked(x, y) || tilesAt(x, y).some(collides);

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
  for (const layer of layers) {
    layer.forEachTile((tile) => {
      if (tile.index === -1) return;
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
    });
  }
  return baseYs;
}
