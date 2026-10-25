// Lists the pool cards whose scripts use mechanics the duel UI doesn't fully support yet, so a new batch
// of cards can be checked before it goes in. Reads the built data (run `npm run build-data` first).
// Usage: npm run check-cards
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const cards = JSON.parse(readFileSync(path.join(ROOT, "public/data/cards.json"), "utf-8"));
const scripts = JSON.parse(readFileSync(path.join(ROOT, "public/data/scripts.json"), "utf-8"));
const pool = new Set(JSON.parse(readFileSync(path.join(ROOT, "data/pool.json"), "utf-8")).cards);

/** What each mechanic means for the game today. Update as the UI catches up. */
const MECHANICS = [
  { key: "declare", test: /Announce(Card|Number|Race|Attribute|Level|Type)/, status: "works: Type / Attribute / number dialogs, card-name picker" },
  { key: "sort", test: /SortDeck(top|bottom)/, status: "works: click-to-number ordering dialog" },
  { key: "rps", test: /RockPaperScissors/, status: "UI missing: the random bot picks for you" },
  { key: "counter", test: /AddCounter|EnableCounterPermit/, status: "works; total shown as a number badge (kinds not told apart)" },
  { key: "equip", test: /Duel\.Equip|EFFECT_EQUIP|aux\.AddEquipProcedure/, status: "works; hover shows the equip link (Equip Spell icon on the partner card)" },
  { key: "coin/dice", test: /Toss(Coin|Dice)|CallCoin|AnnounceCoin/, status: "works; coin/dice animation + log line, coin call dialog" },
  { key: "token", test: /CreateToken/, status: "works if build-data exported its tokens (see below)" },
];
const TYPE = { fusion: 0x40, ritual: 0x80, token: 0x4000 };

const byMechanic = new Map(MECHANICS.map((m) => [m.key, []]));
const extra = [], ritual = [], noScript = [];
for (const c of cards) {
  if (!pool.has(c.code)) continue;
  const src = scripts[`c${c.code}.lua`];
  if (!src) {
    if (c.type & 0x20 || c.type & 0x6) noScript.push(c.name); // effect monster, spell or trap
    continue;
  }
  for (const m of MECHANICS) if (m.test.test(src)) byMechanic.get(m.key).push(c.name);
  if (c.type & TYPE.fusion) extra.push(c.name);
  if (c.type & TYPE.ritual) ritual.push(c.name);
}

const section = (title, names) => names.length && console.log(`\n${title} (${names.length})\n  ${names.sort().join(", ")}`);
console.log(`${pool.size} pool cards, ${cards.filter((c) => c.type & TYPE.token).length} tokens exported`);
section("NO SCRIPT (effects won't work)", noScript);
for (const m of MECHANICS) section(`${m.key}: ${m.status}`, byMechanic.get(m.key));
section("fusion: Extra Deck card; needs a deck with it in `extra`", extra);
section("ritual: needs its Ritual Spell in the pool", ritual);
console.log(`\ntokens: ${cards.filter((c) => c.type & TYPE.token).map((c) => `${c.name} (${c.code})`).join(", ") || "none"}`);
