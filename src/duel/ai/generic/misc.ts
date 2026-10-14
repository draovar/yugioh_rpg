// The smaller prompts: battle position, card / attribute / type declarations.
import { OcgMessageType, OcgPosition, OcgResponseType, type OcgMessage, type OcgResponse } from "ocgcore-wasm";
import { TYPE } from "../../cardData.ts";
import { declarableCards } from "../../autoBot.ts";
import type { AiView, Decision } from "../AiSeat.ts";
import { bestAtk, codeValue, theirs } from "../board.ts";

type Msg<T extends OcgMessageType> = Extract<OcgMessage, { type: T }>;

/** Attack position when the monster beats their best face-up attacker, else defense (face-down for flip effects). */
export function decidePosition(m: Msg<OcgMessageType.SELECT_POSITION>, view: AiView): Decision {
  const r = view.cards.records.get(m.code);
  const theirBest = bestAtk(theirs(view));
  const wants: OcgPosition[] = [];
  if (r && r.atk > theirBest && r.atk >= r.def) wants.push(OcgPosition.FACEUP_ATTACK);
  if (r && r.type & TYPE.FLIP) wants.push(OcgPosition.FACEDOWN_DEFENSE);
  wants.push(OcgPosition.FACEUP_DEFENSE, OcgPosition.FACEDOWN_DEFENSE, OcgPosition.FACEUP_ATTACK, OcgPosition.FACEDOWN_ATTACK);
  const position = wants.find((p) => m.positions & p)!;
  const reason = position === OcgPosition.FACEUP_ATTACK ? "it beats their monsters" : "it can't win fights";
  return { response: { type: OcgResponseType.SELECT_POSITION, position }, reason };
}

/** Declare a card: the most valuable one the opponent has shown this duel (likely more copies), else any legal one. */
export function decideAnnounceCard(m: Msg<OcgMessageType.ANNOUNCE_CARD>, view: AiView): Decision {
  const legal = declarableCards(view.cards, m.opcodes);
  const shown = [...view.memory.seen[1 - view.seat]].filter((c) => legal.includes(c));
  if (shown.length) {
    const card = shown.reduce((a, b) => (codeValue(view, b) > codeValue(view, a) ? b : a));
    return { response: { type: OcgResponseType.ANNOUNCE_CARD, card }, reason: "a card they've shown" };
  }
  const card = legal.length ? legal[Math.floor(view.rng() * legal.length)] : 89631139;
  return { response: { type: OcgResponseType.ANNOUNCE_CARD, card }, reason: "nothing shown yet: a guess" };
}

/** Bits of the opponent's shown monsters, most common first (for attribute / type declarations). */
function shownBits(view: AiView, field: "attribute" | "race"): bigint[] {
  const count = new Map<bigint, number>();
  for (const code of view.memory.seen[1 - view.seat]) {
    const r = view.cards.records.get(code);
    if (!r || !(r.type & TYPE.MONSTER)) continue;
    const bit = BigInt(r[field]);
    count.set(bit, (count.get(bit) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([bit]) => bit);
}

/** Declare attributes / types: the ones the opponent's shown monsters have most, then any available. */
export function decideAnnounceBits(
  m: Msg<OcgMessageType.ANNOUNCE_ATTRIB> | Msg<OcgMessageType.ANNOUNCE_RACE>, view: AiView,
): Decision {
  const isAttrib = m.type === OcgMessageType.ANNOUNCE_ATTRIB;
  const available = BigInt(m.available);
  const picked: bigint[] = [];
  for (const bit of shownBits(view, isAttrib ? "attribute" : "race"))
    if (picked.length < m.count && available & bit) picked.push(bit);
  for (let b = 0n; b < 64n && picked.length < m.count; b++) {
    const bit = 1n << b;
    if (available & bit && !picked.includes(bit)) picked.push(bit);
  }
  const response = (isAttrib
    ? { type: OcgResponseType.ANNOUNCE_ATTRIB, attributes: picked.map(Number) }
    : { type: OcgResponseType.ANNOUNCE_RACE, races: picked }) as OcgResponse;
  return { response, reason: "what their monsters are" };
}
