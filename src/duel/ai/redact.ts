// The one gate between the engine's raw messages and the AI. ocgcore writes every message with full information
// (a DRAW lists the drawn cards for either player, a SET names the card); EDOPro's server strips what each player may
// not see before sending. This does the same for one viewer, so the AI only learns what a player in its seat would.
// Rules follow ygopro's server (SingleDuel::Analyze), slightly more generous where a card's identity was public anyway.
import {
  OcgHintType,
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  type OcgLocPos,
  type OcgMessage,
} from "ocgcore-wasm";

const FACEDOWN = OcgPosition.FACEDOWN_ATTACK | OcgPosition.FACEDOWN_DEFENSE;

/** Selections (and declarations) the engine asks of one player; the other player never sees them. */
export const PROMPT_TYPES: ReadonlySet<OcgMessageType> = new Set([
  OcgMessageType.SELECT_BATTLECMD, OcgMessageType.SELECT_IDLECMD, OcgMessageType.SELECT_EFFECTYN,
  OcgMessageType.SELECT_YESNO, OcgMessageType.SELECT_OPTION, OcgMessageType.SELECT_CARD, OcgMessageType.SELECT_CHAIN,
  OcgMessageType.SELECT_PLACE, OcgMessageType.SELECT_POSITION, OcgMessageType.SELECT_TRIBUTE, OcgMessageType.SORT_CHAIN,
  OcgMessageType.SELECT_COUNTER, OcgMessageType.SELECT_SUM, OcgMessageType.SELECT_DISFIELD, OcgMessageType.SORT_CARD,
  OcgMessageType.SELECT_UNSELECT_CARD, OcgMessageType.ROCK_PAPER_SCISSORS, OcgMessageType.ANNOUNCE_RACE,
  OcgMessageType.ANNOUNCE_ATTRIB, OcgMessageType.ANNOUNCE_CARD, OcgMessageType.ANNOUNCE_NUMBER,
]);

/** Hint types shown only to `hint.player` (ygopro: 1, 2, 3, 5) and only to their opponent (4, 6, 7, 8, 9, 11). */
const OWN_HINTS: ReadonlySet<number> = new Set([OcgHintType.EVENT, OcgHintType.MESSAGE, OcgHintType.SELECTMSG, OcgHintType.EFFECT]);
const OPPONENT_HINTS: ReadonlySet<number> = new Set([
  OcgHintType.OPSELECTED, OcgHintType.RACE, OcgHintType.ATTRIB, OcgHintType.CODE, OcgHintType.NUMBER, OcgHintType.ZONE,
]);

/** Whether a card in this place and position is face-up for everyone. */
export function isPublic(location: OcgLocation, position: OcgPosition): boolean {
  if (location === OcgLocation.GRAVE || location === OcgLocation.OVERLAY) return true;
  if (location === OcgLocation.DECK || location === OcgLocation.HAND) return false;
  return (position & FACEDOWN) === 0;
}

/**
 * The messages as `viewer` may see them: hidden card codes become 0 and other players' prompts and private hints are
 * dropped. Never mutates the input (the scene animates from the same messages); changed messages are copies.
 */
export function redact(messages: readonly OcgMessage[], viewer: 0 | 1): OcgMessage[] {
  const out: OcgMessage[] = [];
  for (const m of messages) {
    const r = redactOne(m, viewer);
    if (r) out.push(r);
  }
  return out;
}

function redactOne(m: OcgMessage, viewer: 0 | 1): OcgMessage | null {
  if (PROMPT_TYPES.has(m.type)) return (m as { player: number }).player === viewer ? m : null;
  switch (m.type) {
    case OcgMessageType.HINT:
      if (OWN_HINTS.has(m.hint_type)) return m.player === viewer ? m : null;
      if (OPPONENT_HINTS.has(m.hint_type)) return m.player !== viewer ? m : null;
      return m;
    case OcgMessageType.MISSED_EFFECT:
      return m.controller === viewer ? m : null;
    case OcgMessageType.DRAW:
      if (m.player === viewer) return m;
      return { ...m, drawn: m.drawn.map((d) => (d.position & OcgPosition.FACEUP ? d : { ...d, code: 0 })) };
    case OcgMessageType.MOVE:
      return moveVisible(m.from, m.to, viewer) ? m : { ...m, card: 0 };
    case OcgMessageType.SET:
      return m.controller === viewer ? m : { ...m, code: 0 };
    case OcgMessageType.SHUFFLE_HAND:
    case OcgMessageType.SHUFFLE_EXTRA:
      return m.player === viewer ? m : { ...m, cards: m.cards.map(() => 0) };
    case OcgMessageType.CONFIRM_CARDS:
      // Cards in a Deck are shown only to the confirming player; anything else is shown to both.
      if (m.player === viewer) return m;
      return { ...m, cards: m.cards.map((c) => (c.location === OcgLocation.DECK ? { ...c, code: 0 } : c)) };
    case OcgMessageType.POS_CHANGE:
      // Face-down to face-down (e.g. a set monster changing position) keeps it hidden.
      if (m.controller === viewer || !(m.prev_position & FACEDOWN) || !(m.position & FACEDOWN)) return m;
      return { ...m, code: 0 };
    case OcgMessageType.SWAP: {
      const hide = (c: typeof m.card1) => (c.controller !== viewer && !isPublic(c.location, c.position) ? { ...c, code: 0 } : c);
      return { ...m, card1: hide(m.card1), card2: hide(m.card2) };
    }
    case OcgMessageType.SPSUMMONING:
      return m.controller === viewer || !(m.position & FACEDOWN) ? m : { ...m, code: 0 };
    default:
      return m;
  }
}

/**
 * A moved card's identity is visible to `viewer` if it was public where it came from or where it lands, or the viewer
 * held it before (not in their Deck: they don't know their Deck order) or holds it afterwards outside their Deck.
 */
function moveVisible(from: OcgLocPos, to: OcgLocPos, viewer: 0 | 1): boolean {
  // location 0 = the card is new to the duel (a token): public.
  if (!from.location || isPublic(from.location, from.position)) return true;
  if (to.location && isPublic(to.location, to.position)) return true;
  if (from.controller === viewer && from.location !== OcgLocation.DECK) return true;
  return !!to.location && to.controller === viewer && to.location !== OcgLocation.DECK;
}
