// Lossless 8-bit indexed PNG writer for art already mapped to the shared palette (≤ 256 colours + transparency).
// sharp's `palette` output runs libimagequant, which shifts colours slightly even when the image has fewer than
// 256; this keeps every pixel and is ~25% smaller than sharp's RGBA PNG for our dithered art.
import zlib from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** Raw RGBA pixels (width * height * 4) → indexed PNG buffer. Fully transparent pixels share one entry. */
export function indexedPng(rgba, width, height) {
  const palette = new Map(); // RGBA as u32 (transparent → -1) → index
  const rows = Buffer.alloc((width + 1) * height); // each row: filter byte 0 + indices
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const key = rgba[o + 3] === 0 ? -1 : rgba.readUInt32BE(o);
      let i = palette.get(key);
      if (i === undefined) {
        i = palette.size;
        if (i > 255) throw new Error("indexedPng: more than 256 colours");
        palette.set(key, i);
      }
      rows[y * (width + 1) + 1 + x] = i;
    }
  }
  const keys = [...palette.keys()];
  const plte = Buffer.alloc(keys.length * 3);
  const trns = Buffer.alloc(keys.length);
  keys.forEach((k, i) => {
    if (k === -1) return; // stays black, alpha 0
    plte[i * 3] = k >>> 24;
    plte[i * 3 + 1] = (k >>> 16) & 255;
    plte[i * 3 + 2] = (k >>> 8) & 255;
    trns[i] = k & 255;
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // colour type: indexed
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("PLTE", plte), chunk("tRNS", trns),
    chunk("IDAT", zlib.deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}
