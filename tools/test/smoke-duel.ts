// Headless sanity check: plays N full GOAT-format duels between two auto-bots through the same DuelSession + data
// files the browser game uses, after checking that every deck is legal: the named decks (decks.ts), the prebuilt ones
// and the shops' starter / structure decks (revisions applied). Duel i puts named deck i against the next one, then
// the one after (the second time around), so the first N duels bring N different decks. The bots play through
// AiSeat, like the game's AI.
// Usage: npm run smoke [-- <duels>]     (needs `npm run build-data` first)
import { AiSeat } from "../../src/duel/ai/AiSeat.ts";
import { autoBotBrain } from "../../src/duel/ai/brains.ts";
import { deckProblems, namedDecks } from "../../src/duel/decks/decks.ts";
import { cards, newDuel, runDuel } from "../lib/engine.ts";

const decks = namedDecks();
let bad = false;
for (const { key, deck } of decks) {
  const problems = deckProblems(deck, cards);
  if (problems.length) { bad = true; console.error(`deck ${key}: ${problems.join("; ")}`); }
}
if (bad) process.exit(1);
/** Duel i's two decks: deck i (wrapping) against the deck 1 + (rounds done) after it. */
const pairing = (i: number) => {
  const a = i % decks.length;
  return [decks[a], decks[(a + 1 + Math.floor(i / decks.length)) % decks.length]] as const;
};

const runs = Number(process.argv[2] ?? 5);
let failures = 0;
for (let i = 0; i < runs; i++) {
  const warnings: string[] = [];
  const [p0, p1] = pairing(i);
  const duel = newDuel({ decks: [p0.deck, p1.deck], onCoreLog: (_t, text) => warnings.push(text) });
  const seats = [new AiSeat({ seat: 0, brain: autoBotBrain, duel }), new AiSeat({ seat: 1, brain: autoBotBrain, duel })] as const;
  try {
    const run = runDuel(duel, seats);
    console.log(`duel ${i + 1} (${p0.key} vs ${p1.key}): winner P${run.winner}, ${run.turns} turns, ${run.messages} messages, ${run.decisions[0] + run.decisions[1]} decisions`);
  } catch (e) {
    failures++;
    console.error(`duel ${i + 1} FAILED:`, e);
  } finally {
    duel.destroy();
  }
  for (const w of new Set(warnings)) console.warn("  [ocgcore]", w);
}
if (failures) process.exit(1);
