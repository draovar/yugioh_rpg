// Messages between the game (main thread) and the AI's Web Worker. The worker only ever receives what the AI's seat
// may see: messages already redacted and the board already masked on the main thread.
import type { OcgMessage, OcgResponse } from "ocgcore-wasm";
import type { DuelSeed, FieldSnapshot } from "../../DuelSession.ts";
import type { BrainName } from "../brains.ts";
import type { TraceEntry } from "../trace.ts";

export type ToWorker =
  | { t: "init"; seat: 0 | 1; brain: BrainName; deck: number[] | null; seed: DuelSeed; trace: boolean }
  /** One engine step's messages, redacted for the AI's seat. */
  | { t: "observe"; messages: OcgMessage[] }
  /** A prompt for the AI, with the board as its seat sees it. */
  | { t: "decide"; id: number; prompt: OcgMessage; board: FieldSnapshot }
  | { t: "dispose" };

export type FromWorker =
  | { t: "ready" }
  /** The worker couldn't start (engine or data failed to load): the game falls back to the main thread. */
  | { t: "failed"; error: string }
  | { t: "decision"; id: number; response: OcgResponse; trace?: TraceEntry }
  /** Deciding failed: the game answers this prompt on the main thread. */
  | { t: "error"; id: number; error: string };
