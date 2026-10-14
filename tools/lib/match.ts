// Brain vs brain matches for the arena and the tuner: seeded duels over every deck pairing and seat order, run in
// parallel worker threads (one engine each). This file is also the workers' entry point.
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { AiSeat } from "../../src/duel/ai/AiSeat.ts";
import type { Weights } from "../../src/duel/ai/board.ts";
import { BRAINS, type BrainName } from "../../src/duel/ai/brains.ts";
import { formatTrace } from "../../src/duel/ai/trace.ts";
import { DECKS, type DeckName } from "../../src/duel/decks.ts";
import { cards, core, newDuel, readScript, runDuel, seedFrom } from "./engine.ts";

/** Duel k of a match: brain A plays `aDeck` and goes first when `aFirst`. */
export interface Job { k: number; aDeck: DeckName; bDeck: DeckName; aFirst: boolean }

export interface MatchSettings {
  A: BrainName;
  B: BrainName;
  /** Each side's weights (default: the built-in ones). */
  weightsA?: Readonly<Weights>;
  weightsB?: Readonly<Weights>;
  /** Duel k uses seed (baseSeed + k). */
  baseSeed: number;
  lp?: number;
  /** Print every decision (single thread only). */
  trace?: boolean;
}

export interface Result extends Job {
  outcome: "a" | "b" | "draw" | "error";
  error?: string;
  turns: number;
  /** [A, B] */
  think: [number, number];
  decisions: [number, number];
  slowest: [number, number];
}

/** Every deck pairing and seat order, `n` duels each; duel k always gets the same seed and setup. */
export function matchJobs(decks: readonly DeckName[], n: number): Job[] {
  const jobs: Job[] = [];
  for (const aDeck of decks) for (const bDeck of decks) for (const aFirst of [true, false])
    for (let i = 0; i < n; i++) jobs.push({ k: jobs.length, aDeck, bDeck, aFirst });
  return jobs;
}

/** Plays one duel. */
export function playJob(job: Job, s: MatchSettings): Result {
  const { k, aDeck, bDeck, aFirst } = job;
  const aSeat = aFirst ? 0 : 1;
  const decks = aFirst ? [DECKS[aDeck].deck, DECKS[bDeck].deck] : [DECKS[bDeck].deck, DECKS[aDeck].deck];
  const duel = newDuel({ decks: [decks[0], decks[1]], seed: seedFrom(s.baseSeed + k), startingLP: s.lp, onCoreLog: () => {} });
  const onTrace = s.trace ? (e: Parameters<typeof formatTrace>[0]) => console.log(formatTrace(e)) : undefined;
  const seatOf = (seat: 0 | 1) => {
    const isA = seat === aSeat;
    const brain = BRAINS[isA ? s.A : s.B]({ engine: { core, cards, readScript }, weights: isA ? s.weightsA : s.weightsB });
    return new AiSeat({ seat, brain, duel, onTrace, deck: decks[seat].main });
  };
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

/** Plays the jobs on `threads` worker threads (1 = right here), results in job order. */
export async function runMatch(jobs: Job[], s: MatchSettings, threads: number): Promise<Result[]> {
  if (threads <= 1 || jobs.length <= 1) return jobs.map((j) => playJob(j, s));
  const count = Math.min(threads, jobs.length);
  const shares = Array.from({ length: count }, (_, w) => jobs.filter((_j, i) => i % count === w));
  const results = await Promise.all(shares.map((share) => new Promise<Result[]>((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { matchJobs: share, settings: s } });
    worker.once("message", resolve);
    worker.once("error", reject);
  })));
  return results.flat().sort((a, b) => a.k - b.k);
}

/** A's share of the decided duels, with the 95% margin. */
export function winRate(results: Result[]): { wins: number; played: number; rate: number; margin: number } {
  const played = results.filter((r) => r.outcome === "a" || r.outcome === "b" || r.outcome === "draw").length;
  const wins = results.filter((r) => r.outcome === "a").length;
  const rate = played ? wins / played : 0;
  return { wins, played, rate, margin: played ? 1.96 * Math.sqrt((rate * (1 - rate)) / played) : 0 };
}

if (!isMainThread && (workerData as { matchJobs?: Job[] } | null)?.matchJobs) {
  const { matchJobs: jobs, settings } = workerData as { matchJobs: Job[]; settings: MatchSettings };
  parentPort!.postMessage(jobs.map((j) => playJob(j, settings)));
}
