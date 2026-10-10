// Headless sanity check: plays N full GOAT-format duels between two auto-bots
// through the same DuelSession + data files the browser game uses.
// Usage: npm run smoke [-- <duels>]     (needs `npm run build-data` first)
import { readFileSync } from "node:fs";
import path from "node:path";
import createCore, { OcgMessageType } from "ocgcore-wasm";
import { CardDb, type CardRecord } from "../src/duel/cardData.ts";
import { DuelSession } from "../src/duel/DuelSession.ts";
import { autoRespond } from "../src/duel/autoBot.ts";

const DATA = path.resolve(import.meta.dirname, "../public/data");
const records: CardRecord[] = JSON.parse(readFileSync(path.join(DATA, "cards.json"), "utf-8"));
const scripts: Record<string, string> = JSON.parse(readFileSync(path.join(DATA, "scripts.json"), "utf-8"));
const cards = new CardDb(records);

// 2 copies of every card in the pool, padded to 40 with normal monsters.
const pool = records.map((r) => r.code);
const main = [...pool, ...pool];
while (main.length < 40) main.push(91152256); // Celtic Guardian
const deck = { main: main.slice(0, 40) };

const core = await createCore({ sync: true });
const runs = Number(process.argv[2] ?? 5);
let failures = 0;
for (let i = 0; i < runs; i++) {
  const warnings: string[] = [];
  const duel = new DuelSession({
    core, cards, decks: [deck, deck],
    readScript: (name) => scripts[path.basename(name)] ?? null,
    onCoreLog: (_t, text) => warnings.push(text),
  });
  let turns = 0, msgs = 0, decisions = 0, winner: number | null = null;
  try {
    for (;;) {
      const step = duel.advance();
      msgs += step.messages.length;
      turns += step.messages.filter((m) => m.type === OcgMessageType.NEW_TURN).length;
      if (step.ended) { winner = step.winner; break; }
      if (++decisions > 20_000) throw new Error("duel did not finish");
      duel.respond(autoRespond(step.prompt!));
    }
    console.log(`duel ${i + 1}: winner P${winner}, ${turns} turns, ${msgs} messages, ${decisions} decisions`);
  } catch (e) {
    failures++;
    console.error(`duel ${i + 1} FAILED:`, e);
  } finally {
    duel.destroy();
  }
  for (const w of new Set(warnings)) console.warn("  [ocgcore]", w);
}
if (failures) process.exit(1);
