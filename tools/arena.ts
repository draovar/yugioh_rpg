// Brain vs brain: plays seeded duels for every deck pairing, with each brain going first and second, and reports win
// rates. Every claim about AI strength comes from here. Duels run in parallel worker threads (one engine each).
// Usage: npm run arena -- [--a autobot] [--b autobot] [--n 10] [--decks yugi,kaiba,goat] [--seed 1] [--lp 8000]
//        [--jobs N] [--only K] [--trace] [--sim-trace] [--losses]
//   --n      duels per deck pairing and seat order (so 3 decks = 9 pairings x 2 orders x n)
//   --seed   base seed: duel k uses seed (base + k), so a run is repeatable
//   --jobs   worker threads (default: one per CPU core; traces always run in one)
//   --only K play only duel k (with --trace: replay one duel's decisions)
//   --trace  print every decision of both brains
//   --sim-trace  also print the decisions inside the simulated copies (with --trace)
//   --losses list the duels A lost (replay one with --only K --trace)
import { availableParallelism } from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { AiSeat } from "../src/duel/ai/AiSeat.ts";
import { BRAINS, isBrainName, type BrainName } from "../src/duel/ai/brains.ts";
import { Simulator } from "../src/duel/ai/sim/simulator.ts";
import { formatTrace } from "../src/duel/ai/trace.ts";
import { DECKS, type DeckName } from "../src/duel/decks.ts";
import { cards, core, newDuel, readScript, runDuel, seedFrom } from "./lib/engine.ts";

interface Job { k: number; aDeck: DeckName; bDeck: DeckName; aFirst: boolean }
interface Settings { A: BrainName; B: BrainName; baseSeed: number; lp?: number; trace: boolean }
interface Result extends Job {
  outcome: "a" | "b" | "draw" | "error";
  error?: string;
  turns: number;
  /** [A, B] */
  think: [number, number];
  decisions: [number, number];
  slowest: [number, number];
}

/** Plays one duel. A = brain `A` with `aDeck`; it goes first when `aFirst`. */
function play(job: Job, s: Settings): Result {
  const { k, aDeck, bDeck, aFirst } = job;
  const aSeat = aFirst ? 0 : 1;
  const decks = aFirst ? [DECKS[aDeck].deck, DECKS[bDeck].deck] : [DECKS[bDeck].deck, DECKS[aDeck].deck];
  const duel = newDuel({ decks: [decks[0], decks[1]], seed: seedFrom(s.baseSeed + k), startingLP: s.lp, onCoreLog: () => {} });
  const onTrace = s.trace ? (e: Parameters<typeof formatTrace>[0]) => console.log(formatTrace(e)) : undefined;
  const seatOf = (seat: 0 | 1) => new AiSeat({
    seat, brain: BRAINS[seat === aSeat ? s.A : s.B]({ engine: { core, cards, readScript } }), duel, onTrace, deck: decks[seat].main,
  });
  const result: Result = { ...job, outcome: "error", turns: 0, think: [0, 0], decisions: [0, 0], slowest: [0, 0] };
  const ab = <T,>(pair: [T, T]): [T, T] => (aSeat === 0 ? pair : [pair[1], pair[0]]);
  try {
    if (s.trace) console.log(`--- duel ${k} (seed ${s.baseSeed + k}): ${s.A} [${aDeck}] ${aFirst ? "first" : "second"} vs ${s.B} [${bDeck}]`);
    const run = runDuel(duel, [seatOf(0), seatOf(1)]);
    result.outcome = run.winner === null ? "draw" : run.winner === aSeat ? "a" : "b";
    result.turns = run.turns;
    result.think = ab(run.thinkMs);
    result.decisions = ab(run.decisions);
    result.slowest = ab(run.maxMs);
    if (s.trace) console.log(`--- winner: ${result.outcome === "draw" ? "draw" : result.outcome === "a" ? `A (${s.A})` : `B (${s.B})`}`);
  } catch (e) {
    result.error = String(e instanceof Error ? e.stack ?? e.message : e);
  } finally {
    duel.destroy();
  }
  return result;
}

if (!isMainThread) {
  const { jobs, settings } = workerData as { jobs: Job[]; settings: Settings };
  parentPort!.postMessage(jobs.map((j) => play(j, settings)));
} else {
  await main();
}

