// Human-readable log lines for engine messages (null = not worth logging).
import { OcgLocation, OcgMessageType, type OcgMessage } from "ocgcore-wasm";
import type { DuelText } from "../../duel/text.ts";
import { PHASE_NAMES, attributeNames, raceNames } from "../../duel/text.ts";

/** HINT types the engine sends after a declaration (the player is the one who declared). */
const HINT_DECLARE = { race: 6, attribute: 7, code: 8, number: 9 } as const;

/** `me` = seat of the player on this machine ("You"); the other seat is "Opponent". */
export function describeMessage(m: OcgMessage, text: DuelText, me: number): string | null {
  /** "You Normal Summon" / "Opponent Normal Summons": subject + verb (last word) conjugated for the player. */
  const act = (p: number, verb: string) => (p === me ? `You ${verb}` : `Opponent ${verb.replace(/(\S+)$/, "$1s")}`);
  const whose = (p: number) => (p === me ? "Your" : "Opponent's");
  const name = (code: number) => (code ? text.name(code) : "a card");
  switch (m.type) {
    case OcgMessageType.NEW_TURN:
      return `-- ${whose(m.player)} turn --`;
    case OcgMessageType.NEW_PHASE:
      return PHASE_NAMES[m.phase] ? `${PHASE_NAMES[m.phase]}` : null;
    case OcgMessageType.DRAW:
      return m.player === me
        ? `You draw ${m.drawn.map((d) => name(d.code)).join(", ")}`
        : `Opponent draws ${m.drawn.length} card${m.drawn.length > 1 ? "s" : ""}`;
    case OcgMessageType.SUMMONING:
      return `${act(m.controller, "Normal Summon")} ${name(m.code)}`;
    case OcgMessageType.SPSUMMONING:
      return `${act(m.controller, "Special Summon")} ${name(m.code)}`;
    case OcgMessageType.FLIPSUMMONING:
      return `${act(m.controller, "Flip Summon")} ${name(m.code)}`;
    case OcgMessageType.SET:
      return `${act(m.controller, "Set")} a card`;
    case OcgMessageType.CHAINING:
      return `${act(m.controller, "activate")} ${name(m.code)}${m.chain_size > 1 ? ` (Chain ${m.chain_size})` : ""}`;
    case OcgMessageType.CHAIN_NEGATED:
    case OcgMessageType.CHAIN_DISABLED:
      return `Chain link ${m.chain_size} was negated`;
    case OcgMessageType.ATTACK:
      return m.target ? `${whose(m.card.controller)} monster attacks` : `${whose(m.card.controller)} monster attacks directly`;
    case OcgMessageType.DAMAGE:
      return `${act(m.player, "take")} ${m.amount} damage`;
    case OcgMessageType.RECOVER:
      return `${act(m.player, "gain")} ${m.amount} LP`;
    case OcgMessageType.PAY_LPCOST:
      return `${act(m.player, "pay")} ${m.amount} LP`;
    case OcgMessageType.MOVE:
      if (m.to.location === OcgLocation.GRAVE && m.from.location & (OcgLocation.MZONE | OcgLocation.SZONE))
        return `${name(m.card)} is sent to the Graveyard`;
      if (m.to.location === OcgLocation.REMOVED) return `${name(m.card)} is banished`;
      return null;
    case OcgMessageType.HINT: {
      const v = m.hint;
      switch (m.hint_type) {
        case HINT_DECLARE.race: return `${act(m.player, "declare")} ${raceNames(BigInt(v))}`;
        case HINT_DECLARE.attribute: return `${act(m.player, "declare")} ${attributeNames(Number(v))}`;
        case HINT_DECLARE.code: return `${act(m.player, "declare")} ${name(Number(v))}`;
        case HINT_DECLARE.number: return `${act(m.player, "declare")} ${v}`;
        default: return null;
      }
    }
    case OcgMessageType.WIN:
      return m.player === me ? "You win the duel!" : "You lose the duel.";
    default:
      return null;
  }
}
