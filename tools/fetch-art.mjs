// Downloads the art-only crops for every card in data/pool.json from YGOPRODeck into vendor/art/
// (gitignored; YGOPRODeck asks that images be downloaded and self-hosted, not hotlinked).
// Run `npm run build-art` afterwards to make the game-sized versions.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "vendor/art");
const pool = JSON.parse(readFileSync(path.join(ROOT, "data/pool.json"), "utf-8")).cards;
mkdirSync(OUT, { recursive: true });

let fetched = 0;
const failed = [];
for (const code of pool) {
  const file = path.join(OUT, `${code}.jpg`);
  if (existsSync(file)) continue;
  const url = `https://images.ygoprodeck.com/images/cards_cropped/${code}.jpg`;
  const res = await fetch(url);
  if (!res.ok) { failed.push(`${url} (HTTP ${res.status})`); continue; }
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  fetched++;
  await new Promise((r) => setTimeout(r, 100)); // be polite to the image host
}
console.log(`downloaded ${fetched} artworks (${pool.length - fetched - failed.length} already present)`);
if (failed.length) console.warn("failed:\n  " + failed.join("\n  "));
