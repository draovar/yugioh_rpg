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
import type { CardDb } from "./cardData.ts";

const firstN = (n: number) => Array.from({ length: n }, (_, i) => i);

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
      return { type: OcgResponseType.SELECT_TRIBUTE, indicies: firstN(m.min) };
    case OcgMessageType.SELECT_UNSELECT_CARD:
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: m.can_finish || !m.select_cards.length ? null : 0 };
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
      const picked: number[] = [];
      let sum = m.selects_must.reduce((s, c) => s + (c.amount & 0xffff), 0);
      for (let i = 0; i < m.selects.length && sum < m.amount; i++) {
        picked.push(i);
        sum += m.selects[i].amount & 0xffff;
      }
      return { type: OcgResponseType.SELECT_SUM, indicies: picked };
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
