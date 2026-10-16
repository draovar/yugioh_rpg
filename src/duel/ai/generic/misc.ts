// The smaller prompts: battle position, card / attribute / type declarations.
import { OcgMessageType, OcgPhase, OcgPosition, OcgResponseType, type OcgMessage, type OcgResponse } from "ocgcore-wasm";
import { TYPE } from "../../cardData.ts";
import { declarableCards } from "../../autoBot.ts";
import type { AiView, Decision } from "../AiSeat.ts";
import { DEFENSE, bestAtk, codeValue, mine, theirs } from "../board.ts";

type Msg<T extends OcgMessageType> = Extract<OcgMessage, { type: T }>;

/**
 * Attack position when the monster beats their best face-up monster, or when it can destroy one of theirs in battle
 * this turn (ATK against a Defense Position monster's DEF) and their best one attacking it next turn wouldn't cost all
 * our LP; else defense (face-down for flip effects).
 */
export function decidePosition(m: Msg<OcgMessageType.SELECT_POSITION>, view: AiView): Decision {
  const r = view.cards.records.get(m.code);
  const opp = theirs(view);
  const theirBest = bestAtk(opp);
  const canBattle = view.memory.phase === OcgPhase.MAIN1 && view.memory.turn > 1 && view.memory.turnPlayer === view.seat;
  const destroys = (atk: number) => canBattle && opp.monsters.some((c) => c && !c.faceDown && atk > (c.position & DEFENSE ? c.defense : c.attack));
  const wants: OcgPosition[] = [];
  const survives = (atk: number) => theirBest - atk < mine(view).lp;
  if (r && r.atk >= r.def && (r.atk > theirBest || (destroys(r.atk) && survives(r.atk)))) wants.push(OcgPosition.FACEUP_ATTACK);
  if (r && r.type & TYPE.FLIP) wants.push(OcgPosition.FACEDOWN_DEFENSE);
  wants.push(OcgPosition.FACEUP_DEFENSE, OcgPosition.FACEDOWN_DEFENSE, OcgPosition.FACEUP_ATTACK, OcgPosition.FACEDOWN_ATTACK);
  const position = wants.find((p) => m.positions & p)!;
  const reason = position !== OcgPosition.FACEUP_ATTACK ? "it can't win fights" : r && r.atk > theirBest ? "it beats their monsters" : "it can destroy one of theirs";
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

/**
 * Attribute / type bits by how well a declaration of them hits the opponent: their face-up monsters count for it, ours
 * against it (Tribe-Infecting Virus destroys both sides), monsters they've shown this duel a little.
 */
function bitScores(view: AiView, field: "attribute" | "race"): Map<bigint, number> {
  const score = new Map<bigint, number>();
  const add = (code: number, weight: number) => {
    const r = view.cards.records.get(code);
    if (!r || !(r.type & TYPE.MONSTER)) return;
    const bit = BigInt(r[field]);
    score.set(bit, (score.get(bit) ?? 0) + weight);
  };
  for (const c of theirs(view).monsters) if (c?.code) add(c.code, 2);
  for (const c of mine(view).monsters) if (c?.code && !c.faceDown) add(c.code, -2);
  for (const code of view.memory.seen[1 - view.seat]) add(code, 0.5);
  return score;
}

/** Declare attributes / types: the best-scoring ones, then ones no monster has, and ours only when nothing else is left. */
export function decideAnnounceBits(
  m: Msg<OcgMessageType.ANNOUNCE_ATTRIB> | Msg<OcgMessageType.ANNOUNCE_RACE>, view: AiView,
): Decision {
  const isAttrib = m.type === OcgMessageType.ANNOUNCE_ATTRIB;
  const available = BigInt(m.available);
  const scores = bitScores(view, isAttrib ? "attribute" : "race");
  const bits: bigint[] = [];
  for (let b = 0n; b < 64n; b++) if (available & (1n << b)) bits.push(1n << b);
  // Stable sort: equal scores keep the lowest bit first.
  const picked = bits.sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0)).slice(0, m.count);
  const response = (isAttrib
    ? { type: OcgResponseType.ANNOUNCE_ATTRIB, attributes: picked.map(Number) }
    : { type: OcgResponseType.ANNOUNCE_RACE, races: picked }) as OcgResponse;
  return { response, reason: "what their monsters are" };
}
