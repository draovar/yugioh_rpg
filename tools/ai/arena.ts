// Brain vs brain: plays seeded duels for every deck pairing, with each brain going first and second, and reports win
// rates. Every claim about AI strength comes from here. Duels run in parallel worker threads (tools/lib/match.ts).
// Usage: npm run arena -- [--a autobot] [--b autobot] (or baseline: the planner in vendor/baseline, an older checkout) [--n 10] [--decks yugi,kaiba,goat] [--seed 1] [--lp 8000]
//        [--wa weights.json] [--wb weights.json] [--jobs N] [--only K] [--trace] [--sim-trace] [--losses] [--stats]
//        [--record positions.jsonl]
//   --n      duels per deck pairing and seat order (so 3 decks = 9 pairings x 2 orders x n)
//   --seed   base seed: duel k uses seed (base + k), so a run is repeatable
//   --wa/wb  weights for A / B (a JSON file with any of board.ts's Weights; the rest stay default)
//   --jobs   worker threads (default: one per CPU core; traces always run in one)
//   --only K play only duel k (with --trace: replay one duel's decisions)
//   --trace  print every decision of both brains
//   --sim-trace  also print the decisions inside the simulated copies (with --trace)
//   --losses list the duels A lost (replay one with --only K --trace)
//   --record write every turn's starting position and who won, one JSON line each (input of tools/ai/fit-eval.ts)
//   --stats  passivity per side, per 100 of its own turns: skipped Normal Summons/Sets, turns ended with an empty
//            field (opponent holding cards), Spells/Traps it could play left in hand, attacks into set Spells/Traps;
//            plus Spells/Traps in hand at the duel's end, per duel
import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { DEFAULT_WEIGHTS, type Weights } from "../../src/duel/ai/board.ts";
import { BRAINS } from "../../src/duel/ai/brains.ts";
import { Simulator } from "../../src/duel/ai/sim/simulator.ts";
import { DECKS, type DeckName } from "../../src/duel/decks/decks.ts";
import { isMatchBrain, matchJobs, runMatch, winRate, type MatchBrain, type MatchSettings, type PassivityStats, type Result } from "../lib/match.ts";

const args = new Map<string, string>();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) continue;
  const next = argv[i + 1];
  args.set(argv[i].slice(2), next && !next.startsWith("--") ? argv[++i] : "");
}
const brainArg = (key: string): MatchBrain => {
  const name = args.get(key) ?? "autobot";
  if (!isMatchBrain(name)) throw new Error(`unknown brain "${name}" (have: ${Object.keys(BRAINS).join(", ")}, baseline with vendor/baseline)`);
  return name;
};
const weightsArg = (key: string): Weights | undefined =>
  args.get(key) ? { ...DEFAULT_WEIGHTS, ...(JSON.parse(readFileSync(args.get(key)!, "utf-8")) as Partial<Weights>) } : undefined;
const settings: MatchSettings = {
  A: brainArg("a"), B: brainArg("b"), weightsA: weightsArg("wa"), weightsB: weightsArg("wb"),
  baseSeed: Number(args.get("seed") ?? 1), lp: args.has("lp") ? Number(args.get("lp")) : undefined, trace: args.has("trace"),
  record: args.has("record"),
};
const n = Number(args.get("n") ?? 10);
const only = args.has("only") ? Number(args.get("only")) : null;
if (args.has("sim-trace")) Simulator.debug = (line) => console.log(line);
const deckNames = (args.get("decks") ?? Object.keys(DECKS).join(",")).split(",") as DeckName[];
for (const d of deckNames) if (!(d in DECKS)) throw new Error(`unknown deck "${d}"`);

const all = matchJobs(deckNames, n);
const jobs = only === null ? all : all.filter((j) => j.k === only);
const threads = settings.trace || Simulator.debug ? 1 : Number(args.get("jobs") ?? availableParallelism());
const started = performance.now();
const results = await runMatch(jobs, settings, threads);
if (args.has("record")) {
  const lines = results.flatMap((r) => (r.positions ?? []).filter((p) => p.won !== null).map((p) => JSON.stringify({ duel: r.k, ...p })));
  writeFileSync(args.get("record")!, lines.join("\n") + "\n");
  console.log(`recorded ${lines.length} positions to ${args.get("record")}`);
}
report(results, (performance.now() - started) / 1000, Math.min(threads, jobs.length));

function report(results: Result[], seconds: number, threads: number): void {
  const s = settings;
  for (const r of results) if (r.outcome === "error") console.error(`duel ${r.k} (seed ${s.baseSeed + r.k}) FAILED: ${r.error}`);
  const played = results.filter((r) => r.outcome !== "error");
  const pct = (x: number, of: number) => (of ? `${((100 * x) / of).toFixed(0)}%` : "-");
  console.log(`\nA = ${s.A}${s.weightsA ? " (own weights)" : ""}, B = ${s.B}${s.weightsB ? " (own weights)" : ""}: ` +
    `${n} duels per pairing and seat order, seeds from ${s.baseSeed}`);
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
  const w = winRate(results);
  const draws = played.filter((r) => r.outcome === "draw").length;
  const errors = results.length - played.length;
  console.log(`\nA won ${w.wins}/${w.played} = ${(100 * w.rate).toFixed(1)}% (±${(100 * w.margin).toFixed(1)}%, 95%), draws ${draws}, errors ${errors}`);
  const sum = (f: (r: Result) => number) => played.reduce((t, r) => t + f(r), 0);
  const per = (t: number, d: number) => (d ? (t / d).toFixed(3) : "-");
  const slow = (i: 0 | 1) => Math.max(0, ...played.map((r) => r.slowest[i])).toFixed(0);
  console.log(`think time: A ${per(sum((r) => r.think[0]), sum((r) => r.decisions[0]))} ms/decision (slowest ${slow(0)} ms), ` +
    `B ${per(sum((r) => r.think[1]), sum((r) => r.decisions[1]))} ms/decision (slowest ${slow(1)} ms); ` +
    `${(played.length / seconds).toFixed(1)} duels/s on ${threads} thread${threads > 1 ? "s" : ""}`);
  if (args.has("stats")) {
    console.log("\npassivity, per 100 own turns    skipped summons  open field  unused S/T  attacks into sets      S/T in hand at end (per duel)");
    for (const i of [0, 1] as const) {
      const t = (k: keyof PassivityStats) => sum((r) => r.stats[i][k]);
      const turns = t("turns");
      const per100 = (k: keyof PassivityStats) => (turns ? ((100 * t(k)) / turns).toFixed(1) : "-");
      const label = `${i ? "B" : "A"} = ${i ? s.B : s.A} (${turns} turns)`;
      console.log(`${label.padEnd(32)} ${per100("skippedSummons").padStart(15)}  ${per100("openField").padStart(10)}  ` +
        `${per100("unusedSpells").padStart(10)}  ${`${per100("attacksIntoSets")} (${pct(t("attacksIntoSets"), t("attacks"))} of attacks)`.padStart(21)}  ` +
        `${per(t("spellsAtEnd"), played.length).padStart(13)}`);
    }
  }
  if (args.has("losses")) {
    const lost = played.filter((r) => r.outcome === "b").map((r) => `${r.k} (${r.aDeck} ${r.aFirst ? "first" : "second"} vs ${r.bDeck}, ${r.turns} turns)`);
    console.log(`\nA lost: ${lost.join(", ") || "none"}`);
  }
  if (errors) process.exit(1);
}
