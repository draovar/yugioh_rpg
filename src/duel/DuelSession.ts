// Thin, environment-agnostic wrapper around one ocgcore duel.
// Works the same in the browser (Vite) and in Node (tools/*.ts).
import {
  OcgDuelMode,
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgProcessResult,
  OcgQueryFlags,
  type OcgCardQueryInfo,
  type OcgCoreSync,
  type OcgDuelHandle,
  type OcgMessage,
  type OcgResponse,
} from "ocgcore-wasm";
import type { CardDb } from "./cardData.ts";

export interface Deck {
  main: number[];
  extra?: number[];
  /**
   * Cards placed before the duel starts (dev test setups): in the hand, or face-up on the field
   * (`sequence` = zone). The opening hand is still drawn from `main` on top of these.
   */
  start?: StartCard[];
}

export interface StartCard {
  code: number;
  /** HAND, MZONE or SZONE. */
  location: OcgLocation;
  sequence?: number;
  position?: OcgPosition;
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

/** One card as the viewing player is allowed to see it. */
export interface CardView {
  /** 0 when the card is hidden from the viewer (opponent's hand, opponent's face-down cards). */
  code: number;
  controller: 0 | 1;
  location: OcgLocation;
  sequence: number;
  position: OcgPosition;
  faceDown: boolean;
  attack: number;
  defense: number;
  /** Counters on the card (all kinds added up, e.g. Spell Counters); public, so never hidden. */
  counters: number;
}

export interface PlayerView {
  lp: number;
  deckCount: number;
  extraCount: number;
  hand: CardView[];
  /** Index = zone sequence (0-4 main monster zones). */
  monsters: (CardView | null)[];
  /** Index = zone sequence (0-4 spell/trap zones, 5 = field zone). */
  spells: (CardView | null)[];
  grave: CardView[];
  banished: CardView[];
}

export interface FieldSnapshot {
  players: [PlayerView, PlayerView];
}

const QUERY_FLAGS = (OcgQueryFlags.CODE | OcgQueryFlags.POSITION | OcgQueryFlags.ATTACK | OcgQueryFlags.DEFENSE | OcgQueryFlags.COUNTERS) as OcgQueryFlags;

/** A NEW_TURN message with the duel's turn number (1, 2, ...) added by DuelSession. */
export type NewTurnMessage = Extract<OcgMessage, { type: OcgMessageType.NEW_TURN }> & { turn?: number };

/** A MOVE message with the move reason added by DuelSession (see annotateMoveReasons). */
export type MoveMessage = Extract<OcgMessage, { type: OcgMessageType.MOVE }> & { reason?: number };

/** ocgcore REASON_* bits we care about. */
export const REASON = { DESTROY: 0x1, RELEASE: 0x2, BATTLE: 0x20, COST: 0x80, DISCARD: 0x4000 } as const;

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
  /** Turns started so far (numbers NEW_TURN messages). */
  private turn = 0;

