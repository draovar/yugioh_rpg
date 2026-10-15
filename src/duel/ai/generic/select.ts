// Choosing cards (SELECT_CARD / SELECT_TRIBUTE / SELECT_UNSELECT_CARD). The engine's "Select the card(s) to …" hint
// says what happens to them: something bad for their owner (destroy, banish, discard, tribute...) → the opponent's
// most valuable cards, or our least valuable when it must be ours; something good (add to hand, Special Summon...)
// → the most valuable. Unknown purposes (plain "select the target") count as bad: most targeted effects are attacks.
import type { OcgCardLoc } from "ocgcore-wasm";
import type { AiView } from "../AiSeat.ts";
import { valueAt } from "../board.ts";

/** HINT_SELECTMSG string ids (strings.conf !system 500-531). */
export const SELECT_HINT = {
  TRIBUTE: 500, DISCARD: 501, DESTROY: 502, BANISH: 503, TO_GRAVE: 504, TO_HAND: 505, ADD_TO_HAND: 506, TO_DECK: 507,
  NORMAL_SUMMON: 508, SPECIAL_SUMMON: 509, SET: 510, FUSION_MATERIAL: 511, EQUIP: 518, CONTROL: 520, REVEAL: 526,
  YOUR_CARD: 529, OPPONENT_CARD: 530, TRIBUTE_SUMMON: 531, ATTACK_TARGET: 549, TARGET: 551,
} as const;

/** Hints whose cards come out ahead (taken, summoned, equipped...). */
const GOOD = new Set<number>([
  SELECT_HINT.ADD_TO_HAND, SELECT_HINT.NORMAL_SUMMON, SELECT_HINT.SPECIAL_SUMMON, SELECT_HINT.SET, SELECT_HINT.EQUIP,
  SELECT_HINT.YOUR_CARD,
]);
/** Hints where it doesn't matter much which (pay the least). */
const NEUTRAL = new Set<number>([SELECT_HINT.REVEAL, SELECT_HINT.FUSION_MATERIAL]);

/** good: the card comes out ahead (whoever owns it); boost: our card is made stronger (never theirs). */
export type Purpose = "good" | "bad" | "neutral" | "boost";

export function purposeOf(hint: bigint | null): Purpose {
  const h = hint === null ? -1 : Number(hint);
  return GOOD.has(h) ? "good" : NEUTRAL.has(h) ? "neutral" : "bad";
}

/** How much we like picking this card for this purpose (higher = pick it first). */
export function pickUtility(view: AiView, c: OcgCardLoc, purpose: Purpose): number {
  const v = valueAt(view, c);
  if (purpose === "good") return v;
  if (purpose === "boost") return c.controller === view.seat ? v : -v;
  if (purpose === "neutral") return -v;
  return c.controller === view.seat ? -v : v;
}

/**
 * Indices of the cards to pick from `candidates`, between `min` and `max` of them. Takes every card worth picking
 * (positive utility: good ones, or the opponent's for bad purposes) up to `max`, and at least `min`.
 */
export function chooseCards(view: AiView, candidates: OcgCardLoc[], min: number, max: number, purpose: Purpose): number[] {
  const ranked = candidates.map((c, i) => ({ i, u: pickUtility(view, c, purpose) })).sort((a, b) => b.u - a.u);
  const wanted = ranked.filter((r) => r.u > 0).length;
  const count = Math.max(min, Math.min(max, wanted));
  return ranked.slice(0, count).map((r) => r.i);
}

const KNOWN_HINTS = new Set<number>(Object.values(SELECT_HINT));
/** Card text that raises a monster's ATK/DEF (Rush Recklessly, The Reliable Guardian), and that lowers it. */
const BOOST = /\b(increase|gains?)\b[^.]*\b(ATK|DEF)\b/i;
const DROP = /\b(decrease|loses?|reduce)\b/i;

/**
 * The purpose of the pick at hand. A vague hint ("select a face-up card", "select the target") while our own card is
 * the newest chain link (its target being chosen) is a boost if that card's text only raises ATK/DEF:
 * Rush Recklessly goes on our monster, not theirs.
 */
export function purposeIn(view: AiView): Purpose {
  const purpose = purposeOf(view.hint);
  const h = view.hint === null ? -1 : Number(view.hint);
  if (purpose !== "bad" || (KNOWN_HINTS.has(h) && h !== SELECT_HINT.TARGET)) return purpose;
  const top = view.memory.chain[view.memory.chain.length - 1];
  const desc = top && top.controller === view.seat ? view.cards.records.get(top.code)?.desc ?? "" : "";
  return BOOST.test(desc) && !DROP.test(desc) ? "boost" : purpose;
}
