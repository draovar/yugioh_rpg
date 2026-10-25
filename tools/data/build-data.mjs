// Builds the browser-side game data from the vendored Project Ignis repos:
//   public/data/cards.json   – stats + text for every card in data/pool.json, plus the tokens they create
//   public/data/scripts.json – { fileName: luaSource } for engine utility scripts + pool card scripts
//   public/data/strings.json – { system: { id: text }, counter: { type: name } } from EDOPro's strings.conf
// Run `npm run fetch-data` first.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SCRIPTS = path.join(ROOT, "vendor/CardScripts");
const CDB = path.join(ROOT, "vendor/BabelCDB/cards.cdb");
const OUT = path.join(ROOT, "public/data");
// Card scripts are searched in this order; GOAT-specific versions win.
const SCRIPT_DIRS = ["goat", "official", "pre-errata", "unofficial"];

const pool = JSON.parse(readFileSync(path.join(ROOT, "data/pool.json"), "utf-8")).cards;

const db = new DatabaseSync(CDB, { readOnly: true });
const stmt = db.prepare(
  "SELECT d.id, d.alias, d.setcode, d.type, d.atk, d.def, d.level, d.race, d.attribute, t.* " +
  "FROM datas d JOIN texts t ON t.id = d.id WHERE d.id = ?");
stmt.setReadBigInts(true);

const record = (r) => ({
  code: Number(r.id), alias: Number(r.alias), setcode: r.setcode.toString(), type: Number(r.type),
  atk: Number(r.atk), def: Number(r.def), level: Number(r.level), race: r.race.toString(),
  attribute: Number(r.attribute), name: r.name, desc: r.desc,
  // str1..str16: effect descriptions referenced by aux.Stringid(code, n) -> strings[n]
  strings: Array.from({ length: 16 }, (_, i) => r[`str${i + 1}`] ?? ""),
});

const cards = [];
const missing = [];
for (const code of pool) {
  const r = stmt.get(code);
  if (!r) { missing.push(code); continue; }
  cards.push(record(r));
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

// Tokens: scripts create them by passcode (Duel.CreateToken), usually their own code + 1..n (`id+1`) or a
// listed number, and the engine needs their data like any card's. Exported alongside the pool (TYPE_TOKEN set),
// but they are not pool cards: no deck may contain them.
const TYPE_TOKEN = 0x4000n;
const tokens = new Set();
for (const c of cards) {
  const src = scripts[`c${c.code}.lua`];
  if (!src?.includes("CreateToken")) continue;
  const candidates = [...src.matchAll(/\b\d{5,9}\b/g)].map((m) => Number(m[0]));
  for (let i = 1; i <= 8; i++) candidates.push(c.code + i);
  for (const id of candidates) {
    const r = stmt.get(id);
    if (r && BigInt(r.type) & TYPE_TOKEN && !pool.includes(id) && !tokens.has(id)) {
      tokens.add(id);
      cards.push(record(r));
    }
  }
}

const system = {};
const counter = {}; // counter type (decimal) -> name, e.g. 1: "Spell Counter"
for (const line of readFileSync(path.join(ROOT, "vendor/strings.conf"), "utf-8").split("\n")) {
  const m = line.trimEnd().match(/^!system (\d+) (.*)$/);
  if (m) system[m[1]] = m[2];
  const c = line.trimEnd().match(/^!counter (0x[0-9a-f]+) (.*)$/i);
  if (c) counter[parseInt(c[1], 16)] = c[2];
}

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, "strings.json"), JSON.stringify({ system, counter }));
writeFileSync(path.join(OUT, "cards.json"), JSON.stringify(cards));
writeFileSync(path.join(OUT, "scripts.json"), JSON.stringify(scripts));
console.log(`cards: ${cards.length - tokens.size} + ${tokens.size} tokens, scripts: ${Object.keys(scripts).length}`);
if (missing.length) console.warn("not found in cards.cdb:", missing);
if (noScript.length) console.warn("effect/spell/trap cards without a script:", noScript);
