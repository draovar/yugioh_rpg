// Builds the browser-side game data from the vendored Project Ignis repos:
//   public/data/cards.json   – stats + text for every card in data/pool.json
//   public/data/scripts.json – { fileName: luaSource } for engine utility scripts + pool card scripts
// Run `npm run fetch-data` first.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPTS = path.join(ROOT, "vendor/CardScripts");
const CDB = path.join(ROOT, "vendor/BabelCDB/cards.cdb");
const OUT = path.join(ROOT, "public/data");
// Card scripts are searched in this order; GOAT-specific versions win.
const SCRIPT_DIRS = ["goat", "official", "pre-errata", "unofficial"];

const pool = JSON.parse(readFileSync(path.join(ROOT, "data/pool.json"), "utf-8")).cards;

const db = new DatabaseSync(CDB, { readOnly: true });
const stmt = db.prepare(
  "SELECT d.id, d.alias, d.setcode, d.type, d.atk, d.def, d.level, d.race, d.attribute, t.name, t.desc " +
  "FROM datas d JOIN texts t ON t.id = d.id WHERE d.id = ?");
stmt.setReadBigInts(true);

const cards = [];
const missing = [];
for (const code of pool) {
  const r = stmt.get(code);
  if (!r) { missing.push(code); continue; }
  cards.push({
    code: Number(r.id), alias: Number(r.alias), setcode: r.setcode.toString(), type: Number(r.type),
    atk: Number(r.atk), def: Number(r.def), level: Number(r.level), race: r.race.toString(),
    attribute: Number(r.attribute), name: r.name, desc: r.desc,
  });
}

const scripts = {};
for (const f of readdirSync(SCRIPTS)) if (f.endsWith(".lua")) scripts[f] = readFileSync(path.join(SCRIPTS, f), "utf-8");
const noScript = [];
for (const c of cards) {
  const name = `c${c.code}.lua`;
  const dir = SCRIPT_DIRS.find((d) => existsSync(path.join(SCRIPTS, d, name)));
  if (dir) scripts[name] = readFileSync(path.join(SCRIPTS, dir, name), "utf-8");
  else if (c.type & 0x20 /* TYPE_EFFECT */ || c.type & 0x6 /* spell/trap */) noScript.push(c.code);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, "cards.json"), JSON.stringify(cards));
writeFileSync(path.join(OUT, "scripts.json"), JSON.stringify(scripts));
console.log(`cards: ${cards.length}, scripts: ${Object.keys(scripts).length}`);
if (missing.length) console.warn("not found in cards.cdb:", missing);
if (noScript.length) console.warn("effect/spell/trap cards without a script:", noScript);
