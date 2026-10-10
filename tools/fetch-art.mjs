// Downloads card images for every card in data/pool.json from YGOPRODeck into public/cards/
// (gitignored; YGOPRODeck asks that images be downloaded and self-hosted rather than hotlinked).
//   public/cards/<code>.jpg – full card image (field, hand and info panel)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "public/cards");
const pool = JSON.parse(readFileSync(path.join(ROOT, "data/pool.json"), "utf-8")).cards;
mkdirSync(OUT, { recursive: true });

const targets = pool.map((code) => [`https://images.ygoprodeck.com/images/cards/${code}.jpg`, path.join(OUT, `${code}.jpg`)]);

let fetched = 0;
const failed = [];
for (const [url, file] of targets) {
  if (existsSync(file)) continue;
  const res = await fetch(url);
  if (!res.ok) { failed.push(`${url} (HTTP ${res.status})`); continue; }
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  fetched++;
  await new Promise((r) => setTimeout(r, 100)); // be polite to the image host
}
console.log(`downloaded ${fetched} images (${targets.length - fetched - failed.length} already present)`);
if (failed.length) console.warn("failed:\n  " + failed.join("\n  "));
