// Thin, environment-agnostic wrapper around one ocgcore duel.
// Works the same in the browser (Vite) and in Node (tools/*.ts).
import {
  OcgDuelMode,
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgProcessResult,
  OcgQueryFlags,
  OcgResponseType,
  type OcgCardQueryInfo,
  type OcgCoreSync,
  type OcgDuelHandle,
  type OcgMessage,
  type OcgResponse,
} from "ocgcore-wasm";
import type { CardDb } from "./cardData.ts";
import { fnv1a } from "./hash.ts";
import { mulberry32, shuffle } from "./rng.ts";

export interface Deck {
  main: number[];
  extra?: number[];
  /**
   * Cards placed before the duel starts (dev test setups): in the hand, or on the field (`sequence` = zone; face-up
   * unless `position` says otherwise). The opening hand is still drawn from `main` on top of these.
   */
  start?: StartCard[];
}

export interface StartCard {
  code: number;
  /** HAND, MZONE or SZONE. */
  location: OcgLocation;
  sequence?: number;
  position?: OcgPosition;
  /**
   * An Equip Spell in the Spell & Trap Zone: equipped to the monster in this Monster Zone (`team` = the duel's team
   * controlling it) as the duel starts, at the first draw phase. (The AI's copies keep a board's equip links this way.)
   */
  equipTo?: { team: 0 | 1; sequence: number };
  /**
   * A card in the Spell & Trap Zone that targets monsters for as long as it stays (Shadow Spell, Spellbinding Circle,
   * Call of the Haunted): the monsters in these Monster Zones, linked at the first draw phase like `equipTo`.
   */
  cardTargets?: { team: 0 | 1; sequence: number }[];
}

export type DuelSeed = [bigint, bigint, bigint, bigint];

export interface DuelConfig {
  core: OcgCoreSync;
  cards: CardDb;
  /** Returns a Lua script's source by file name (e.g. "c89631139.lua", "utility.lua"). */
  readScript: (name: string) => string | null;
  decks: [Deck, Deck];
  seed?: DuelSeed;
  /** One value for both players, or one per player. Default 8000. */
  startingLP?: number | [number, number];
  /** Opening hand and cards drawn per turn. Default 5 and 1 (the AI's rebuilt boards use 0 and 0). */
  draws?: { opening: number; perTurn: number };
  /** Duel mode flags added to MODE_GOAT (e.g. attack on the first turn, for the AI's rebuilt boards). */
  extraFlags?: bigint;
  onCoreLog?: (type: number, text: string) => void;
  /**
   * An engine duel set up ahead of time by `prepareDuel` with this same config (the slow part: ~15 ms of base scripts).
   * Only the LP may differ: they're set once the duel has started. Each prepared duel can be used once.
   */
  prepared?: PreparedDuel;
}

/** An engine duel with its base scripts loaded and no cards yet (`prepareDuel`). */
export interface PreparedDuel {
  readonly handle: OcgDuelHandle;
  /** The LP it was created with. */
  readonly lp: readonly [number, number];
}

/** Creates the engine duel for `cfg` and loads constant.lua and utility.lua into it: everything before the cards. */
export function prepareDuel(cfg: Omit<DuelConfig, "decks" | "prepared">): PreparedDuel {
  const lp = cfg.startingLP ?? 8000;
  const lps: [number, number] = typeof lp === "number" ? [lp, lp] : lp;
  const draws = { drawCountPerTurn: cfg.draws?.perTurn ?? 1, startingDrawCount: cfg.draws?.opening ?? 5 };
  const handle = cfg.core.createDuel({
    flags: OcgDuelMode.MODE_GOAT | (cfg.extraFlags ?? 0n),
    seed: cfg.seed!,
    team1: { ...draws, startingLP: lps[0] },
    team2: { ...draws, startingLP: lps[1] },
    cardReader: (code) => cfg.cards.get(code),
    scriptReader: cfg.readScript,
    errorHandler: cfg.onCoreLog ?? ((type, text) => console.warn("[ocgcore]", type, text)),
  });
  if (!handle) throw new Error("ocgcore: createDuel failed");
  for (const s of ["constant.lua", "utility.lua"]) {
    const src = cfg.readScript(s);
    if (!src) throw new Error(`missing engine script ${s}`);
    cfg.core.loadScript(handle, s, src);
  }
  return { handle, lp: lps };
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
  /** Counters on the card, one entry per kind (e.g. Spell Counters); public, so never hidden. */
  counters: CounterView[];
  /** Equip Spells (and other equips): the monster this card is equipped to; public. */
  equipTarget?: CardPlace;
  /** Cards this one targets for as long as it stays (Shadow Spell's monster, Call of the Haunted's); public. */
  cardTargets?: CardPlace[];
}

/** Counters of one kind on a card: `kind` is the counter type (COUNTER_SPELL = 0x1...), see `DuelText.counterName`. */
export interface CounterView {
  kind: number;
  count: number;
}

/** Where a card is: enough to find its CardView in a snapshot. */
export interface CardPlace {
  controller: 0 | 1;
  location: OcgLocation;
  sequence: number;
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
  /** Extra Deck cards: the viewer sees their own; the opponent's are face-down, so hidden (code 0). */
  extra: CardView[];
}

export interface FieldSnapshot {
  players: [PlayerView, PlayerView];
}

