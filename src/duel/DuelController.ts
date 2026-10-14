// Drives a DuelSession for the player on this machine (`me`) against the built-in AI or, in a
// peer-to-peer duel, a player on another machine (`remote`).
// UI-agnostic: the scene subscribes to events and answers human prompts via `answer()`.
//
// Peer-to-peer duels run in lockstep: both machines run the same duel (same seed, same decks) and send
// each other only the answers to their own prompts. ocgcore is deterministic, so that keeps them in sync;
// a board checksum travels with each answer to catch it if they ever drift apart.
import {
  OcgMessageType,
  OcgResponseType,
  type OcgMessage,
  type OcgResponse,
} from "ocgcore-wasm";
import { DuelSession, type FieldSnapshot } from "./DuelSession.ts";
import { AiSeat } from "./ai/AiSeat.ts";
import { autoBotBrain } from "./ai/brains.ts";

const HINT_SELECTMSG = 3;

/**
 * Which optional chain prompts the human sees: "auto" only when a usable card's script marks this moment
 * as a good time (the engine's `spe_count`, like YGOPro/EDOPro by default), "all" whenever a card is
 * usable, "off" never. Forced chains and trigger selections always ask.
 */
export type ChainMode = "auto" | "all" | "off";

/** A selection the human has to make. */
export type HumanPrompt = OcgMessage & { player: number };

export interface DuelEvents {
  /**
   * Messages produced by one engine step, plus the board as the human sees it afterwards.
   * May return a promise (e.g. animations); the duel waits for it before continuing.
   */
  onUpdate(messages: OcgMessage[], snapshot: FieldSnapshot): void | Promise<void>;
  /** The human must answer; `hint` is the pending "Select the card(s) to …" system string id, if any. */
  onPrompt(prompt: HumanPrompt, hint: bigint | null): void;
  onEnd(winner: number | null): void;
  /** The duel can't go on (peer-to-peer: the two machines' duels drifted apart). */
  onError?(message: string): void;
}

/** The other player's machine in a peer-to-peer duel. */
export interface RemotePeer {
  /** Sends one of our answers, with the board checksum from just before it was applied. */
  send(response: OcgResponse, checksum: number): void;
  /** Registers the handler for the peer's answers, delivered in the order they were sent. */
  onResponse(handler: (response: OcgResponse, checksum: number) => void): void;
}

export interface DuelControllerOptions {
  session: DuelSession;
  events: DuelEvents;
  /** Schedules a callback (Phaser's `time.delayedCall` in the game, setTimeout in tests). */
  schedule: (ms: number, fn: () => void) => void;
  /** How long the AI "thinks" before each decision. */
  aiDelayMs?: number;
  /** Seat of the player on this machine (0 = goes first). Default 0. */
  me?: 0 | 1;
  /** The other seat is a player on another machine; without it, the built-in AI plays it. */
  remote?: RemotePeer;
  /** The built-in AI for the other seat (ignored with `remote`). Default: autoBot. */
  ai?: AiSeat;
  /** The human's chain mode, read at every chain prompt (it can change mid-duel). Default "auto". */
  chainMode?: () => ChainMode;
}

export class DuelController {
  readonly session: DuelSession;
  private readonly events: DuelEvents;
  private readonly schedule: (ms: number, fn: () => void) => void;
  private readonly aiDelayMs: number;
  readonly me: 0 | 1;
  private readonly remote: RemotePeer | null;
  private readonly ai: AiSeat | null;
  private readonly chainMode: () => ChainMode;
  /** Peer answers that arrived before our duel reached their prompt. */
  private inbox: { response: OcgResponse; checksum: number }[] = [];
  private awaitingRemote = false;
  private pending: HumanPrompt | null = null;
  private destroyed = false;
  private hint: bigint | null = null;

