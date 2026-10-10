// Thin, environment-agnostic wrapper around one ocgcore duel.
// Works the same in the browser (Vite) and in Node (tools/*.ts).
import {
  OcgDuelMode,
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgProcessResult,
  type OcgCoreSync,
  type OcgDuelHandle,
  type OcgMessage,
  type OcgResponse,
} from "ocgcore-wasm";
import type { CardDb } from "./cardData.ts";

export interface Deck {
  main: number[];
  extra?: number[];
}

export interface DuelConfig {
  core: OcgCoreSync;
  cards: CardDb;
  /** Returns a Lua script's source by file name (e.g. "c89631139.lua", "utility.lua"). */
  readScript: (name: string) => string | null;
  decks: [Deck, Deck];
  seed?: [bigint, bigint, bigint, bigint];
  startingLP?: number;
  onCoreLog?: (type: number, text: string) => void;
}

export interface StepResult {
  /** Every message the engine produced during this step, in order. */
  messages: OcgMessage[];
  /** The selection message the engine is waiting on, if any. */
  prompt: OcgMessage | null;
  /** Set once the duel is over (player index of the winner). */
  winner: number | null;
  ended: boolean;
}

export class DuelSession {
  private readonly core: OcgCoreSync;
  private readonly handle: OcgDuelHandle;
  private ended = false;

  constructor(cfg: DuelConfig) {
    this.core = cfg.core;
    const team = { drawCountPerTurn: 1, startingDrawCount: 5, startingLP: cfg.startingLP ?? 8000 };
    const handle = cfg.core.createDuel({
      flags: OcgDuelMode.MODE_GOAT,
      seed: cfg.seed ?? randomSeed(),
      team1: team,
      team2: team,
      cardReader: (code) => cfg.cards.get(code),
      scriptReader: cfg.readScript,
      errorHandler: cfg.onCoreLog ?? ((type, text) => console.warn("[ocgcore]", type, text)),
    });
    if (!handle) throw new Error("ocgcore: createDuel failed");
    this.handle = handle;

    for (const s of ["constant.lua", "utility.lua"]) {
      const src = cfg.readScript(s);
      if (!src) throw new Error(`missing engine script ${s}`);
      this.core.loadScript(handle, s, src);
    }

    cfg.decks.forEach((deck, team) => {
      const add = (code: number, location: OcgLocation) =>
        this.core.duelNewCard(this.handle, {
          team: team as 0 | 1, duelist: 0, code, controller: team as 0 | 1,
          location, sequence: 0, position: OcgPosition.FACEDOWN_DEFENSE,
        });
      deck.main.forEach((c) => add(c, OcgLocation.DECK));
      deck.extra?.forEach((c) => add(c, OcgLocation.EXTRA));
    });

    this.core.startDuel(this.handle);
  }

  /** Runs the engine until it needs a decision or the duel ends. */
  advance(): StepResult {
    const messages: OcgMessage[] = [];
    let winner: number | null = null;
    while (!this.ended) {
      const status = this.core.duelProcess(this.handle);
      const batch = this.core.duelGetMessage(this.handle);
      messages.push(...batch);
      for (const m of batch) {
        if (m.type === OcgMessageType.RETRY) throw new Error("ocgcore rejected the last response (RETRY)");
        if (m.type === OcgMessageType.WIN) { winner = m.player; this.ended = true; }
      }
      if (status === OcgProcessResult.END) this.ended = true;
      if (status === OcgProcessResult.WAITING && !this.ended) {
        return { messages, prompt: batch[batch.length - 1], winner, ended: false };
      }
    }
    return { messages, prompt: null, winner, ended: true };
  }

  respond(response: OcgResponse): void {
    this.core.duelSetResponse(this.handle, response);
  }

  get isOver(): boolean {
    return this.ended;
  }

  destroy(): void {
    this.core.destroyDuel(this.handle);
  }
}

function randomSeed(): [bigint, bigint, bigint, bigint] {
  const a = new Uint32Array(8);
  crypto.getRandomValues(a);
  return [0, 2, 4, 6].map((i) => (BigInt(a[i]) << 32n) | BigInt(a[i + 1])) as [bigint, bigint, bigint, bigint];
}