const QUERY_FLAGS = (OcgQueryFlags.CODE | OcgQueryFlags.POSITION | OcgQueryFlags.ATTACK | OcgQueryFlags.DEFENSE | OcgQueryFlags.COUNTERS | OcgQueryFlags.EQUIP_CARD | OcgQueryFlags.TARGET_CARD) as OcgQueryFlags;

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
  /** The game's cards (pool + tokens), e.g. for answering card declarations. */
  readonly cards: CardDb;
  /** The duel's seed (given or random): replaying it with the same answers replays the duel. */
  readonly seed: DuelSeed;
  private readonly core: OcgCoreSync;
  private readonly handle: OcgDuelHandle;
  private ended = false;
  /** Turns started so far (numbers NEW_TURN messages). */
  private turn = 0;

  constructor(cfg: DuelConfig) {
    this.core = cfg.core;
    this.cards = cfg.cards;
    const seed = (this.seed = cfg.seed ?? randomSeed());
    const prepared = cfg.prepared ?? prepareDuel({ ...cfg, seed });
    this.handle = prepared.handle;

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
    // Equip links: Duel.Equip has to run inside the duel (it yields), so a one-off effect does it at the first draw phase.
    // Card targets (persistent Traps) are linked there too, the way their activation does it (proc_persistent.lua).
    const links = (pick: (c: StartCard) => { team: 0 | 1; sequence: number }[]) => cfg.decks.flatMap((deck, team) =>
      (deck.start ?? []).flatMap((c) => c.location === OcgLocation.SZONE
        ? pick(c).map((t) => `{${team},${c.sequence ?? 0},${t.team},${t.sequence}}`) : []));
    const equips = links((c) => (c.equipTo ? [c.equipTo] : []));
    const targets = links((c) => c.cardTargets ?? []);
    if (equips.length || targets.length) this.core.loadScript(this.handle, "start_links.lua", `local e=Effect.GlobalEffect()
e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_PHASE_START+PHASE_DRAW)
e:SetOperation(function(e)
  for _,q in ipairs({${equips.join(",")}}) do
    local ec=Duel.GetFieldCard(q[1],LOCATION_SZONE,q[2])
    local tc=Duel.GetFieldCard(q[3],LOCATION_MZONE,q[4])
    if ec and tc then Duel.Equip(q[1],ec,tc) end
  end
  for _,q in ipairs({${targets.join(",")}}) do
    local c=Duel.GetFieldCard(q[1],LOCATION_SZONE,q[2])
    local tc=Duel.GetFieldCard(q[3],LOCATION_MZONE,q[4])
    if c and tc then c:SetCardTarget(tc) c:CreateRelation(tc,RESET_EVENT+RESETS_STANDARD) end
  end
  e:Reset()
end)
Duel.RegisterEffect(e,0)`);
    // A prepared duel was created with other LP: set the real ones before anything happens.
    const lp = cfg.startingLP ?? 8000;
    const [lp0, lp1] = typeof lp === "number" ? [lp, lp] : lp;
    if (lp0 !== prepared.lp[0] || lp1 !== prepared.lp[1]) this.core.loadScript(this.handle, "set_lp.lua", `Duel.SetLP(0, ${lp0}) Duel.SetLP(1, ${lp1})`);
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
    if (response.type === OcgResponseType.SORT_CARD && response.order) response = { ...response, order: rawSortOrder(response.order) };
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
      extra: read(p, OcgLocation.EXTRA).filter((c) => c !== null),
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
      counters: counterList(q.counters),
      ...(q.equipCard ? { equipTarget: { controller: q.equipCard.controller, location: q.equipCard.location, sequence: q.equipCard.sequence } } : {}),
      ...(q.targetCards?.length && !hidden ? { cardTargets: q.targetCards.map((t) => ({ controller: t.controller, location: t.location, sequence: t.sequence })) } : {}),
    };
  }

  /**
   * Fingerprint of the whole board (both sides, nothing hidden). Peer-to-peer duels send it with every
   * answer, so two machines whose duels drifted apart notice at once instead of playing on diverged.
   */
  checksum(): number {
    return fnv1a(JSON.stringify([this.snapshot(0), this.snapshot(1)]));
  }

  destroy(): void {
    this.core.destroyDuel(this.handle);
  }
}

/**
 * ocgcore-wasm writes a SORT_CARD answer as `order.length` followed by the order, but the core reads the order bytes
 * alone (so every real order came back as RETRY). Its encoder only reads `.length` and iterates the array, so this
 * hands it an iterable whose `.length` is the first value: the bytes come out as exactly `order`.
 */
function rawSortOrder(order: number[]): number[] {
  return { length: order[0], [Symbol.iterator]: () => order.slice(1)[Symbol.iterator]() } as unknown as number[];
}

/**
 * Counters on a card. ocgcore packs each counter kind as `kind | count << 16`, and ocgcore-wasm's parser
 * swaps the halves: its record is `{ [count]: kind }`. So the counts are the keys. (Two kinds with the same count
 * would collide into one entry; no card in the pool has two kinds.)
 */
function counterList(counters: Record<number, number> | undefined): CounterView[] {
  return Object.entries(counters ?? {}).map(([count, kind]) => ({ kind: Number(kind), count: Number(count) })).filter((c) => c.count > 0);
}

/** All counters on a card, every kind added up. */
export function counterTotal(counters: CounterView[]): number {
  return counters.reduce((n, c) => n + c.count, 0);
}

/** A random duel seed (four 64-bit words). */
export function randomSeed(): DuelSeed {
  const a = crypto.getRandomValues(new BigUint64Array(4));
  return [a[0], a[1], a[2], a[3]];
}