  constructor(opts: DuelControllerOptions) {
    this.session = opts.session;
    this.events = opts.events;
    this.schedule = opts.schedule;
    this.aiDelayMs = opts.aiDelayMs ?? 450;
    this.me = opts.me ?? 0;
    this.remote = opts.remote ?? null;
    this.ai = this.remote ? null : opts.ai ?? new AiSeat({ seat: (1 - this.me) as 0 | 1, brain: autoBotBrain, duel: this.session });
    if (this.ai && this.ai.seat === this.me) throw new Error("DuelController: the AI can't play the local player's seat");
    this.chainMode = opts.chainMode ?? (() => "auto");
    this.remote?.onResponse((response, checksum) => {
      this.inbox.push({ response, checksum });
      if (this.awaitingRemote) this.takeRemote();
    });
  }

  start(): void {
    void this.step();
  }

  /** Answer the currently pending human prompt. */
  answer(response: OcgResponse): void {
    if (!this.pending) throw new Error("DuelController.answer: no pending prompt");
    this.pending = null;
    this.remote?.send(response, this.session.checksum());
    this.session.respond(response);
    void this.step();
  }

  get waitingForHuman(): HumanPrompt | null {
    return this.pending;
  }

  /** Peer-to-peer: the duel is waiting for the other player's answer (for the planned "waiting for opponent" indicator). */
  get waitingForRemote(): boolean {
    return this.awaitingRemote;
  }

  /** Stops the loop (scene shut down mid-animation); the session is destroyed by its owner. */
  stop(): void {
    this.destroyed = true;
  }

  snapshot(): FieldSnapshot {
    return this.session.snapshot(this.me);
  }

  private async step(): Promise<void> {
    const result = this.session.advance();
    for (const m of result.messages) this.track(m);
    this.ai?.observe(result.messages);
    await this.events.onUpdate(result.messages, this.session.snapshot(this.me));
    if (this.destroyed) return;

    if (result.ended) {
      this.events.onEnd(result.winner);
      return;
    }
    const prompt = result.prompt as HumanPrompt;
    // Answered the same way on both machines in a peer-to-peer duel, so never sent.
    const trivial = this.trivialAnswer(prompt);
    if (trivial) {
      this.session.respond(trivial);
      this.schedule(0, () => void (!this.destroyed && this.step()));
      return;
    }
    if (prompt.player !== this.me) {
      if (this.remote) {
        this.awaitingRemote = true;
        this.takeRemote();
        return;
      }
      // The AI "thinks" a moment before each real choice.
      this.schedule(this.aiDelayMs, () => {
        if (this.destroyed) return;
        this.session.respond(this.ai!.decide(prompt));
        void this.step();
      });
      return;
    }
    this.pending = prompt;
    const hint = this.hint;
    this.hint = null;
    // A chain prompt our chain mode hides: answered like any human answer (so a peer gets it too).
    if (this.skipsChain(prompt)) return this.answer({ type: OcgResponseType.SELECT_CHAIN, index: null });
    this.events.onPrompt(prompt, hint);
  }

  /** Applies the peer's next answer if it has arrived (otherwise `onResponse` calls this again later). */
  private takeRemote(): void {
    if (this.destroyed) return;
    const next = this.inbox.shift();
    if (!next) return;
    this.awaitingRemote = false;
    if (next.checksum !== this.session.checksum()) {
      this.destroyed = true;
      this.events.onError?.("The two duels went out of sync.");
      return;
    }
    this.session.respond(next.response);
    void this.step();
  }

  /** Prompts that have exactly one sensible answer and would only slow things down (either player). */
  private trivialAnswer(m: HumanPrompt): OcgResponse | null {
    if (m.type === OcgMessageType.SELECT_CHAIN && m.selects.length === 0 && !m.forced)
      return { type: OcgResponseType.SELECT_CHAIN, index: null };
    return null;
  }

  /** Our own optional chain prompts the chain mode hides (one player's preference, unlike `trivialAnswer`). */
  private skipsChain(m: HumanPrompt): boolean {
    // spe_count 0x7f marks a trigger-effect selection; YGOPro never auto-skips those.
    if (m.type !== OcgMessageType.SELECT_CHAIN || m.forced || m.spe_count === 0x7f) return false;
    const mode = this.chainMode();
    return mode === "off" || (mode === "auto" && m.spe_count === 0);
  }

  private track(m: OcgMessage): void {
    if (m.type === OcgMessageType.HINT && m.hint_type === HINT_SELECTMSG && m.player === this.me) this.hint = m.hint;
  }
}