  constructor(cfg: DuelConfig) {
    this.core = cfg.core;
    const team = { drawCountPerTurn: 1, startingDrawCount: 5, startingLP: cfg.startingLP ?? 8000 };
    const seed = cfg.seed ?? randomSeed();
    const handle = cfg.core.createDuel({
      flags: OcgDuelMode.MODE_GOAT,
      seed,
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

    // ocgcore does not shuffle at duel start (EDOPro shuffles client-side), so we do it here,
    // driven by the duel seed so a given seed always replays the same duel.
    const rng = mulberry32(Number(seed[0] & 0xffffffffn));
    cfg.decks.forEach((deck, team) => {
      const add = (code: number, location: OcgLocation) =>
        this.core.duelNewCard(this.handle, {
          team: team as 0 | 1, duelist: 0, code, controller: team as 0 | 1,
          location, sequence: 0, position: OcgPosition.FACEDOWN_DEFENSE,
        });
      shuffle([...deck.main], rng).forEach((c) => add(c, OcgLocation.DECK));
      deck.extra?.forEach((c) => add(c, OcgLocation.EXTRA));
      deck.start?.forEach((c) =>
        this.core.duelNewCard(this.handle, {
          team: team as 0 | 1, duelist: 0, code: c.code, controller: team as 0 | 1, location: c.location, sequence: c.sequence ?? 0,
          position: c.position ?? (c.location === OcgLocation.HAND ? OcgPosition.FACEDOWN_DEFENSE : OcgPosition.FACEUP_ATTACK),
        }));
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
      this.annotateMoveReasons(batch);
      messages.push(...batch);
      for (const m of batch) {
        if (m.type === OcgMessageType.NEW_TURN) (m as NewTurnMessage).turn = ++this.turn;
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

  /**
   * ocgcore-wasm's MOVE parser drops the move reason, so look it up: right after the batch, the moved
   * card sits at its destination and the engine still knows why it got there (REASON_* bits).
   */
  private annotateMoveReasons(batch: OcgMessage[]) {
    for (const m of batch) {
      if (m.type !== OcgMessageType.MOVE || !m.to.location) continue;
      const q = this.core.duelQuery(this.handle, {
        flags: (OcgQueryFlags.CODE | OcgQueryFlags.REASON) as OcgQueryFlags,
        controller: m.to.controller, location: m.to.location, sequence: m.to.sequence, overlaySequence: 0,
      });
      if (q && q.code === m.card && q.reason !== undefined) (m as MoveMessage).reason = q.reason;
    }
  }

  respond(response: OcgResponse): void {
    this.core.duelSetResponse(this.handle, response);
  }

  /**
   * Reads the current board straight from the engine, hiding anything `viewer` may not see.
   * Cheap enough to call after every step.
   */
  snapshot(viewer: 0 | 1): FieldSnapshot {
    const field = this.core.duelQueryField(this.handle);
    const read = (controller: 0 | 1, location: OcgLocation) =>
      this.core.duelQueryLocation(this.handle, { flags: QUERY_FLAGS, controller, location })
        .map((q, sequence) => (q ? this.toView(q, controller, location, sequence, viewer) : null));
    const players = ([0, 1] as const).map((p): PlayerView => ({
      // `lp` is returned at runtime but missing from the package's OcgFieldPlayer type.
      // It is also unsigned, so overkill damage wraps around: reinterpret as int32 and clamp at 0.
      lp: Math.max(0, (field.players[p] as typeof field.players[number] & { lp: number }).lp | 0),
      deckCount: field.players[p].deck_size,
      extraCount: field.players[p].extra_size,
      hand: read(p, OcgLocation.HAND).filter((c) => c !== null),
      monsters: read(p, OcgLocation.MZONE).slice(0, 5),
      spells: read(p, OcgLocation.SZONE).slice(0, 6),
      grave: read(p, OcgLocation.GRAVE).filter((c) => c !== null),
      banished: read(p, OcgLocation.REMOVED).filter((c) => c !== null),
    }));
    return { players: players as [PlayerView, PlayerView] };
  }

  private toView(q: Partial<OcgCardQueryInfo>, controller: 0 | 1, location: OcgLocation, sequence: number, viewer: 0 | 1): CardView {
    const position = (q.position ?? OcgPosition.FACEDOWN_DEFENSE) as OcgPosition;
    const faceDown = location !== OcgLocation.HAND && (position & (OcgPosition.FACEDOWN_ATTACK | OcgPosition.FACEDOWN_DEFENSE)) !== 0;
    const hidden = controller !== viewer && (location === OcgLocation.HAND || faceDown);
    return {
      code: hidden ? 0 : q.code ?? 0,
      controller, location, sequence, position, faceDown,
      attack: hidden ? 0 : q.attack ?? 0,
      defense: hidden ? 0 : q.defense ?? 0,
      counters: Object.values(q.counters ?? {}).reduce((n, c) => n + c, 0),
    };
  }

  /**
   * Fingerprint of the whole board (both sides, nothing hidden). Peer-to-peer duels send it with every
   * answer, so two machines whose duels drifted apart notice at once instead of playing on diverged.
   */
  checksum(): number {
    const s = JSON.stringify([this.snapshot(0), this.snapshot(1)]);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return h >>> 0;
  }

  get isOver(): boolean {
    return this.ended;
  }

  destroy(): void {
    this.core.destroyDuel(this.handle);
  }
}

function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(a: T[], rng: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomSeed(): [bigint, bigint, bigint, bigint] {
  const a = new Uint32Array(8);
  crypto.getRandomValues(a);
  return [0, 2, 4, 6].map((i) => (BigInt(a[i]) << 32n) | BigInt(a[i + 1])) as [bigint, bigint, bigint, bigint];
}
