// Drives a DuelSession for "human (player 0) vs AI (player 1)".
// UI-agnostic: the scene subscribes to events and answers human prompts via `answer()`.
import {
  OcgMessageType,
  OcgResponseType,
  type OcgMessage,
  type OcgResponse,
} from "ocgcore-wasm";
import { DuelSession, type FieldSnapshot } from "./DuelSession.ts";
import { autoRespond } from "./autoBot.ts";

export const HUMAN = 0;
export const AI = 1;

const HINT_SELECTMSG = 3;

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
}

export interface DuelControllerOptions {
  session: DuelSession;
  events: DuelEvents;
  /** Schedules a callback (Phaser's `time.delayedCall` in the game, setTimeout in tests). */
  schedule: (ms: number, fn: () => void) => void;
  /** How long the AI "thinks" before each decision. */
  aiDelayMs?: number;
}

export class DuelController {
  readonly session: DuelSession;
  private readonly events: DuelEvents;
  private readonly schedule: (ms: number, fn: () => void) => void;
  private readonly aiDelayMs: number;
  private pending: HumanPrompt | null = null;
  private destroyed = false;
  private hint: bigint | null = null;
  turn = 0;
  turnPlayer = 0;
  phase = 0;

  constructor(opts: DuelControllerOptions) {
    this.session = opts.session;
    this.events = opts.events;
    this.schedule = opts.schedule;
    this.aiDelayMs = opts.aiDelayMs ?? 450;
  }

  start(): void {
    void this.step();
  }

  /** Answer the currently pending human prompt. */
  answer(response: OcgResponse): void {
    if (!this.pending) throw new Error("DuelController.answer: no pending prompt");
    this.pending = null;
    this.session.respond(response);
    void this.step();
  }

  get waitingForHuman(): HumanPrompt | null {
    return this.pending;
  }

  /** Stops the loop (scene shut down mid-animation); the session is destroyed by its owner. */
  stop(): void {
    this.destroyed = true;
  }

  snapshot(): FieldSnapshot {
    return this.session.snapshot(HUMAN);
  }

  private async step(): Promise<void> {
    const result = this.session.advance();
    for (const m of result.messages) this.track(m);
    await this.events.onUpdate(result.messages, this.session.snapshot(HUMAN));
    if (this.destroyed) return;

    if (result.ended) {
      this.events.onEnd(result.winner);
      return;
    }
    const prompt = result.prompt as HumanPrompt;
    const trivial = this.trivialAnswer(prompt);
    if (prompt.player === AI) {
      // The AI only "thinks" when it has a real choice; passing with nothing to do is instant
      // (otherwise every empty chain window, e.g. around attacks, adds a pause).
      this.schedule(trivial ? 0 : this.aiDelayMs, () => {
        if (this.destroyed) return;
        this.session.respond(trivial ?? autoRespond(prompt));
        void this.step();
      });
      return;
    }
    if (trivial) {
      this.session.respond(trivial);
      this.schedule(0, () => void (!this.destroyed && this.step()));
      return;
    }
    this.pending = prompt;
    const hint = this.hint;
    this.hint = null;
    this.events.onPrompt(prompt, hint);
  }

  /** Prompts that have exactly one sensible answer and would only slow things down (either player). */
  private trivialAnswer(m: HumanPrompt): OcgResponse | null {
    if (m.type === OcgMessageType.SELECT_CHAIN && m.selects.length === 0 && !m.forced)
      return { type: OcgResponseType.SELECT_CHAIN, index: null };
    return null;
  }

  private track(m: OcgMessage): void {
    switch (m.type) {
      case OcgMessageType.NEW_TURN:
        this.turn++;
        this.turnPlayer = m.player;
        break;
      case OcgMessageType.NEW_PHASE:
        this.phase = m.phase;
        break;
      case OcgMessageType.HINT:
        if (m.hint_type === HINT_SELECTMSG && m.player === HUMAN) this.hint = m.hint;
        break;
    }
  }
}
