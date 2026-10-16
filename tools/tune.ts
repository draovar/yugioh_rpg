// Tunes the AI's weights (src/duel/ai/board.ts) by self-play: each round changes 1-3 weights of the current best at
// random, plays the variant against the current best (same brain, every deck pairing, both seat orders, fresh seeds),
// and keeps it only if it wins clearly. A quick first stage weeds out losers; promising variants play a longer second
// stage. Results go to vendor/tune/ (gitignored): best.json (resumed on the next run) and log.jsonl.
// Usage: npm run tune -- [--brain planner] [--rounds 20] [--quick 10] [--long 30] [--seed 1] [--jobs N]
//   --quick / --long  duels per deck pairing and seat order in the first / second stage (x18 duels each)
// Afterwards: compare best.json with the built-in weights (`npm run arena -- --a sim --b sim --wa vendor/tune/best.json`)
// and copy the winners into DEFAULT_WEIGHTS by hand.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { DEFAULT_WEIGHTS, type Weights } from "../src/duel/ai/board.ts";
import { isBrainName, type BrainName } from "../src/duel/ai/brains.ts";
import { DECKS, type DeckName } from "../src/duel/decks.ts";
import { mulberry32 } from "../src/duel/rng.ts";
import { matchJobs, runMatch, winRate, type Result } from "./lib/match.ts";

const args = new Map<string, string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) continue;
  const next = argv[i + 1];
  args.set(argv[i].slice(2), next && !next.startsWith("--") ? argv[++i] : "");
}
const brain = (args.get("brain") ?? "planner") as BrainName;
if (!isBrainName(brain)) throw new Error(`unknown brain ${brain}`);
const rounds = Number(args.get("rounds") ?? 20);
const quick = Number(args.get("quick") ?? 10);
const long = Number(args.get("long") ?? 30);
const threads = Number(args.get("jobs") ?? availableParallelism());
const rng = mulberry32(Number(args.get("seed") ?? 1));
const decks = Object.keys(DECKS) as DeckName[];

/** First stage: drop the variant below this; overall: keep it at or above ACCEPT. */
const QUICK_PASS = 0.52;
const ACCEPT = 0.535;

const OUT = path.resolve(import.meta.dirname, "../vendor/tune");
mkdirSync(OUT, { recursive: true });
const BEST = path.join(OUT, "best.json");
const LOG = path.join(OUT, "log.jsonl");
let best: Weights = { ...DEFAULT_WEIGHTS, ...(existsSync(BEST) ? JSON.parse(readFileSync(BEST, "utf-8")) as Partial<Weights> : {}) };
const keys = Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[];

/** 1-3 weights of `w` multiplied by a random factor (log-normal, about ±30%). */
function mutate(w: Weights): { next: Weights; changed: string[] } {
  const next = { ...w };
  const changed: string[] = [];
  const count = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i++) {
    const key = keys[Math.floor(rng() * keys.length)];
    const gauss = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
    next[key] = Number((next[key] * Math.exp(0.3 * gauss)).toPrecision(3));
    changed.push(`${key} ${w[key]} -> ${next[key]}`);
  }
  return { next, changed };
}

/** Variant (A) vs current best (B). */
async function match(variant: Weights, n: number, baseSeed: number): Promise<Result[]> {
  return runMatch(matchJobs(decks, n), { A: brain, B: brain, weightsA: variant, weightsB: best, baseSeed }, threads);
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
console.log(`tuning ${brain}: ${rounds} rounds, ${quick * 18} + ${long * 18} duels per promising variant, ${threads} threads`);
for (let round = 0; round < rounds; round++) {
  const started = performance.now();
  const { next, changed } = mutate(best);
  const seed = 1_000_000 + Math.floor(rng() * 1e9);
  const first = await match(next, quick, seed);
  let all = first;
  let verdict = "dropped";
  if (winRate(first).rate >= QUICK_PASS) {
    all = [...first, ...(await match(next, long, seed + 100_000))];
    if (winRate(all).rate >= ACCEPT) {
      best = next;
      writeFileSync(BEST, JSON.stringify(best, null, 2));
      verdict = "KEPT";
    } else verdict = "not enough";
  }
  const w = winRate(all);
  const errors = all.filter((r) => r.outcome === "error").length;
  console.log(`round ${round + 1}: ${changed.join(", ")} | ${pct(w.rate)} ±${pct(w.margin)} over ${w.played} | ${verdict}` +
    `${errors ? ` | ${errors} errors` : ""} (${((performance.now() - started) / 1000).toFixed(0)} s)`);
  appendFileSync(LOG, JSON.stringify({ round, brain, changed, rate: w.rate, played: w.played, verdict, errors, weights: next }) + "\n");
}
console.log(`best weights so far: ${BEST}`);
