// The AI player in one seat. It is the only AI code that touches the engine: it redacts every engine step into the
// seat's memory, reads the board as the seat sees it, and hands a brain only that (an AiView). Brains never get the
// session or raw messages, so they can't see hidden cards by accident.
import type { OcgMessage, OcgResponse } from "ocgcore-wasm";
import type { CardDb } from "../engine/cardData.ts";
import type { DuelSeed, FieldSnapshot } from "../engine/DuelSession.ts";
import { autoRespond } from "./autoBot.ts";
import { mulberry32 } from "../engine/rng.ts";
import type { Weights } from "./board.ts";
import { AiMemory } from "./memory.ts";
import { redact } from "./redact.ts";
import { describeChoice, promptName, type ScoredOption, type TraceEntry } from "./trace.ts";

/** Everything a brain may know when it decides. */
export interface AiView {
  readonly seat: 0 | 1;
  /** The board as this seat sees it: the opponent's hand and face-down cards have code 0. */
  readonly board: FieldSnapshot;
  readonly memory: AiMemory;
  readonly cards: CardDb;
  /** The "Select the card(s) to …" system string id that came with this prompt, if any (e.g. 502n = destroy). */
  readonly hint: bigint | null;
  /** The AI's own randomness, seeded from the duel seed. */
  readonly rng: () => number;
  /** The AI's own Main Deck list (it built the deck: it knows what's in it, not the order); null if not given. */
  readonly deckList: readonly number[] | null;
  /** How the deciding brain values things (board.ts); absent = the defaults. Set by the brain, not by AiSeat. */
  readonly weights?: Readonly<Weights>;
}

export interface Decision {
  response: OcgResponse;
  /** Why, in a few words (shown in the trace). */
  reason?: string;
  /** The options the brain weighed, for the trace. */
  options?: ScoredOption[];
}

/** A decision maker: one per difficulty level / style. Must always return a legal answer. */
export interface Brain {
  readonly name: string;
  decide(prompt: OcgMessage, view: AiView): Decision;
  /** Called repeatedly while the opponent thinks: do a little preparation, return whether there's more. */
  idle?(): boolean;
  /** The duel is over: free what it holds. */
  dispose?(): void;
}

/** What DuelController needs from an AI player: one in this thread (AiSeat) or in a Web Worker (AiWorkerClient). */
export interface AiPlayer {
  readonly seat: 0 | 1;
  /** Every engine step's raw messages (the player filters them itself). */
  observe(messages: readonly OcgMessage[]): void;
  /** Its answer to a prompt addressed to it; a worker answers later. */
  decide(prompt: OcgMessage): OcgResponse | Promise<OcgResponse>;
  /** A little preparation while the opponent thinks; whether there's more. */
  idle(): boolean;
  dispose(): void;
}

/** What AiSeat needs from the duel. */
export interface AiDuel {
  readonly cards: CardDb;
  readonly seed: DuelSeed;
  snapshot(viewer: 0 | 1): FieldSnapshot;
}

export interface AiSeatOptions {
  seat: 0 | 1;
  brain: Brain;
  duel: AiDuel;
  /** The seat's Main Deck list (what's in it, not the order). */
  deck?: readonly number[];
  /** Throw when the brain fails (dev builds, tools). Otherwise fall back to autoBot's answer and log the error. */
  strict?: boolean;
  /** Receives a record of every decision. */
  onTrace?: (entry: TraceEntry) => void;
}

export class AiSeat implements AiPlayer {
  readonly seat: 0 | 1;
  readonly brain: Brain;
  readonly memory: AiMemory;
  private readonly duel: AiDuel;
  private readonly deckList: readonly number[] | null;
  private readonly rng: () => number;
  private readonly strict: boolean;
  private readonly onTrace?: (entry: TraceEntry) => void;

  constructor(opts: AiSeatOptions) {
    this.seat = opts.seat;
    this.brain = opts.brain;
    this.duel = opts.duel;
    this.deckList = opts.deck ?? null;
    this.memory = new AiMemory(opts.seat);
    this.strict = opts.strict ?? true;
    this.onTrace = opts.onTrace;
    // Its own stream (not the deck shuffle's): mix both seed words with a per-seat salt.
    const [a, b] = opts.duel.seed;
    this.rng = mulberry32(Number((a ^ b) & 0xffffffffn) ^ (opts.seat ? 0x5bd1e995 : 0x1b873593));
  }

  /** Lets the brain prepare a little while the opponent thinks; returns whether it has more to prepare. */
  idle(): boolean {
    return this.brain.idle?.() ?? false;
  }

  /** Frees what the brain holds (the duel is over or was left). */
  dispose(): void {
    this.brain.dispose?.();
  }

  /** Feeds every message of one engine step (raw: this redacts them). Call it for every step, both players' turns. */
  observe(messages: readonly OcgMessage[]): void {
    this.memory.update(redact(messages, this.seat));
  }

  /** Answers a prompt addressed to this seat. */
  decide(prompt: OcgMessage): OcgResponse {
    if ((prompt as { player?: number }).player !== this.seat) throw new Error(`AiSeat ${this.seat}: prompt is for another player`);
    const view: AiView = {
      seat: this.seat, board: this.duel.snapshot(this.seat), memory: this.memory, cards: this.duel.cards,
      hint: this.memory.hint, rng: this.rng, deckList: this.deckList,
    };
    this.memory.hint = null;
    let decision: Decision;
    const started = performance.now();
    try {
      decision = this.brain.decide(prompt, view);
    } catch (e) {
      if (this.strict) throw e;
      console.error(`AI (${this.brain.name}) failed, falling back to autoBot:`, e);
      decision = { response: autoRespond(prompt, this.rng, this.duel.cards), reason: `fallback after error: ${String(e)}` };
    }
    this.onTrace?.({
      seat: this.seat, brain: this.brain.name, turn: this.memory.turn, phase: this.memory.phase, prompt: promptName(prompt),
      choice: describeChoice(prompt, decision.response, this.duel.cards), reason: decision.reason ?? "", options: decision.options,
      ms: performance.now() - started,
    });
    return decision.response;
  }
}
