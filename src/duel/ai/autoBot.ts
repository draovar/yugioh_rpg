// A deliberately dumb bot that always returns *some* legal response.
// Used for headless tests and as the fallback/placeholder opponent AI.
import {
  cardMatchesOpcode,
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
  type OcgMessage,
  type OcgOpCode,
  type OcgResponse,
  type SelectFieldPlace,
} from "ocgcore-wasm";
import type { CardDb } from "../engine/cardData.ts";

const firstN = (n: number) => Array.from({ length: n }, (_, i) => i);

/**
 * SELECT_SUM check. Each amount packs two alternative values (low/high 16 bits, e.g. level
 * modifiers). `atLeast` = the sum may exceed the target, but no chosen card may be unnecessary.
 * ocgcore-wasm's `select_max` field is really this mode: 0 = exact sum, else "at least" (Ritual tributes).
 */
export function sumMatches(amounts: number[], target: number, atLeast: boolean): boolean {
  const options = amounts.map((a) => [a & 0xffff, a >>> 16].filter((v, i) => i === 0 || v > 0));
  let sums = new Set<number>([0]);
  for (const opt of options) {
    const next = new Set<number>();
    for (const s of sums) for (const v of opt) next.add(s + v);
    sums = next;
  }
  if (!atLeast) return sums.has(target);
  const min = Math.min(...amounts.map((a) => a & 0xffff));
  return [...sums].some((s) => s >= target && s - min < target);
}

/**
 * SELECT_SUM: the optional cards (indexes into `selects`) that make a valid sum together with the `must` cards,
 * `min`-`max` of them, costing least (`cost` per card; default: the fewest cards); null if none does.
 */
export function pickSum(must: number[], selects: number[], target: number, atLeast: boolean, min: number, max: number,
  cost: (i: number) => number = () => 1): number[] | null {
  const n = Math.min(selects.length, 16);
  let best: number[] | null = null;
  let bestCost = Infinity;
  for (let mask = 0; mask < 1 << n; mask++) {
    const picked = selects.slice(0, n).flatMap((_, i) => (mask & (1 << i) ? [i] : []));
    if (picked.length < min || picked.length > max) continue;
    const c = picked.reduce((t, i) => t + cost(i), 0);
    if (c > bestCost || (c === bestCost && best && picked.length >= best.length)) continue;
    if (sumMatches([...must, ...picked.map((i) => selects[i])], target, atLeast)) { best = picked; bestCost = c; }
  }
  return best;
}

/**
 * SELECT_TRIBUTE: takes cards in `order` (indexes into `selects`) until they are worth `min` tributes. `min` counts
 * tributes, not cards: a Double Tribute monster (Kaiser Sea Horse for a LIGHT monster) has release_param 2.
 */
export function pickTributes(selects: readonly { release_param: number }[], order: readonly number[], min: number): number[] {
  const picked: number[] = [];
  let worth = 0;
  for (const i of order) {
    if (worth >= min) break;
    picked.push(i);
    worth += selects[i].release_param || 1;
  }
  return picked;
}

