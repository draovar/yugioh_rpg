// Building blocks for hand-planned overworld maps (tools/maps/build-main-city.mjs): the theme tilesets
// (data/maps/tilesets/*.tsj, 16 px tiles: every 32 px piece of the pack is 2x2 tiles), objects stamped by their name in
// data/maps/tile-catalog.json, terrain painted from per-tile classes with edge pieces, and the .tmj writer.
//
// Terrain works like generate-world.mjs: on a grid of 2-tile cells, a terrain is a mask over the cell corners
// (vertices every 2 tiles); each cell takes the edge piece whose covered corners match (signature TL 8, TR 4, BL 2,
// BR 1). Edge pieces are found in the sheets by the colour of each piece's corner pixels.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import sharp from "sharp";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const MAPS = path.join(ROOT, "data/maps");

/** Seeded hash in [0, 1). */
export const hash = (x, y, salt = 0) => {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export class MapBuilder {
  /** `sets`: tileset names in data/maps/tilesets (firstgid order). */
  constructor(width, height, sets) {
    if (width % 2 || height % 2) throw new Error("map sizes must be even (2-tile cells)");
    this.W = width;
    this.H = height;
    this.VW = width / 2 + 1;
    this.VH = height / 2 + 1;
    this.sets = {};
    let next = 1;
    for (const name of sets) {
      const tsj = JSON.parse(readFileSync(path.join(MAPS, "tilesets", `${name}.tsj`), "utf-8"));
      this.sets[name] = { name, firstgid: next, columns: tsj.columns, count: tsj.tilecount,
        image: path.join(MAPS, "tilesets", tsj.image) };
      next += tsj.tilecount;
    }
    this.layers = new Map();
    this.collision = new Uint8Array(width * height);
    /** Cells some object's opaque tile already covers, per walls layer (stamping looks for a free layer). */
    this.objects = [];
    this.images = {};
    this.catalog = new Map();
    const entries = JSON.parse(readFileSync(path.join(MAPS, "tile-catalog.json"), "utf-8")).entries;
    for (const e of entries) {
      this.catalog.set(`${e.theme}/${e.name}`, e);
      // a bare name points at its first entry; names shared by themes (Tree_1, Buoy_1) need Theme/Name
      if (!this.catalog.has(e.name)) this.catalog.set(e.name, e);
    }
  }

  layer(name) {
    if (!this.layers.has(name)) this.layers.set(name, new Uint32Array(this.W * this.H));
    return this.layers.get(name);
  }

  gid(set, x, y) {
    const s = this.sets[set];
    if (!s) throw new Error(`tileset ${set} is not loaded`);
    return s.firstgid + y * s.columns + x;
  }

  /** A 2x2 piece at tile (x, y) of a set: its four gids (TL, TR, BL, BR). */
  piece(set, x, y) {
    return [this.gid(set, x, y), this.gid(set, x + 1, y), this.gid(set, x, y + 1), this.gid(set, x + 1, y + 1)];
  }

  async rgba(set) {
    this.images[set] ??= await sharp(this.sets[set].image, { limitInputPixels: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return this.images[set];
  }

  setOf(gid) {
    return Object.values(this.sets).findLast((s) => s.firstgid <= gid);
  }

  /** Share of a tile's pixels that are (nearly) opaque, 0..1. */
  async opacity(gid) {
    this.opacityCache ??= new Map();
    if (this.opacityCache.has(gid)) return this.opacityCache.get(gid);
    const s = this.setOf(gid), id = gid - s.firstgid;
    const { data, info } = await this.rgba(s.name);
    const sx = (id % s.columns) * 16, sy = Math.floor(id / s.columns) * 16;
    let n = 0, any = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const a = data[((sy + y) * info.width + sx + x) * 4 + 3];
      if (a >= 200) n++;
      if (a) any++;
    }
    const v = { solid: n / 256, any: any / 256 };
    this.opacityCache.set(gid, v);
    return v;
  }

  // --- objects -------------------------------------------------------------------------------------------------------

  /**
   * A catalogue object's tiles: { w, h, cells: [{ dx, dy, gid, solid, any }] } without fully transparent cells.
   * `name` is "Theme/Name" or a bare Name.
   */
  async object(name) {
    this.objectCache ??= new Map();
    if (this.objectCache.has(name)) return this.objectCache.get(name);
    const e = this.catalog.get(name);
    if (!e) throw new Error(`no catalogue object ${name}`);
    const cells = [], empty = new Set(e.empty ?? []);
    for (let dy = 0; dy < e.h; dy++) for (let dx = 0; dx < e.w; dx++) {
      if (empty.has(dy * e.w + dx)) continue; // a neighbour's art in the sheet
      let gid;
      if (e.tileset) gid = this.gid(e.tileset, e.x + dx, e.y + dy);
      else {
        const c = e.cells[dy * e.w + dx];
        if (!c) continue;
        const [set, id] = c.split(":");
        gid = this.sets[set] ? this.sets[set].firstgid + Number(id) : null;
        if (!gid) throw new Error(`${name}: tileset ${set} is not loaded`);
      }
      const { solid, any } = await this.opacity(gid);
      if (any === 0) continue;
      cells.push({ dx, dy, gid, solid, any });
    }
    const o = { name, w: e.w, h: e.h, cells };
    this.objectCache.set(name, o);
    return o;
  }

  /**
   * Stamps an object with its top-left at tile (x, y) into the first of `layers` where none of its cells is taken.
   * `block`: which cells collide —
   *   "all": every mostly opaque cell (buildings), "base": the mostly opaque cells of its lowest `baseRows` rows (props),
   *   "trunk": the middle `trunkW` columns of the lowest opaque row(s) (trees), "none", or a function (dx, dy, cell) → bool.
   * Returns false (and stamps nothing) if no layer is free or it would leave the map.
   */
  async stamp(name, x, y, { layers = ["walls", "walls2", "walls3"], block = "all", baseRows = 1, trunkW = 2, trunkRows = 1, force = false } = {}) {
    const o = await this.object(name);
    if (x < 0 || y < 0 || x + o.w > this.W || y + o.h > this.H) {
      if (force) throw new Error(`${name} at ${x},${y} leaves the map`);
      return false;
    }
    const layerName = layers.find((l) => o.cells.every((c) => !this.layer(l)[(y + c.dy) * this.W + x + c.dx]));
    if (!layerName) {
      if (force) throw new Error(`${name} at ${x},${y}: no free layer`);
      return false;
    }
    const L = this.layer(layerName);
    const solidCells = o.cells.filter((c) => c.solid >= 0.5);
    const bottom = Math.max(-1, ...solidCells.map((c) => c.dy));
    const colsAt = (dy) => solidCells.filter((c) => c.dy === dy).map((c) => c.dx);
    let trunk = null;
    if (block === "trunk") {
      // the trunk: the opaque cells of the lowest rows nearest the object's middle column
      const mid = (o.w - 1) / 2;
      trunk = new Set();
      for (let r = 0; r < trunkRows; r++) {
        const cols = colsAt(bottom - r).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid)).slice(0, trunkW);
        for (const dx of cols) trunk.add(`${dx},${bottom - r}`);
      }
    }
    for (const c of o.cells) {
      const k = (y + c.dy) * this.W + x + c.dx;
      L[k] = c.gid;
      const blocks = typeof block === "function" ? block(c.dx, c.dy, c)
        : block === "all" ? c.solid >= 0.5
        : block === "base" ? c.solid >= 0.5 && c.dy > bottom - baseRows
        : block === "trunk" ? trunk.has(`${c.dx},${c.dy}`)
        : false;
      if (blocks) this.collision[k] = 1;
    }
    this.objects.push({ name, x, y, w: o.w, h: o.h, layer: layerName });
    return true;
  }

  /** True if the object's opaque cells at (x, y) are free on every walls layer, and `ok(tx, ty)` holds for each. */
  async fits(name, x, y, ok = () => true, layers = ["walls"]) {
    const o = await this.object(name);
    if (x < 0 || y < 0 || x + o.w > this.W || y + o.h > this.H) return false;
    return o.cells.every((c) => ok(x + c.dx, y + c.dy) && layers.every((l) => !this.layer(l)[(y + c.dy) * this.W + x + c.dx]));
  }

  /** Copies a rectangle of a tileset (w x h tiles at sx, sy) to (x, y) of a layer, skipping transparent tiles. */
  async blit(layerName, set, sx, sy, w, h, x, y) {
    const L = this.layer(layerName);
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      const g = this.gid(set, sx + dx, sy + dy);
      if ((await this.opacity(g)).any === 0) continue;
      if (x + dx >= 0 && y + dy >= 0 && x + dx < this.W && y + dy < this.H) L[(y + dy) * this.W + x + dx] = g;
    }
  }

  // --- terrain -------------------------------------------------------------------------------------------------------

  /**
   * Edge pieces of a terrain by corner signature (TL 8, TR 4, BL 2, BR 1: the corners the terrain covers): every 2x2
   * piece in the tile rectangle [x0, y0, x1, y1) whose four corners are clearly covered or clearly not. `covered` tells
   * for a corner's pixels. Signature 15 (the fill) keeps every variant; the rest keep the first piece found.
   */
  async edgeSet(set, [x0, y0, x1, y1], covered, { scored = false } = {}) {
    const { data, info } = await this.rgba(set);
    const at = (x, y) => { const i = (y * info.width + x) * 4; return covered(data[i], data[i + 1], data[i + 2], data[i + 3]); };
    const found = new Map(); // sig → [{ piece, score }]
    for (let ty = y0; ty < y1; ty += 2) for (let tx = x0; tx < x1; tx += 2) {
      const px = tx * 16, py = ty * 16;
      const corner = (cx, cy) => {
        const votes = [];
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) votes.push(at(px + (cx ? 31 - dx : dx), py + (cy ? 31 - dy : dy)));
        return votes.every((v) => v) ? 1 : votes.every((v) => !v) ? 0 : -1;
      };
      const c = [corner(0, 0), corner(1, 0), corner(0, 1), corner(1, 1)];
      if (c.includes(-1)) continue;
      const sig = c[0] * 8 + c[1] * 4 + c[2] * 2 + c[3];
      if (sig === 0) continue;
      // `scored`: how well the inside agrees with the corners (blob sets hold several pieces per corner signature:
      // strips, notched edges; the plain one has the boundary where the corners put it)
      let score = 0;
      if (scored) {
        for (let sy = 2; sy < 32; sy += 4) for (let sx = 2; sx < 32; sx += 4) {
          const u = sx / 31, v = sy / 31;
          const e = c[0] * (1 - u) * (1 - v) + c[1] * u * (1 - v) + c[2] * (1 - u) * v + c[3] * u * v;
          if (Math.abs(e - 0.5) < 0.2) continue;
          if (at(px + sx, py + sy) === e > 0.5) score++;
        }
      }
      if (!found.has(sig)) found.set(sig, []);
      found.get(sig).push({ piece: this.piece(set, tx, ty), score });
    }
    if (!found.has(15)) throw new Error(`${set} ${[x0, y0]}: no fill piece found`);
    const bySig = new Map();
    for (const [sig, list] of found) {
      const best = Math.max(...list.map((p) => p.score));
      // the fill keeps every variant (that scores as well); the rest keep the first best piece
      const keep = list.filter((p) => p.score === best);
      bySig.set(sig, sig === 15 ? keep.map((p) => p.piece) : [keep[0].piece]);
    }
    return bySig;
  }

  /**
   * A blob autotile set (Godot "3x3 minimal": 12x4 pieces of 32 px, 8 tile rows a block, the block's top row `blockY`)
   * by neighbour mask: N 1, NE 2, E 4, SE 8, S 16, SW 32, W 64, NW 128 (a diagonal counts only with both its sides).
   * The layout is read from a reference block where it can be seen: the sidewalk on asphalt (block 18 of the sheet).
   * Used for sets drawn along a region's inner edge, which corner signatures can't tell apart: fences, hedges.
   */
  async blobSet(set, blockY, refY = 144) {
    if (!this.blobLayout) {
      const { data, info } = await this.rgba(set);
      const light = (x, y) => { const i = (y * info.width + x) * 4; return data[i + 3] > 128 && data[i] > 150; };
      this.blobLayout = new Map();
      for (let row = 0; row < 4; row++) for (let col = 0; col < 12; col++) {
        const px = col * 32, py = refY * 16 + row * 32;
        if (!light(px + 16, py + 16)) continue; // the empty slot
        const bit = (x, y) => (light(px + x, py + y) ? 1 : 0);
        const mask = bit(16, 1) * 1 | bit(30, 1) * 2 | bit(30, 16) * 4 | bit(30, 30) * 8 | bit(16, 30) * 16 | bit(1, 30) * 32 | bit(1, 16) * 64 | bit(1, 1) * 128;
        if (!this.blobLayout.has(mask)) this.blobLayout.set(mask, [col, row]);
      }
    }
    const bySet = new Map();
    for (const [mask, [col, row]] of this.blobLayout) bySet.set(mask, this.piece(set, col * 2, blockY + row * 2));
    return bySet;
  }

  /** Paints a blob set over the cells where `inside(cx, cy)` holds. */
  paintBlob(layerName, inside, bySet) {
    const has = (cx, cy) => cx >= 0 && cy >= 0 && cx < this.W / 2 && cy < this.H / 2 && inside(cx, cy);
    for (let cy = 0; cy < this.H / 2; cy++) for (let cx = 0; cx < this.W / 2; cx++) {
      if (!has(cx, cy)) continue;
      const n = has(cx, cy - 1), e = has(cx + 1, cy), s = has(cx, cy + 1), w = has(cx - 1, cy);
      const mask = (n ? 1 : 0) | (n && e && has(cx + 1, cy - 1) ? 2 : 0) | (e ? 4 : 0) | (s && e && has(cx + 1, cy + 1) ? 8 : 0)
        | (s ? 16 : 0) | (s && w && has(cx - 1, cy + 1) ? 32 : 0) | (w ? 64 : 0) | (n && w && has(cx - 1, cy - 1) ? 128 : 0);
      const p = bySet.get(mask);
      if (p) this.put2(layerName, cx, cy, p);
    }
  }

  async colourAt(set, tx, ty, ox = 8, oy = 8) {
    const { data, info } = await this.rgba(set);
    const i = ((ty * 16 + oy) * info.width + tx * 16 + ox) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  }

  /** A vertex mask from a test over the 4 tiles around each vertex (`at(x, y)` reads a tile, clamped to the map). */
  vertexMask(test) {
    const { VW, VH } = this;
    const m = new Uint8Array(VW * VH);
    for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) m[j * VW + i] = test(2 * i, 2 * j) ? 1 : 0;
    return m;
  }

  vAt(m, i, j) {
    return i < 0 || j < 0 || i >= this.VW || j >= this.VH ? 0 : m[j * this.VW + i];
  }

  /** Smooths a mask: lone vertices go, one-vertex gaps fill, and no cell keeps a diagonal-only pair of corners. */
  tidy(m, keepThin = false) {
    const { VW, VH } = this;
    for (let pass = 0; pass < 4; pass++) {
      const copy = m.slice();
      for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) {
        let n = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (di || dj) n += this.vAt(copy, i + di, j + dj);
        if (!keepThin && copy[j * VW + i] && n <= 2) m[j * VW + i] = 0;
        if (!copy[j * VW + i] && n >= 6) m[j * VW + i] = 1;
      }
    }
    for (let changed = true; changed;) {
      changed = false;
      for (let j = 0; j < VH - 1; j++) for (let i = 0; i < VW - 1; i++) {
        const s = this.vAt(m, i, j) * 8 + this.vAt(m, i + 1, j) * 4 + this.vAt(m, i, j + 1) * 2 + this.vAt(m, i + 1, j + 1);
        if (s === 9 || s === 6) { m[j * VW + i] = m[j * VW + i + 1] = m[(j + 1) * VW + i] = m[(j + 1) * VW + i + 1] = 1; changed = true; }
      }
    }
    return m;
  }

  put2(layerName, cx, cy, p) {
    const L = this.layer(layerName), W = this.W;
    L[2 * cy * W + 2 * cx] = p[0]; L[2 * cy * W + 2 * cx + 1] = p[1];
    L[(2 * cy + 1) * W + 2 * cx] = p[2]; L[(2 * cy + 1) * W + 2 * cx + 1] = p[3];
  }

  /**
   * Paints a terrain mask with its edge pieces. `where(cx, cy)` limits the cells painted; `background` = the piece for
   * cells inside `where` with no covered corner (opaque sets: the other terrain of the piece).
   */
  paint(layerName, mask, bySig, salt, { where = null, background = null, variants = 0.25 } = {}) {
    for (let cy = 0; cy < this.H / 2; cy++) for (let cx = 0; cx < this.W / 2; cx++) {
      if (where && !where(cx, cy)) continue;
      const sig = this.vAt(mask, cx, cy) * 8 + this.vAt(mask, cx + 1, cy) * 4 + this.vAt(mask, cx, cy + 1) * 2 + this.vAt(mask, cx + 1, cy + 1);
      if (!sig) {
        if (background) this.put2(layerName, cx, cy, background);
        continue;
      }
      const options = bySig.get(sig) ?? bySig.get(15);
      const pick = sig === 15 && options.length > 1 && hash(cx, cy, salt) < variants ? 1 + Math.floor(hash(cy, cx, salt) * (options.length - 1)) : 0;
      this.put2(layerName, cx, cy, options[pick]);
    }
  }

  // --- output --------------------------------------------------------------------------------------------------------

  /** Writes the .tmj: tile layers in `order` (missing ones empty), the hidden collision layer, then `objects`. */
  write(file, order, objects, collisionGid) {
    const encode = (cells) => deflateSync(Buffer.from(new Uint32Array(cells).buffer)).toString("base64");
    let id = 1;
    const tileLayer = (name, cells, visible = true) => ({ id: id++, name, type: "tilelayer", x: 0, y: 0, width: this.W, height: this.H,
      opacity: 1, visible, encoding: "base64", compression: "zlib", data: encode(cells) });
    const layers = order.map((name) => tileLayer(name, this.layer(name)));
    layers.push(tileLayer("collision", Array.from(this.collision, (c) => (c ? collisionGid : 0)), false));
    let objectId = 1;
    const objs = objects.map((o) => ({ id: objectId++, type: "", rotation: 0, visible: true, ...o }));
    layers.push({ id: id++, name: "objects", type: "objectgroup", x: 0, y: 0, opacity: 1, visible: true, draworder: "topdown", objects: objs });
    const tilesets = Object.values(this.sets).map((s) => ({ firstgid: s.firstgid, source: `tilesets/${s.name}.tsj` }));
    const map = { compressionlevel: -1, width: this.W, height: this.H, infinite: false, orientation: "orthogonal", renderorder: "right-down",
      tiledversion: "1.12.2", version: "1.10", type: "map", tilewidth: 16, tileheight: 16, nextlayerid: id, nextobjectid: objectId,
      layers, tilesets };
    writeFileSync(file, JSON.stringify(map));
  }
}
