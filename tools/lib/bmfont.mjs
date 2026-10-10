// Writes a 1-bit glyph set as a Phaser-loadable bitmap font: <name>.png (white glyphs, tint in
// Phaser) + <name>.xml (AngelCode BMFont). Glyph bitmaps are rows of 0/1, `rowTop` is the
// glyph's first row below the cap line.
import { writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

/**
 * @param {string} outDir
 * @param {string} name
 * @param {{ code: number, bits: number[][], rowTop: number, advance: number }[]} glyphs
 * @param {{ capHeight: number, lineHeight: number }} metrics
 */
export async function writeBitmapFont(outDir, name, glyphs, { capHeight, lineHeight }) {
  const pad = 1;
  let x = pad;
  const placed = glyphs.map((g) => {
    const cols = g.bits[0]?.length ?? 0;
    const p = { ...g, cols, rows: g.bits.length, x };
    x += cols + pad;
    return p;
  });
  const W = Math.max(1, x), H = Math.max(1, ...placed.map((g) => g.rows)) + 2 * pad;
  const rgba = Buffer.alloc(W * H * 4);
  for (const g of placed) {
    g.bits.forEach((row, r) => row.forEach((on, c) => {
      if (!on) return;
      const i = ((pad + r) * W + g.x + c) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 255;
    }));
  }
  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toFile(path.join(outDir, `${name}.png`));
  const chars = placed.map((g) =>
    `    <char id="${g.code}" x="${g.x}" y="${pad}" width="${g.cols}" height="${g.rows}" xoffset="0" yoffset="${g.rowTop}" xadvance="${g.advance}" page="0" chnl="15"/>`);
  writeFileSync(path.join(outDir, `${name}.xml`), `<?xml version="1.0"?>
<font>
  <info face="${name}" size="${capHeight}" bold="0" italic="0" charset="" unicode="1" stretchH="100" smooth="0" aa="0" padding="0,0,0,0" spacing="0,0"/>
  <common lineHeight="${lineHeight}" base="${capHeight}" scaleW="${W}" scaleH="${H}" pages="1" packed="0"/>
  <pages>
    <page id="0" file="${name}.png"/>
  </pages>
  <chars count="${placed.length}">
${chars.join("\n")}
  </chars>
</font>
`);
  return { width: W, height: H };
}

/** Terminal preview of a string, for sanity checks. */
export function preview(glyphs, text, capHeight) {
  const sample = [...text].map((ch) => glyphs.find((g) => g.code === ch.codePointAt(0)));
  const lines = [];
  for (let r = 0; r < capHeight + 2; r++) {
    lines.push("  " + sample.map((g) => {
      const row = g?.bits[r - g.rowTop] ?? [];
      const w = g?.advance ?? 2;
      return [...Array(w)].map((_, c) => (row[c] ? "#" : ".")).join("");
    }).join(""));
  }
  return lines.join("\n");
}
