// Builds the browser-side game data from the vendored Project Ignis repos:
//   public/data/cards.json   – stats + text for every card in data/pool.json, plus the tokens they create
//   public/data/scripts.json – { fileName: luaSource } for engine utility scripts + pool card scripts
//   public/data/strings.json – { system: { id: text }, counter: { type: name }, victory: { reason: text } } from EDOPro's strings.conf
// Run `npm run fetch-data` first.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SCRIPTS = path.join(ROOT, "vendor/CardScripts");
const CDB = path.join(ROOT, "vendor/BabelCDB/cards.cdb");
const OUT = path.join(ROOT, "public/data");
// Card scripts by passcode, searched in this order. The goat/ and pre-errata/ versions use codes of their own: see
// `variants` below.
const SCRIPT_DIRS = ["official", "unofficial"];

const pool = JSON.parse(readFileSync(path.join(ROOT, "data/pool.json"), "utf-8")).cards;

const db = new DatabaseSync(CDB, { readOnly: true });
const stmt = db.prepare(
  "SELECT d.id, d.alias, d.setcode, d.type, d.atk, d.def, d.level, d.race, d.attribute, t.* " +
  "FROM datas d JOIN texts t ON t.id = d.id WHERE d.id = ?");
stmt.setReadBigInts(true);

// Older versions: cards play their modern version, except those data/card-versions.json picks. CardScripts' goat/
// and pre-errata/ folders script older versions under codes of their own, whose database entries
// (goat-entries.cdb, cards-unofficial.cdb) alias the real card. A picked card gets that script, text and card type
// (Metalmorph's pre-errata version is a Continuous Trap) under the real passcode, so decks keep real codes.
// Stats stay official: a few pre-errata entries carry misprint values. With two pre-errata versions (Ring of
// Destruction, Crush Card Virus: they play the same) the lowest code wins.
const picked = JSON.parse(readFileSync(path.join(ROOT, "data/card-versions.json"), "utf-8"));
const variantDbs = { goat: "goat-entries.cdb", "pre-errata": "cards-unofficial.cdb" };
const variants = new Map(); // real code -> { file, row }
for (const [dir, cdb] of Object.entries(variantDbs)) {
  const vdb = new DatabaseSync(path.join(path.dirname(CDB), cdb), { readOnly: true });
  const byAlias = vdb.prepare("SELECT d.id, d.alias, d.type, t.* FROM datas d JOIN texts t ON t.id = d.id WHERE d.alias = ? ORDER BY d.id");
  for (const name of Object.keys(picked[dir])) {
    const base = db.prepare("SELECT d.id FROM datas d JOIN texts t ON t.id = d.id WHERE t.name = ? AND d.alias = 0").get(name);
    if (!base) throw new Error(`card-versions.json: no card named "${name}" in cards.cdb`);
    const code = Number(base.id);
    if (variants.has(code)) throw new Error(`card-versions.json: "${name}" is picked twice`);
    if (!pool.includes(code)) throw new Error(`card-versions.json: "${name}" is not in the pool`);
    const row = byAlias.all(code).find((r) => existsSync(path.join(SCRIPTS, dir, `c${r.id}.lua`)));
    if (!row) throw new Error(`card-versions.json: "${name}" has no ${dir} version`);
    variants.set(code, { file: path.join(SCRIPTS, dir, `c${row.id}.lua`), row });
  }
}

const record = (r) => ({
  code: Number(r.id), alias: Number(r.alias), setcode: r.setcode.toString(), type: Number(r.type),
  atk: Number(r.atk), def: Number(r.def), level: Number(r.level), race: r.race.toString(),
  attribute: Number(r.attribute), name: r.name, desc: r.desc, strings: strings(r),
});
// str1..str16: effect descriptions referenced by aux.Stringid(code, n) -> strings[n]
const strings = (r) => Array.from({ length: 16 }, (_, i) => r[`str${i + 1}`] ?? "");

const cards = [];
const missing = [];
for (const code of pool) {
  const r = stmt.get(code);
  if (!r) { missing.push(code); continue; }
  const v = variants.get(code);
  // The variant's name carries a " (GOAT)" / " (Pre-Errata)" suffix: keep the real one.
  cards.push(v ? { ...record(r), type: Number(v.row.type), desc: v.row.desc, strings: strings(v.row) } : record(r));
}

const scripts = {};
for (const f of readdirSync(SCRIPTS)) if (f.endsWith(".lua")) scripts[f] = readFileSync(path.join(SCRIPTS, f), "utf-8");
const noScript = [];
for (const c of cards) {
  const name = `c${c.code}.lua`;
  const dir = SCRIPT_DIRS.find((d) => existsSync(path.join(SCRIPTS, d, name)));
  const variant = variants.get(c.code);
  if (variant) scripts[name] = readFileSync(variant.file, "utf-8");
  else if (dir) scripts[name] = readFileSync(path.join(SCRIPTS, dir, name), "utf-8");
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
const victory = {}; // win reason (decimal) -> text, e.g. 21: 'Victory by the effect of "Destiny Board"'
for (const line of readFileSync(path.join(ROOT, "vendor/strings.conf"), "utf-8").split("\n")) {
  const l = line.trimEnd();
  const m = l.match(/^!system (\d+) (.*)$/);
  if (m) system[m[1]] = m[2];
  const c = l.match(/^!counter (0x[0-9a-f]+) (.*)$/i);
  if (c) counter[parseInt(c[1], 16)] = c[2];
  const v = l.match(/^!victory (0x[0-9a-f]+) (.*)$/i);
  if (v) victory[parseInt(v[1], 16)] = v[2];
}

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, "strings.json"), JSON.stringify({ system, counter, victory }));
writeFileSync(path.join(OUT, "cards.json"), JSON.stringify(cards));
writeFileSync(path.join(OUT, "scripts.json"), JSON.stringify(scripts));
console.log(`cards: ${cards.length - tokens.size} + ${tokens.size} tokens (${variants.size} in an older version: card-versions.json` +
  `), scripts: ${Object.keys(scripts).length}`);
if (missing.length) console.warn("not found in cards.cdb:", missing);
if (noScript.length) console.warn("effect/spell/trap cards without a script:", noScript);