/** `cards`: the game's cards, so a card declaration picks a legal name (without: Blue-Eyes, which may be refused). */
export function autoRespond(m: OcgMessage, rng: () => number = Math.random, cards?: CardDb): OcgResponse {
  switch (m.type) {
    case OcgMessageType.SELECT_IDLECMD:
      if (m.summons.length) return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SUMMON, index: 0 };
      if (m.monster_sets.length) return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_MONSTER_SET, index: 0 };
      if (m.activates.length && rng() < 0.7) return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index: 0 };
      if (m.spell_sets.length && rng() < 0.5) return { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_SPELL_SET, index: 0 };
      return { type: OcgResponseType.SELECT_IDLECMD, action: m.to_bp ? SelectIdleCMDAction.TO_BP : SelectIdleCMDAction.TO_EP, index: null };
    case OcgMessageType.SELECT_BATTLECMD:
      if (m.attacks.length) return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: 0 };
      return { type: OcgResponseType.SELECT_BATTLECMD, action: m.to_m2 ? SelectBattleCMDAction.TO_M2 : SelectBattleCMDAction.TO_EP, index: null };
    case OcgMessageType.SELECT_CHAIN:
      return { type: OcgResponseType.SELECT_CHAIN, index: m.forced || (m.selects.length && rng() < 0.5) ? 0 : null };
    case OcgMessageType.SELECT_EFFECTYN:
      return { type: OcgResponseType.SELECT_EFFECTYN, yes: true };
    case OcgMessageType.SELECT_YESNO:
      return { type: OcgResponseType.SELECT_YESNO, yes: true };
    case OcgMessageType.SELECT_OPTION:
      return { type: OcgResponseType.SELECT_OPTION, index: 0 };
    case OcgMessageType.SELECT_CARD:
      return { type: OcgResponseType.SELECT_CARD, indicies: firstN(m.min) };
    case OcgMessageType.SELECT_TRIBUTE:
      return { type: OcgResponseType.SELECT_TRIBUTE, indicies: pickTributes(m.selects, firstN(m.selects.length), m.min) };
    case OcgMessageType.SELECT_UNSELECT_CARD:
      // Pick up to `min` first: finishing short of it cancels (Panther Warrior's attack tribute, retried forever).
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: m.select_cards.length && (!m.can_finish || m.unselect_cards.length < m.min) ? 0 : null };
    case OcgMessageType.SELECT_POSITION: {
      const pos = ([OcgPosition.FACEUP_ATTACK, OcgPosition.FACEDOWN_ATTACK, OcgPosition.FACEUP_DEFENSE, OcgPosition.FACEDOWN_DEFENSE] as const)
        .find((p) => m.positions & p)!;
      return { type: OcgResponseType.SELECT_POSITION, position: pos };
    }
    case OcgMessageType.SELECT_PLACE:
    case OcgMessageType.SELECT_DISFIELD: {
      const places = freePlaces(m.player, m.field_mask, m.count);
      return m.type === OcgMessageType.SELECT_PLACE
        ? { type: OcgResponseType.SELECT_PLACE, places }
        : { type: OcgResponseType.SELECT_DISFIELD, places };
    }
    case OcgMessageType.SELECT_SUM: {
      const atLeast = m.select_max !== 0;
      const picked = pickSum(m.selects_must.map((c) => c.amount), m.selects.map((c) => c.amount), m.amount, atLeast,
        atLeast ? 0 : m.min, atLeast ? Infinity : m.max);
      return { type: OcgResponseType.SELECT_SUM, indicies: picked ?? [] };
    }
    case OcgMessageType.SELECT_COUNTER: {
      // Take them from the first cards, as many as each has.
      let left = m.count;
      return { type: OcgResponseType.SELECT_COUNTER, counters: m.cards.map((c) => { const n = Math.min(c.count, left); left -= n; return n; }) };
    }
    case OcgMessageType.SORT_CARD:
    case OcgMessageType.SORT_CHAIN:
      return { type: OcgResponseType.SORT_CARD, order: null };
    case OcgMessageType.ANNOUNCE_RACE: {
      const races: bigint[] = [];
      for (let b = 0n; b < 64n && races.length < m.count; b++) if (BigInt(m.available) & (1n << b)) races.push(1n << b);
      return { type: OcgResponseType.ANNOUNCE_RACE, races } as OcgResponse;
    }
    case OcgMessageType.ANNOUNCE_ATTRIB: {
      const attributes: number[] = [];
      for (let b = 0; b < 8 && attributes.length < m.count; b++) if (m.available & (1 << b)) attributes.push(1 << b);
      return { type: OcgResponseType.ANNOUNCE_ATTRIB, attributes } as OcgResponse;
    }
    case OcgMessageType.ANNOUNCE_NUMBER:
      return { type: OcgResponseType.ANNOUNCE_NUMBER, value: 0 };
    case OcgMessageType.ANNOUNCE_CARD: {
      const legal = cards ? declarableCards(cards, m.opcodes) : [];
      return { type: OcgResponseType.ANNOUNCE_CARD, card: legal.length ? legal[Math.floor(rng() * legal.length)] : 89631139 };
    }
    case OcgMessageType.ROCK_PAPER_SCISSORS:
      return { type: OcgResponseType.ROCK_PAPER_SCISSORS, value: (1 + Math.floor(rng() * 3)) as 1 | 2 | 3 };
    default:
      throw new Error(`autoRespond: no response for message type ${m.type}`);
  }
}

/**
 * The cards (of those the game knows: pool + tokens) a card declaration accepts, sorted by name. The prompt's
 * opcodes are a small filter program (e.g. "any card except tokens", "a monster"), checked by ocgcore-wasm.
 */
export function declarableCards(cards: CardDb, opcodes: OcgOpCode[]): number[] {
  return [...cards.records.keys()]
    .filter((code) => { const c = cards.get(code); return c !== null && cardMatchesOpcode(c, opcodes); })
    .sort((a, b) => cards.name(a).localeCompare(cards.name(b)));
}

/**
 * Decodes a SELECT_PLACE field mask (set bit = zone unavailable; low 16 bits are
 * the chooser's own side, high 16 bits the opponent's) into the first `count` free zones.
 */
export function freePlaces(player: number, fieldMask: number, count: number): SelectFieldPlace[] {
  const places: SelectFieldPlace[] = [];
  for (let bit = 0; bit < 32 && places.length < count; bit++) {
    if (fieldMask & (1 << bit)) continue;
    const side = bit >= 16 ? 1 - player : player;
    const b = bit % 16;
    if (b < 7) places.push({ player: side, location: OcgLocation.MZONE, sequence: b });
    else if (b >= 8) places.push({ player: side, location: OcgLocation.SZONE, sequence: b - 8 });
  }
  return places;
}
