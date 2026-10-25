// Brain vs brain matches for the arena and the tuner: seeded duels over every deck pairing and seat order, run in
// parallel worker threads (one engine each). This file is also the workers' entry point.
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { OcgLocation, OcgMessageType, OcgPhase, OcgResponseType, SelectBattleCMDAction, SelectIdleCMDAction, type OcgCardLoc, type OcgMessage, type OcgResponse } from "ocgcore-wasm";
import { AiSeat } from "../../src/duel/ai/AiSeat.ts";
import type { Weights } from "../../src/duel/ai/board.ts";
import { BRAINS, type BrainContext, type BrainName } from "../../src/duel/ai/brains.ts";
import { formatTrace } from "../../src/duel/ai/trace.ts";
import { TYPE } from "../../src/duel/engine/cardData.ts";
import type { DuelSession, FieldSnapshot } from "../../src/duel/engine/DuelSession.ts";
import { DECKS, type DeckName } from "../../src/duel/decks/decks.ts";
import { cards, core, newDuel, readScript, runDuel, seedFrom } from "./engine.ts";

/**
 * "baseline": the planner of an older commit checked out in vendor/baseline (`git worktree add vendor/baseline <commit>`),
 * so old and new AI code play each other. Its brain gets this checkout's engine, card data and AiSeat.
 */
const BASELINE = path.resolve(import.meta.dirname, "../../vendor/baseline/src/duel/ai/brains.ts");
const baseline = existsSync(BASELINE)
  ? ((await import(pathToFileURL(BASELINE).href)) as { BRAINS: typeof BRAINS }).BRAINS.planner : null;
export type MatchBrain = BrainName | "baseline";
export const isMatchBrain = (name: string): name is MatchBrain => name in BRAINS || (name === "baseline" && !!baseline);
function makeBrain(name: MatchBrain, ctx: BrainContext) {
  if (name !== "baseline") return BRAINS[name](ctx);
  if (!baseline) throw new Error("no vendor/baseline checkout (git worktree add vendor/baseline <commit>)");
  return baseline(ctx);
}

/** Duel k of a match: brain A plays `aDeck` and goes first when `aFirst`. */
export interface Job { k: number; aDeck: DeckName; bDeck: DeckName; aFirst: boolean }

export interface MatchSettings {
  A: MatchBrain;
  B: MatchBrain;
  /** Each side's weights (default: the built-in ones). */
  weightsA?: Readonly<Weights>;
  weightsB?: Readonly<Weights>;
  /** Duel k uses seed (baseSeed + k). */
  baseSeed: number;
  lp?: number;
  /** Print every decision (single thread only). */
  trace?: boolean;
  /** Keep each turn's starting position (`Result.positions`), for fitting the evaluation (tools/ai/fit-eval.ts). */
  record?: boolean;
}

/**
 * A position for fitting the evaluation: the board as the turn player saw it at their first main-phase decision of a
 * turn (hidden cards masked as for them), and whether that player went on to win the duel.
 */
export interface Position {
  seat: 0 | 1;
  turn: number;
  board: FieldSnapshot;
  won: boolean | null;
}

export interface Result extends Job {
  outcome: "a" | "b" | "draw" | "error";
  error?: string;
  turns: number;
  /** [A, B] */
  think: [number, number];
  decisions: [number, number];
  slowest: [number, number];
  /** [A, B] */
  stats: [PassivityStats, PassivityStats];
  /** With `record`: each turn's starting position (won = null until the duel is decided). */
  positions?: Position[];
}

/** How passive a side played (docs/ai-rework-plan.md phase 1); counted only from what that seat could see. */
export interface PassivityStats {
  /** Its own turns that ended. */
  turns: number;
  /** Turns it ended while its last main-phase prompt still offered a Normal Summon or Set it hadn't used. */
  skippedSummons: number;
  /** Turns it ended with no monster while the opponent held cards. */
  openField: number;
  /** Spells/Traps its last main-phase prompt offered to activate or set from the hand, still in hand at turn end. */
  unusedSpells: number;
  /** Spells/Traps in its hand when the duel ended. */
  spellsAtEnd: number;
  attacks: number;
  /** Attacks declared while the opponent controlled face-down Spells/Traps. */
  attacksIntoSets: number;
}

const noStats = (): PassivityStats =>
  ({ turns: 0, skippedSummons: 0, openField: 0, unusedSpells: 0, spellsAtEnd: 0, attacks: 0, attacksIntoSets: 0 });

type IdleMessage = Extract<OcgMessage, { type: OcgMessageType.SELECT_IDLECMD }>;

/**
 * Counts PassivityStats for both seats by wrapping their AiSeats: decide() sees each seat's own prompts and answers,
 * observe() the turn changes (through the seat's memory), and the board comes from `snapshot()` as the turn player
 * sees it at the turn's last decision. Nothing here reads hidden cards.
 */
class PassivityTracker {
  readonly stats: [PassivityStats, PassivityStats] = [noStats(), noStats()];
  /** Each turn's starting position, when recording. */
  readonly positions: Position[] = [];
  /** The turn player's board at the latest decision (either seat's). */
  private board: FieldSnapshot | null = null;
  /** The turn player's last main-phase prompt this turn, and whether they Normal Summoned / Set this turn. */
  private lastIdle: IdleMessage | null = null;
  private summoned = false;

