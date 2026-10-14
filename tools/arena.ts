// Brain vs brain: plays seeded duels for every deck pairing, with each brain going first and second, and reports win
// rates. Every claim about AI strength comes from here.
// Usage: npm run arena -- [--a autobot] [--b autobot] [--n 10] [--decks yugi,kaiba,goat] [--seed 1] [--lp 8000]
//        [--only K] [--trace] [--losses]
//   --n      duels per deck pairing and seat order (so 3 decks = 9 pairings x 2 orders x n)
//   --seed   base seed: duel k uses seed (base + k), so a run is repeatable
//   --only K play only duel k (with --trace: replay one duel's decisions)
//   --trace  print every decision of both brains
//   --losses list the duels A lost (replay one with --only K --trace)
import { AiSeat } from "../src/duel/ai/AiSeat.ts";
import { BRAINS, isBrainName, type BrainName } from "../src/duel/ai/brains.ts";
import { formatTrace } from "../src/duel/ai/trace.ts";
import { DECKS, type DeckName } from "../src/duel/decks.ts";
import { newDuel, runDuel, seedFrom } from "./lib/engine.ts";

const args = new Map<string, string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) continue;
  const next = argv[i + 1];
  args.set(argv[i].slice(2), next && !next.startsWith("--") ? argv[++i] : "");
}
const brainArg = (key: string): BrainName => {
  const name = args.get(key) ?? "autobot";
  if (!isBrainName(name)) throw new Error(`unknown brain "${name}" (have: ${Object.keys(BRAINS).join(", ")})`);
  return name;
};
const A = brainArg("a"), B = brainArg("b");
const n = Number(args.get("n") ?? 10);
const baseSeed = Number(args.get("seed") ?? 1);
const lp = args.has("lp") ? Number(args.get("lp")) : undefined;
const only = args.has("only") ? Number(args.get("only")) : null;
const trace = args.has("trace");
const listLosses = args.has("losses");
const losses: string[] = [];
const deckNames = (args.get("decks") ?? Object.keys(DECKS).join(",")).split(",") as DeckName[];
for (const d of deckNames) if (!(d in DECKS)) throw new Error(`unknown deck "${d}"`);

interface Row { aDeck: DeckName; bDeck: DeckName; aFirst: boolean; aWins: number; bWins: number; draws: number; turns: number; duels: number }
const rows: Row[] = [];
const think = { a: 0, b: 0 }, decisions = { a: 0, b: 0 };
let k = 0, errors = 0;
const started = performance.now();

for (const aDeck of deckNames) for (const bDeck of deckNames) for (const aFirst of [true, false]) {
  const row: Row = { aDeck, bDeck, aFirst, aWins: 0, bWins: 0, draws: 0, turns: 0, duels: 0 };
  rows.push(row);
  for (let i = 0; i < n; i++, k++) {
    if (only !== null && k !== only) continue;
    const seed = seedFrom(baseSeed + k);
    const aSeat = aFirst ? 0 : 1;
    const decks = aFirst ? [DECKS[aDeck].deck, DECKS[bDeck].deck] as const : [DECKS[bDeck].deck, DECKS[aDeck].deck] as const;
    const duel = newDuel({ decks: [...decks], seed, startingLP: lp, onCoreLog: () => {} });
    const label = `duel ${k} (seed ${baseSeed + k}): ${A} [${aDeck}] ${aFirst ? "first" : "second"} vs ${B} [${bDeck}]`;
    const onTrace = trace ? (e: Parameters<typeof formatTrace>[0]) => console.log(formatTrace(e)) : undefined;
    const seatOf = (seat: 0 | 1) =>
      new AiSeat({ seat, brain: BRAINS[seat === aSeat ? A : B](), duel, onTrace });
    try {
      if (trace) console.log(`--- ${label}`);
      const run = runDuel(duel, [seatOf(0), seatOf(1)]);
      row.duels++;
      row.turns += run.turns;
      if (run.winner === null) row.draws++;
      else if (run.winner === aSeat) row.aWins++;
      else { row.bWins++; losses.push(`${k} (${aDeck} ${aFirst ? "first" : "second"} vs ${bDeck}, ${run.turns} turns)`); }
      think.a += run.thinkMs[aSeat]; think.b += run.thinkMs[1 - aSeat];
      decisions.a += run.decisions[aSeat]; decisions.b += run.decisions[1 - aSeat];
      if (trace) console.log(`--- winner: ${run.winner === null ? "draw" : run.winner === aSeat ? `A (${A})` : `B (${B})`}`);
    } catch (e) {
      errors++;
      console.error(`${label} FAILED:`, e);
    } finally {
      duel.destroy();
    }
  }
}

const played = rows.filter((r) => r.duels);
const pct = (x: number, of: number) => (of ? `${((100 * x) / of).toFixed(0)}%` : "-");
console.log(`\nA = ${A}, B = ${B}: ${n} duels per pairing and seat order, seeds ${baseSeed}..${baseSeed + k - 1}`);
console.log("A deck  B deck  A goes  A wins        avg turns");
for (const r of played) {
  console.log(`${r.aDeck.padEnd(7)} ${r.bDeck.padEnd(7)} ${(r.aFirst ? "first" : "second").padEnd(7)} ${`${r.aWins}/${r.duels}`.padEnd(6)} ${pct(r.aWins, r.duels).padStart(5)}   ${(r.turns / r.duels).toFixed(1)}`);
}
const total = played.reduce((s, r) => s + r.duels, 0);
const aWins = played.reduce((s, r) => s + r.aWins, 0);
const draws = played.reduce((s, r) => s + r.draws, 0);
const p = total ? aWins / total : 0;
const margin = total ? 196 * Math.sqrt((p * (1 - p)) / total) : 0;
console.log(`\nA won ${aWins}/${total} = ${(100 * p).toFixed(1)}% (±${margin.toFixed(1)}%, 95%), draws ${draws}, errors ${errors}`);
const ms = (t: number, d: number) => (d ? (t / d).toFixed(3) : "-");
console.log(`think time: A ${ms(think.a, decisions.a)} ms/decision, B ${ms(think.b, decisions.b)} ms/decision; ` +
  `${(total / ((performance.now() - started) / 1000)).toFixed(1)} duels/s`);
if (listLosses) console.log(`
A lost: ${losses.join(", ") || "none"}`);
if (errors) process.exit(1);
