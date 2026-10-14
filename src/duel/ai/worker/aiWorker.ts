// The AI's Web Worker: an AiSeat with its own engine (for its simulations), fed redacted messages and masked boards by
// AiWorkerClient. Thinking here keeps the game's frames smooth, and between decisions the worker fills its brain's
// pool of prepared copies on its own. Messages are handled strictly in order (init loads the engine first).
import type { FieldSnapshot } from "../../DuelSession.ts";
import { loadEngine } from "../../loadEngine.ts";
import { AiSeat } from "../AiSeat.ts";
import { BRAINS } from "../brains.ts";
import type { TraceEntry } from "../trace.ts";
import type { FromWorker, ToWorker } from "./protocol.ts";

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker): void;
  close(): void;
};

let seat: AiSeat | null = null;
/** The board sent with the current decide request (AiSeat reads it as its duel's snapshot). */
let board: FieldSnapshot | null = null;
let lastTrace: TraceEntry | undefined;
let busy = false;
let queue = Promise.resolve();

scope.onmessage = (e) => {
  queue = queue.then(() => handle(e.data)).catch((err) => console.error("AI worker:", err));
};

async function handle(m: ToWorker): Promise<void> {
  switch (m.t) {
    case "init":
      try {
        const engine = await loadEngine();
        seat = new AiSeat({
          seat: m.seat, brain: BRAINS[m.brain]({ engine }), deck: m.deck ?? undefined, strict: false,
          duel: { cards: engine.cards, seed: m.seed, snapshot: () => board! },
          onTrace: m.trace ? (entry) => (lastTrace = entry) : undefined,
        });
        scope.postMessage({ t: "ready" });
        idle();
      } catch (err) {
        scope.postMessage({ t: "failed", error: String(err) });
      }
      return;
    case "observe":
      seat?.observe(m.messages);
      return;
    case "decide":
      if (!seat) { scope.postMessage({ t: "error", id: m.id, error: "not started" }); return; }
      board = m.board;
      busy = true;
      lastTrace = undefined;
      try {
        const response = seat.decide(m.prompt);
        scope.postMessage({ t: "decision", id: m.id, response, trace: lastTrace });
      } catch (err) {
        scope.postMessage({ t: "error", id: m.id, error: String(err) });
      } finally {
        busy = false;
        idle();
      }
      return;
    case "dispose":
      seat?.dispose();
      seat = null;
      scope.close();
  }
}

/** Between decisions: prepare copies one at a time, yielding to incoming messages in between. */
function idle(): void {
  if (seat && !busy && seat.idle()) setTimeout(idle, 0);
}