  private readonly duel: DuelSession;
  private readonly record: boolean;

  constructor(duel: DuelSession, record = false) {
    this.duel = duel;
    this.record = record;
  }

  wrap(seat: AiSeat): AiSeat {
    const decide = seat.decide.bind(seat);
    const observe = seat.observe.bind(seat);
    seat.decide = (prompt) => {
      const response = decide(prompt);
      this.decided(seat, prompt, response);
      return response;
    };
    // Both seats see every turn change; only the turn player's own wrapper closes its turn.
    seat.observe = (messages) => {
      const { turn, turnPlayer } = seat.memory;
      observe(messages);
      if (seat.memory.turn !== turn && turn > 0 && turnPlayer === seat.seat) this.turnEnded(seat.seat);
    };
    return seat;
  }

  private decided(seat: AiSeat, prompt: OcgMessage, response: OcgResponse): void {
    const turnPlayer = seat.memory.turnPlayer;
    this.board = this.duel.snapshot(turnPlayer);
    if (seat.seat !== turnPlayer) return;
    const s = this.stats[seat.seat];
    if (prompt.type === OcgMessageType.SELECT_IDLECMD && response.type === OcgResponseType.SELECT_IDLECMD) {
      if (this.record && !this.lastIdle && seat.memory.phase === OcgPhase.MAIN1)
        this.positions.push({ seat: seat.seat, turn: seat.memory.turn, board: this.duel.snapshot(seat.seat), won: null });
      this.lastIdle = prompt;
      if (response.action === SelectIdleCMDAction.SELECT_SUMMON || response.action === SelectIdleCMDAction.SELECT_MONSTER_SET) this.summoned = true;
    } else if (prompt.type === OcgMessageType.SELECT_BATTLECMD && response.type === OcgResponseType.SELECT_BATTLECMD && response.action === SelectBattleCMDAction.SELECT_BATTLE) {
      s.attacks++;
      if (this.duel.snapshot(seat.seat).players[1 - seat.seat].spells.slice(0, 5).some((c) => c?.faceDown)) s.attacksIntoSets++;
    }
  }

  private turnEnded(seat: 0 | 1): void {
    const s = this.stats[seat];
    s.turns++;
    const idle = this.lastIdle;
    if (idle && !this.summoned && (idle.summons.length || idle.monster_sets.length)) s.skippedSummons++;
    if (this.board) {
      const me = this.board.players[seat];
      if (me.monsters.every((c) => !c) && this.board.players[1 - seat].hand.length) s.openField++;
      if (idle) {
        const offered = [...idle.activates, ...idle.spell_sets].filter((c) => c.location === OcgLocation.HAND && this.isSpell(c));
        // Each offered card once (a card can be both activatable and settable), matched against the hand by code.
        const left = me.hand.map((c) => c.code);
        const seen = new Set<number>();
        for (const c of offered) {
          if (seen.has(c.sequence)) continue;
          seen.add(c.sequence);
          const i = left.indexOf(c.code);
          if (i >= 0) { left.splice(i, 1); s.unusedSpells++; }
        }
      }
    }
    this.lastIdle = null;
    this.summoned = false;
  }

  /** The duel is over: count each side's Spells/Traps in hand (as that side sees its own hand). */
  ended(): void {
    for (const seat of [0, 1] as const)
      this.stats[seat].spellsAtEnd = this.duel.snapshot(seat).players[seat].hand.filter((c) => this.isSpell(c)).length;
  }

  private isSpell(c: Pick<OcgCardLoc, "code">): boolean {
    return ((this.duel.cards.get(c.code)?.type ?? 0) & (TYPE.SPELL | TYPE.TRAP)) !== 0;
  }
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
  const tracker = new PassivityTracker(duel, s.record);
  const seatOf = (seat: 0 | 1) => {
    const isA = seat === aSeat;
    const brain = makeBrain(isA ? s.A : s.B, { engine: { core, cards, readScript }, weights: isA ? s.weightsA : s.weightsB });
    return tracker.wrap(new AiSeat({ seat, brain, duel, onTrace, deck: decks[seat].main }));
  };
  const result: Result = { ...job, outcome: "error", turns: 0, think: [0, 0], decisions: [0, 0], slowest: [0, 0], stats: [noStats(), noStats()] };
  const ab = <T,>(pair: [T, T]): [T, T] => (aSeat === 0 ? pair : [pair[1], pair[0]]);
  try {
    if (s.trace) console.log(`--- duel ${k} (seed ${s.baseSeed + k}): ${s.A} [${aDeck}] ${aFirst ? "first" : "second"} vs ${s.B} [${bDeck}]`);
    const run = runDuel(duel, [seatOf(0), seatOf(1)]);
    result.outcome = run.winner === null ? "draw" : run.winner === aSeat ? "a" : "b";
    result.turns = run.turns;
    result.think = ab(run.thinkMs);
    result.decisions = ab(run.decisions);
    result.slowest = ab(run.maxMs);
    tracker.ended();
    result.stats = ab(tracker.stats);
    if (s.record) result.positions = tracker.positions.map((p) => ({ ...p, won: run.winner === null ? null : run.winner === p.seat }));
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
