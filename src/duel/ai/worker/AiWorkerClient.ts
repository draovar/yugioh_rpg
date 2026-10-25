// The game's side of the AI's Web Worker: an AiPlayer whose thinking happens off the main thread, so the screen keeps
// animating while it plans. Hidden information never leaves the main thread: messages are redacted and the board is
// masked here, before they're posted. A local AiSeat shadows the worker (same messages, so the same memory); if the
// worker can't start or fails on a prompt, that shadow answers instead, on the main thread like before.
import type { OcgMessage, OcgResponse } from "ocgcore-wasm";
import type { DuelSession } from "../../engine/DuelSession.ts";
import { AiSeat, type AiPlayer } from "../AiSeat.ts";
import { BRAINS, type BrainName } from "../brains.ts";
import { redact } from "../redact.ts";
import type { SimEngine } from "../sim/simulator.ts";
import type { TraceEntry } from "../trace.ts";
import type { FromWorker, ToWorker } from "./protocol.ts";

export interface AiWorkerOptions {
  seat: 0 | 1;
  brain: BrainName;
  /** The real duel: only `snapshot(seat)` (masked) and its seed are used. */
  duel: DuelSession;
  /** The rules engine on the main thread, for the fallback. */
  engine: SimEngine;
  deck?: readonly number[];
  onTrace?: (entry: TraceEntry) => void;
}

export class AiWorkerClient implements AiPlayer {
  readonly seat: 0 | 1;
  private readonly duel: DuelSession;
  private readonly onTrace?: (entry: TraceEntry) => void;
  private readonly worker: Worker;
  /** Same brain on the main thread, kept up to date; answers when the worker can't. */
  private readonly shadow: AiSeat;
  private failed = false;
  private nextId = 0;
  private readonly pending = new Map<number, { prompt: OcgMessage; resolve: (r: OcgResponse) => void }>();

  constructor(opts: AiWorkerOptions) {
    this.seat = opts.seat;
    this.duel = opts.duel;
    this.onTrace = opts.onTrace;
    this.shadow = new AiSeat({
      seat: opts.seat, brain: BRAINS[opts.brain]({ engine: opts.engine }), duel: opts.duel, deck: opts.deck, strict: false, onTrace: opts.onTrace,
    });
    this.worker = new Worker(new URL("./aiWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    this.worker.onerror = (e) => this.fail(`worker error: ${e.message}`);
    this.post({ t: "init", seat: opts.seat, brain: opts.brain, deck: opts.deck ? [...opts.deck] : null, seed: opts.duel.seed, trace: !!opts.onTrace });
  }

  observe(messages: readonly OcgMessage[]): void {
    this.shadow.observe(messages);
    if (!this.failed) this.post({ t: "observe", messages: redact(messages, this.seat) });
  }

  decide(prompt: OcgMessage): OcgResponse | Promise<OcgResponse> {
    if (this.failed) return this.shadow.decide(prompt);
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, { prompt, resolve });
      this.post({ t: "decide", id, prompt, board: this.duel.snapshot(this.seat) });
    });
  }

  /** The worker prepares on its own; only the fallback needs the main thread's idle time. */
  idle(): boolean {
    return this.failed ? this.shadow.idle() : false;
  }

  dispose(): void {
    this.post({ t: "dispose" });
    this.worker.terminate();
    this.shadow.dispose();
    this.pending.clear();
  }

  private post(m: ToWorker): void {
    this.worker.postMessage(m);
  }

  private receive(m: FromWorker): void {
    switch (m.t) {
      case "ready":
        return;
      case "failed":
        return this.fail(m.error);
      case "decision": {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.trace) this.onTrace?.(m.trace);
        p.resolve(m.response);
        return;
      }
      case "error": {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        console.error("AI worker failed on a prompt, answering on the main thread:", m.error);
        p.resolve(this.shadow.decide(p.prompt));
      }
    }
  }

  /** The worker is unusable: answer everything (including what's waiting) on the main thread from now on. */
  private fail(error: string): void {
    if (this.failed) return;
    this.failed = true;
    console.warn("AI worker unavailable, thinking on the main thread:", error);
    this.worker.terminate();
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      p.resolve(this.shadow.decide(p.prompt));
    }
  }
}
