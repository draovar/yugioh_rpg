// Headless sanity check: plays N full GOAT-format duels between two auto-bots
// through the same DuelSession + data files the browser game uses, cycling through every pairing of the
// prebuilt decks (decks.ts), after checking that each deck is legal (the banlist only listed: prebuilt decks are exempt). The bots play through AiSeat, like the game's AI.
// Usage: npm run smoke [-- <duels>]     (needs `npm run build-data` first)
import { AiSeat } from "../../src/duel/ai/AiSeat.ts";
import { autoBotBrain } from "../../src/duel/ai/brains.ts";
import { DECKS, banlistProblems, deckProblems, type DeckName } from "../../src/duel/decks/decks.ts";
import { cards, newDuel, runDuel } from "../lib/engine.ts";

const names = Object.keys(DECKS) as DeckName[];
let bad = false;
for (const name of names) {
  const problems = deckProblems(DECKS[name].deck, cards);
  if (problems.length) { bad = true; console.error(`deck ${name}: ${problems.join("; ")}`); }
  // Prebuilt decks are exempt from the banlist: listed for information only.
  const banned = banlistProblems(DECKS[name].deck, cards);
  if (banned.length) console.log(`deck ${name} (banlist, allowed for prebuilt decks): ${banned.join("; ")}`);
}
if (bad) process.exit(1);
// Every ordered pairing (both players can go first), then around again.
const pairings = names.flatMap((a) => names.map((b) => [a, b] as const));

const runs = Number(process.argv[2] ?? 5);
let failures = 0;
for (let i = 0; i < runs; i++) {
  const warnings: string[] = [];
  const [p0, p1] = pairings[i % pairings.length];
  const duel = newDuel({ decks: [DECKS[p0].deck, DECKS[p1].deck], onCoreLog: (_t, text) => warnings.push(text) });
  const seats = [new AiSeat({ seat: 0, brain: autoBotBrain, duel }), new AiSeat({ seat: 1, brain: autoBotBrain, duel })] as const;
  try {
    const run = runDuel(duel, seats);
    console.log(`duel ${i + 1} (${p0} vs ${p1}): winner P${run.winner}, ${run.turns} turns, ${run.messages} messages, ${run.decisions[0] + run.decisions[1]} decisions`);
  } catch (e) {
    failures++;
    console.error(`duel ${i + 1} FAILED:`, e);
  } finally {
    duel.destroy();
  }
  for (const w of new Set(warnings)) console.warn("  [ocgcore]", w);
}
if (failures) process.exit(1);
