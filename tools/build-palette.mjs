// Builds the game's shared colour palette from a broad sample of GOAT-format card art.
// The result, data/palette.gpl, is a GIMP palette: open/tweak it in GIMP (Windows > Dockable
// Dialogs > Palettes) and reuse it for other art. build-art maps every card to it.
//
// This is NOT part of the normal build: the palette is frozen once made, so adding cards never
// shifts every card's colours. Rerun only to deliberately regenerate it.
//   node tools/build-palette.mjs [colours=48] [sampleSize=400]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { buildPalette } from "./lib/palette.mjs";
import { ART_STYLE, boost } from "./lib/art-style.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const VENDOR = path.join(ROOT, "vendor");
const ART = path.join(VENDOR, "art");
const COLOURS = Number(process.argv[2] ?? 48);
const SAMPLE = Number(process.argv[3] ?? 400);
mkdirSync(ART, { recursive: true });

// 1. GOAT card list (cached).
const listFile = path.join(VENDOR, "goat-cards.json");
if (!existsSync(listFile)) {
  console.log("fetching GOAT card list from YGOPRODeck");
  const res = await fetch("https://db.ygoprodeck.com/api/v7/cardinfo.php?format=goat");
  if (!res.ok) throw new Error(`card list: HTTP ${res.status}`);
  writeFileSync(listFile, JSON.stringify((await res.json()).data.map((c) => ({ id: c.id, name: c.name, frameType: c.frameType, attribute: c.attribute ?? null }))));
}
const cards = JSON.parse(readFileSync(listFile, "utf-8"));

// 2. Deterministic, varied sample: every fusion/ritual (rare, distinctive art), the rest proportional.
let seed = 12345;
const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
const byType = Object.groupBy(cards, (c) => c.frameType);
const always = ["fusion", "ritual"];
const fixed = always.flatMap((t) => byType[t] ?? []);
const rest = cards.filter((c) => !always.includes(c.frameType));
const take = Math.max(0, SAMPLE - fixed.length);
const sample = [...fixed];
for (const [type, list] of Object.entries(byType)) {
  if (always.includes(type)) continue;
  const n = Math.round((list.length / rest.length) * take);
  const shuffled = [...list].sort(() => rand() - 0.5);
  sample.push(...shuffled.slice(0, n));
}
console.log(`sample: ${sample.length} cards (${Object.entries(Object.groupBy(sample, (c) => c.frameType)).map(([t, l]) => `${t} ${l.length}`).join(", ")})`);

// 3. Download missing art (politely).
let downloaded = 0;
for (const c of sample) {
  const file = path.join(ART, `${c.id}.jpg`);
  if (existsSync(file)) continue;
  const res = await fetch(`https://images.ygoprodeck.com/images/cards_cropped/${c.id}.jpg`);
  if (!res.ok) { console.warn(`  no art for ${c.id} ${c.name} (HTTP ${res.status})`); continue; }
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  if (++downloaded % 50 === 0) console.log(`  downloaded ${downloaded}`);
  await new Promise((r) => setTimeout(r, 80));
}
console.log(`downloaded ${downloaded} new artworks`);

// 4. Gather pixels as the game will see them: each card at both art sizes, after the style boost.
const pixels = [];
for (const c of sample) {
  const file = path.join(ART, `${c.id}.jpg`);
  if (!existsSync(file)) continue;
  for (const style of [ART_STYLE.small, { ...ART_STYLE.large, size: 64 }]) {
    pixels.push(await boost(sharp(file).resize(style.size, style.size, { fit: "cover", kernel: "lanczos3" }), style).removeAlpha().raw().toBuffer());
  }
}
// Frame colours are included (weighted) so the art palette sits well with the card frames.
for (const f of readdirSync(path.join(ROOT, "public/assets/cards/frames"))) {
  const { data } = await sharp(path.join(ROOT, "public/assets/cards/frames", f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const opaque = [];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) opaque.push(data[i], data[i + 1], data[i + 2]);
  for (let r = 0; r < 30; r++) pixels.push(Buffer.from(opaque));
}
const palette = buildPalette(Buffer.concat(pixels), COLOURS, { maxSamples: 250000, iterations: 40 });

// 5. Save as a GIMP palette + a swatch image.
const gpl = ["GIMP Palette", "Name: Yu-Gi-Oh RPG", "Columns: 8", "#",
  ...palette.map(([r, g, b], i) => `${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\tcolour ${i + 1}`)].join("\n") + "\n";
writeFileSync(path.join(ROOT, "data/palette.gpl"), gpl);
const CELL = 24;
await sharp({ create: { width: 8 * CELL, height: Math.ceil(palette.length / 8) * CELL, channels: 3, background: "#000" } })
  .composite(palette.map(([r, g, b], i) => ({ input: { create: { width: CELL, height: CELL, channels: 3, background: { r, g, b } } }, left: (i % 8) * CELL, top: Math.floor(i / 8) * CELL })))
  .png().toFile(path.join(ROOT, "docs/palette.png"));
console.log(`palette: ${palette.length} colours -> data/palette.gpl, docs/palette.png`);
