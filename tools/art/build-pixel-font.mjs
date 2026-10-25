// Converts a pixel-art TTF into a crisp bitmap font (PNG + BMFont XML) that Phaser loads
// with `load.bitmapFont`. Browsers can't render tiny pixel TTFs without blur, so we sample
// each glyph's outline at pixel-cell centres instead.
//
// Usage: node tools/art/build-pixel-font.mjs <font.ttf> <outName> <pixelUnits> [spacing]
//   pixelUnits: font units per pixel (3x3 Font for Nerds: ~228.3)
//   Writes public/assets/fonts/<outName>.png and <outName>.xml
import { readFileSync } from "node:fs";
import path from "node:path";
import opentype from "opentype.js";
import { preview, writeBitmapFont } from "../lib/bmfont.mjs";

const [fontFile, outName, unitArg, spacingArg] = process.argv.slice(2);
if (!fontFile || !outName || !unitArg) {
  console.error("usage: build-pixel-font.mjs <font.ttf> <outName> <pixelUnits> [spacing=1]");
  process.exit(1);
}
const UNIT = Number(unitArg);
const SPACING = Number(spacingArg ?? 1);
const OUT = path.resolve(import.meta.dirname, "../../public/assets/fonts");

const buf = readFileSync(fontFile);
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));

/** Polygons (flattened to line segments) of a glyph outline, in font units (y up). */
function polygons(glyph) {
  const polys = [];
  let cur = null;
  for (const c of glyph.path.commands) {
    if (c.type === "M") { cur = [[c.x, c.y]]; polys.push(cur); }
    else if (c.type === "L" || c.type === "Q" || c.type === "C") cur.push([c.x, c.y]);
  }
  return polys;
}

/** Non-zero winding test. */
function inside(polys, x, y) {
  let winding = 0;
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
      if (y1 <= y ? y2 > y && cross(x1, y1, x2, y2, x, y) > 0 : y2 <= y && cross(x1, y1, x2, y2, x, y) < 0) {
        winding += y1 <= y ? 1 : -1;
      }
    }
  }
  return winding !== 0;
}
const cross = (x1, y1, x2, y2, x, y) => (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1);

// The cap height defines the line: find the top of 'H' and the baseline (bottom of 'H').
const ref = font.charToGlyph("H").getBoundingBox();
const top = ref.y2, bottom = ref.y1;
const lineRows = Math.round((top - bottom) / UNIT);

const glyphs = [];
for (let i = 0; i < font.glyphs.length; i++) {
  const g = font.glyphs.get(i);
  const codes = g.unicodes?.length ? g.unicodes : g.unicode !== undefined ? [g.unicode] : [];
  if (!codes.length) continue;
  const bb = g.getBoundingBox();
  const empty = bb.x1 === 0 && bb.x2 === 0;
  const cols = empty ? 0 : Math.max(1, Math.round((bb.x2 - bb.x1) / UNIT));
  const rowTop = empty ? 0 : Math.round((top - bb.y2) / UNIT);
  const rows = empty ? 0 : Math.max(1, Math.round((bb.y2 - bb.y1) / UNIT));
  const polys = polygons(g);
  const bits = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push(inside(polys, bb.x1 + (c + 0.5) * UNIT, bb.y2 - (r + 0.5) * UNIT) ? 1 : 0);
    bits.push(row);
  }
  const advance = empty ? Math.max(1, Math.round(g.advanceWidth / UNIT)) : cols + SPACING;
  for (const code of codes) glyphs.push({ code, rowTop, bits, advance });
}

const { width, height } = await writeBitmapFont(OUT, outName, glyphs, { capHeight: lineRows, lineHeight: lineRows + 2 });
console.log(`${outName}: ${glyphs.length} glyphs, ${lineRows}px cap height, atlas ${width}x${height}`);
console.log(preview(glyphs, "HELLO 2500", lineRows));
