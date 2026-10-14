// Reading the board for the AI: finding cards, estimating what hidden ones are, valuing cards and whole boards.
// Values are in rough "cards" (1 = an average card); `evaluate` compares both sides in the same unit.
import { OcgLocation, OcgPosition, type OcgCardLoc } from "ocgcore-wasm";
import { TYPE } from "../cardData.ts";
import type { CardView, PlayerView } from "../DuelSession.ts";
import type { AiView } from "./AiSeat.ts";

export const FACEDOWN = OcgPosition.FACEDOWN_ATTACK | OcgPosition.FACEDOWN_DEFENSE;
export const DEFENSE = OcgPosition.FACEUP_DEFENSE | OcgPosition.FACEDOWN_DEFENSE;

/** Guessed DEF of a face-down monster we can't see: GOAT decks mostly set low-DEF flip monsters. */
export const UNKNOWN_DEF = 1300;

export const mine = (view: AiView): PlayerView => view.board.players[view.seat];
export const theirs = (view: AiView): PlayerView => view.board.players[1 - view.seat];

/** Where a card is: its CardView in the board snapshot, if it's somewhere the snapshot lists. */
export function cardAt(view: AiView, loc: Pick<OcgCardLoc, "controller" | "location" | "sequence">): CardView | null {
  const p = view.board.players[loc.controller];
  switch (loc.location) {
    case OcgLocation.MZONE: return p.monsters[loc.sequence] ?? null;
    case OcgLocation.SZONE: return p.spells[loc.sequence] ?? null;
    case OcgLocation.HAND: return p.hand.find((c) => c.sequence === loc.sequence) ?? null;
    case OcgLocation.GRAVE: return p.grave.find((c) => c.sequence === loc.sequence) ?? null;
    case OcgLocation.REMOVED: return p.banished.find((c) => c.sequence === loc.sequence) ?? null;
    case OcgLocation.EXTRA: return p.extra.find((c) => c.sequence === loc.sequence) ?? null;
    default: return null;
  }
}

export const cardType = (view: AiView, code: number): number => view.cards.records.get(code)?.type ?? 0;
export const isMonster = (view: AiView, code: number) => (cardType(view, code) & TYPE.MONSTER) !== 0;

/** Stars of a monster card (0 for non-monsters). */
export const levelOf = (view: AiView, code: number): number => (view.cards.records.get(code)?.level ?? 0) & 0xff;

/** Tributes a Normal Summon of this monster needs. */
export const tributesFor = (view: AiView, code: number): number => {
  const level = levelOf(view, code);
  return level >= 7 ? 2 : level >= 5 ? 1 : 0;
};

/** A monster's battle numbers as far as the viewer knows them (hidden face-down monsters: guessed DEF). */
export function monsterStats(c: CardView): { atk: number; def: number; known: boolean; attackPos: boolean } {
  const known = c.code !== 0;
  return {
    atk: known ? c.attack : 0,
    def: known ? c.defense : UNKNOWN_DEF,
    known,
    attackPos: (c.position & DEFENSE) === 0,
  };
}

/** A monster with these stats on the field, in cards. 3000 ATK ≈ 2.9, 1800 ≈ 1.9, 1000 ≈ 1.2, 300 ≈ 0.65. */
export function statValue(atk: number, def: number): number {
  return 0.4 + Math.max(atk, 0.8 * def) / 1200;
}

/** A monster on the field. */
export function monsterValue(view: AiView, c: CardView): number {
  if (!c.code) return 1.3; // hidden: most likely a flip effect monster
  if (cardType(view, c.code) & TYPE.TOKEN) return 0.4;
  return statValue(c.attack, c.defense);
}

/** A Spell/Trap on the field. Ones we can't see are a threat (a Mirror Force?), worth a bit more than a known one. */
export function spellTrapValue(view: AiView, c: CardView): number {
  if (!c.code) return 1.2;
  if (c.faceDown) return 1;
  const type = cardType(view, c.code);
  if (type & TYPE.EQUIP) return 0.6; // most of its worth is in the monster it's attached to
  return type & (TYPE.CONTINUOUS | TYPE.FIELD) ? 1.2 : 0.5;
}

/** A card by its code alone (in hand, GY, deck...): what it would be worth to have it. */
export function codeValue(view: AiView, code: number): number {
  const r = view.cards.records.get(code);
  if (!r) return 1;
  if (r.type & TYPE.TOKEN) return 0.4;
  if (r.type & TYPE.MONSTER) return 0.3 + statValue(r.atk, r.def) * 0.7;
  return r.type & TYPE.SPELL ? 1.3 : 1.1;
}

/** The value of whatever card sits at `loc` (field cards by their current state, others by code). */
export function valueAt(view: AiView, loc: OcgCardLoc): number {
  const c = cardAt(view, loc);
  if (loc.location === OcgLocation.MZONE && c) return monsterValue(view, c);
  if (loc.location === OcgLocation.SZONE && c) return spellTrapValue(view, c);
  return loc.code ? codeValue(view, loc.code) : 1;
}

/** Life points in cards: each 1000 LP is worth more the fewer you have left. 8000 ≈ 5.8, 4000 ≈ 4.8, 1000 ≈ 2. */
export function lpValue(lp: number): number {
  return 6 * (1 - Math.exp(-Math.max(0, lp) / 2500));
}

/** What losing `damage` LP costs a player at `lp` (all of it when it's lethal). */
export function damageCost(lp: number, damage: number): number {
  if (damage >= lp) return 50;
  return lpValue(lp) - lpValue(lp - damage);
}

/** The highest ATK among a player's face-up monsters (0 if none). */
export function bestAtk(p: PlayerView): number {
  return Math.max(0, ...p.monsters.filter((c): c is CardView => !!c && !c.faceDown).map((c) => c.attack));
}

/** An unknown card in a hand: about what an average known one is worth. */
const UNKNOWN_HAND_CARD = 1.2;

/**
 * One side's material: LP, monsters, Spells/Traps, hand, and a penalty for an almost empty Deck. Hand cards we can see
 * count by what they are (so drawing 3 and discarding the 2 worst is a gain), hidden ones as an average card.
 */
function sideValue(view: AiView, p: PlayerView): number {
  let v = lpValue(p.lp);
  for (const c of p.monsters) if (c) v += monsterValue(view, c);
  for (const c of p.spells) if (c) v += spellTrapValue(view, c);
  for (const c of p.hand) v += c.code ? codeValue(view, c.code) : UNKNOWN_HAND_CARD;
  if (p.deckCount < 5) v -= (5 - p.deckCount) * 0.5;
  return v;
}

/** The board from the AI's side: positive = it's ahead. A player at 0 LP decides it outright. */
export function evaluate(view: AiView): number {
  const me = mine(view), opp = theirs(view);
  if (opp.lp <= 0) return 1000;
  if (me.lp <= 0) return -1000;
  return sideValue(view, me) - sideValue(view, opp);
}