async function main(): Promise<void> {
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
  const settings: Settings = {
    A: brainArg("a"), B: brainArg("b"), baseSeed: Number(args.get("seed") ?? 1),
    lp: args.has("lp") ? Number(args.get("lp")) : undefined, trace: args.has("trace"),
  };
  const n = Number(args.get("n") ?? 10);
  const only = args.has("only") ? Number(args.get("only")) : null;
  if (args.has("sim-trace")) Simulator.debug = (line) => console.log(line);
  const deckNames = (args.get("decks") ?? Object.keys(DECKS).join(",")).split(",") as DeckName[];
  for (const d of deckNames) if (!(d in DECKS)) throw new Error(`unknown deck "${d}"`);

  // Every pairing and seat order, n duels each; duel k always gets the same seed and setup.
  const all: Job[] = [];
  for (const aDeck of deckNames) for (const bDeck of deckNames) for (const aFirst of [true, false])
    for (let i = 0; i < n; i++) all.push({ k: all.length, aDeck, bDeck, aFirst });
  const jobs = only === null ? all : all.filter((j) => j.k === only);

  const started = performance.now();
  const workers = settings.trace || Simulator.debug ? 1 : Math.min(Number(args.get("jobs") ?? availableParallelism()), jobs.length);
  let results: Result[];
  if (workers <= 1) {
    results = jobs.map((j) => play(j, settings));
  } else {
    const shares = Array.from({ length: workers }, (_, w) => jobs.filter((_j, i) => i % workers === w));
    results = (await Promise.all(shares.map((share) => new Promise<Result[]>((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { jobs: share, settings } });
      worker.once("message", resolve);
      worker.once("error", reject);
    })))).flat().sort((a, b) => a.k - b.k);
  }
  report(results, settings, n, args.has("losses"), (performance.now() - started) / 1000, workers);
}

function report(results: Result[], s: Settings, n: number, listLosses: boolean, seconds: number, workers: number): void {
  for (const r of results) if (r.outcome === "error") console.error(`duel ${r.k} (seed ${s.baseSeed + r.k}) FAILED: ${r.error}`);
  const played = results.filter((r) => r.outcome !== "error");
  const pct = (x: number, of: number) => (of ? `${((100 * x) / of).toFixed(0)}%` : "-");
  console.log(`\nA = ${s.A}, B = ${s.B}: ${n} duels per pairing and seat order, seeds from ${s.baseSeed}`);
  console.log("A deck  B deck  A goes  A wins        avg turns");
  const groups = new Map<string, Result[]>();
  for (const r of played) {
    const key = `${r.aDeck.padEnd(7)} ${r.bDeck.padEnd(7)} ${(r.aFirst ? "first" : "second").padEnd(7)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const [key, rs] of groups) {
    const wins = rs.filter((r) => r.outcome === "a").length;
    console.log(`${key} ${`${wins}/${rs.length}`.padEnd(6)} ${pct(wins, rs.length).padStart(5)}   ${(rs.reduce((t, r) => t + r.turns, 0) / rs.length).toFixed(1)}`);
  }
  const aWins = played.filter((r) => r.outcome === "a").length;
  const draws = played.filter((r) => r.outcome === "draw").length;
  const errors = results.length - played.length;
  const p = played.length ? aWins / played.length : 0;
  const margin = played.length ? 196 * Math.sqrt((p * (1 - p)) / played.length) : 0;
  console.log(`\nA won ${aWins}/${played.length} = ${(100 * p).toFixed(1)}% (±${margin.toFixed(1)}%, 95%), draws ${draws}, errors ${errors}`);
  const sum = (f: (r: Result) => number) => played.reduce((t, r) => t + f(r), 0);
  const per = (t: number, d: number) => (d ? (t / d).toFixed(3) : "-");
  const slow = (i: 0 | 1) => Math.max(0, ...played.map((r) => r.slowest[i])).toFixed(0);
  console.log(`think time: A ${per(sum((r) => r.think[0]), sum((r) => r.decisions[0]))} ms/decision (slowest ${slow(0)} ms), ` +
    `B ${per(sum((r) => r.think[1]), sum((r) => r.decisions[1]))} ms/decision (slowest ${slow(1)} ms); ` +
    `${(played.length / seconds).toFixed(1)} duels/s on ${workers} thread${workers > 1 ? "s" : ""}`);
  if (listLosses) {
    const lost = played.filter((r) => r.outcome === "b").map((r) => `${r.k} (${r.aDeck} ${r.aFirst ? "first" : "second"} vs ${r.bDeck}, ${r.turns} turns)`);
    console.log(`\nA lost: ${lost.join(", ") || "none"}`);
  }
  if (errors) process.exit(1);
}
