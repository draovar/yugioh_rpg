// What the AI remembers about the duel so far, built only from redacted messages (see redact.ts).
// The board itself comes from `snapshot(seat)`; this holds what a board snapshot can't show: turn and phase, the
// open chain, what each player has revealed, the attacks declared this turn.
import { OcgHintType, OcgLocation, OcgMessageType, type OcgLocPos, type OcgMessage } from "ocgcore-wasm";

/** Piles always belong to the card's owner (a stolen card still goes to its owner's GY or hand). */
const PILES = OcgLocation.DECK | OcgLocation.HAND | OcgLocation.GRAVE | OcgLocation.REMOVED | OcgLocation.EXTRA;

export interface ChainLink {
  code: number;
  controller: 0 | 1;
  /** Where the card was when it was activated. */
  place: { location: number; sequence: number };
  description: bigint;
  /** Cards its activation targets (BECOME_TARGET while it was the newest link). */
  targets: OcgLocPos[];
  /** Its activation or effect was negated (CHAIN_NEGATED / CHAIN_DISABLED). */
  negated: boolean;
}

export interface Attack {
  attacker: OcgLocPos;
  /** null = direct attack. */
  target: OcgLocPos | null;
}

/** The last thing a player did that others may respond to. */
export interface LastAction {
  kind: "summon" | "flip summon" | "special summon" | "attack" | "activate";
  player: 0 | 1;
  code: number;
}

export class AiMemory {
  /** Turns started so far (1 = the first turn). */
  turn = 0;
  turnPlayer: 0 | 1 = 0;
  /** The current phase (OcgPhase bits). */
  phase = 0;
  /** The chain being built or resolved; empty outside chains. */
  chain: ChainLink[] = [];
  /** Attacks declared this turn, in order. */
  attacks: Attack[] = [];
  /** The latest summon, attack or activation (cleared at each new phase). */
  lastAction: LastAction | null = null;
  /**
   * Card codes each player has shown this duel (cards on the field, in the GY, revealed, activated), mostly by owner:
   * a card moving to or from a pile counts for that pile's player, but one seen only while stolen counts for whoever
   * controlled it. Our own side includes our draws. For guessing what the opponent's deck holds.
   */
  readonly seen: [Set<number>, Set<number>] = [new Set(), new Set()];
  /** The pending "Select the card(s) to …" system string id for our next prompt (HINT_SELECTMSG). */
  hint: bigint | null = null;

  readonly seat: 0 | 1;

  constructor(seat: 0 | 1) {
    this.seat = seat;
  }

  /** Feeds one engine step's messages, already redacted for `seat`. */
  update(messages: readonly OcgMessage[]): void {
    for (const m of messages) this.updateOne(m);
  }

  private see(controller: number, code: number): void {
    if (code) this.seen[controller & 1].add(code);
  }

  private updateOne(m: OcgMessage): void {
    switch (m.type) {
      case OcgMessageType.NEW_TURN:
        this.turn++;
        this.turnPlayer = (m.player & 1) as 0 | 1;
        this.attacks = [];
        break;
      case OcgMessageType.NEW_PHASE:
        this.phase = m.phase;
        this.lastAction = null;
        break;
      case OcgMessageType.HINT:
        if (m.hint_type === OcgHintType.SELECTMSG && m.player === this.seat) this.hint = m.hint;
        break;
      case OcgMessageType.CHAINING:
        this.see(m.controller, m.code);
        this.lastAction = { kind: "activate", player: m.controller, code: m.code };
        this.chain.push({
          code: m.code, controller: m.controller, place: { location: m.location, sequence: m.sequence },
          description: m.description, targets: [], negated: false,
        });
        break;
      case OcgMessageType.BECOME_TARGET:
        this.chain.at(-1)?.targets.push(...m.cards);
        break;
      case OcgMessageType.CHAIN_NEGATED:
      case OcgMessageType.CHAIN_DISABLED: {
        const link = this.chain[m.chain_size - 1];
        if (link) link.negated = true;
        break;
      }
      case OcgMessageType.CHAIN_END:
        this.chain = [];
        break;
      case OcgMessageType.ATTACK:
        this.attacks.push({ attacker: m.card, target: m.target });
        this.lastAction = { kind: "attack", player: m.card.controller, code: 0 };
        break;
      case OcgMessageType.SUMMONING:
      case OcgMessageType.SPSUMMONING:
      case OcgMessageType.FLIPSUMMONING: {
        this.see(m.controller, m.code);
        const kind = m.type === OcgMessageType.SUMMONING ? "summon" : m.type === OcgMessageType.SPSUMMONING ? "special summon" : "flip summon";
        this.lastAction = { kind, player: m.controller, code: m.code };
        break;
      }
      // Everything below only records which cards were seen.
      case OcgMessageType.DRAW:
        for (const d of m.drawn) this.see(m.player, d.code);
        break;
      case OcgMessageType.MOVE: {
        // By owner: a pile at either end tells whose card it is; field to field (a control change) tells nothing new.
        const end = m.to.location & PILES || !m.from.location ? m.to : m.from.location & PILES ? m.from : null;
        if (end) this.see(end.controller, m.card);
        break;
      }
      case OcgMessageType.SET:
      case OcgMessageType.POS_CHANGE:
        this.see(m.controller, m.code);
        break;
      case OcgMessageType.CONFIRM_CARDS:
      case OcgMessageType.CONFIRM_DECKTOP:
        for (const c of m.cards) this.see(c.controller, c.code);
        break;
      case OcgMessageType.SHUFFLE_HAND:
        for (const c of m.cards) this.see(m.player, c);
        break;
      case OcgMessageType.SWAP:
        this.see(m.card1.controller, m.card1.code);
        this.see(m.card2.controller, m.card2.code);
        break;
    }
  }
}
