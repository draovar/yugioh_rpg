// Tiles as hashes, to find the same art in different tile sheets (LimeZu's complete sheet, its theme sheets, the
// named "Singles"). Transparent pixels' colour is ignored: the sheets disagree on it.
import { createHash } from "node:crypto";
import sharp from "sharp";

/** Hashes of an image's size x size cells, row by row (null = fully transparent); partial cells at the edges are dropped. */
export async function tileHashes(file, size) {
  const { data, info } = await sharp(file, { limitInputPixels: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = Math.floor(info.width / size), h = Math.floor(info.height / size), hashes = [];
  const cell = Buffer.alloc(size * size * 4);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      for (let y = 0; y < size; y++) {
        const from = ((r * size + y) * info.width + c * size) * 4;
        data.copy(cell, y * size * 4, from, from + size * 4);
      }
      let empty = true;
      for (let i = 3; i < cell.length; i += 4) {
        if (cell[i]) empty = false;
        else cell[i - 3] = cell[i - 2] = cell[i - 1] = 0;
      }
      hashes.push(empty ? null : createHash("sha1").update(cell).digest("base64"));
    }
  }
  return { w, h, width: info.width, height: info.height, hashes };
}

/** hash → every id it occurs at (row-major ids, as in a Tiled tileset with that many columns). */
export function idsByHash(hashes) {
  const ids = new Map();
  hashes.forEach((hash, id) => {
    if (!hash) return;
    if (!ids.has(hash)) ids.set(hash, []);
    ids.get(hash).push(id);
  });
  return ids;
}
