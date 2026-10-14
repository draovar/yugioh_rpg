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

/**
 * How the AI values things, in "cards" (1 = an average card). Every value judgement goes through these numbers: the
 * board score that simulations compare, battle outcomes, which cards to pick. Defaults were picked by hand; `npm run
 * tune` searches for better ones by self-play, and trainer styles (M4) can shift them.
 */
export interface Weights {
  /** Life points: lpScale * (1 - exp(-lp / lpHalf)), so each 1000 LP is worth more the fewer are left. */
  lpScale: number;
  lpHalf: number;
  /** A monster on the field: monsterBase + max(ATK, defFactor * DEF) / atkDivisor. */
  monsterBase: number;
  atkDivisor: number;
  defFactor: number;
  /** A face-down monster we can't see (most likely a flip effect monster). */
  hiddenMonster: number;
  token: number;
  /** Spells/Traps on the field: our own set ones, the opponent's we can't see, face-up continuous/field, equips, others. */
  setCard: number;
  hiddenSetCard: number;
  continuous: number;
  equip: number;
  faceUpSpell: number;
  /** Cards in hand: an unknown one, a known Spell, a known Trap, a known monster (handMonsterBase + factor * its field value). */
  handUnknown: number;
  handSpell: number;
  handTrap: number;
  handMonsterBase: number;
  handMonsterFactor: number;
  /** Per card short of 5 left in the Deck. */
  deckLowPenalty: number;
  /** Main phase: a simulated activation is used when it gains more than this. */
  activateMin: number;
}

export const DEFAULT_WEIGHTS: Readonly<Weights> = {
  lpScale: 6, lpHalf: 2500,
  monsterBase: 0.4, atkDivisor: 1200, defFactor: 0.8, hiddenMonster: 1.3, token: 0.4,
  setCard: 1, hiddenSetCard: 1.2, continuous: 1.2, equip: 0.6, faceUpSpell: 0.5,
  handUnknown: 1.2, handSpell: 1.3, handTrap: 1.1, handMonsterBase: 0.3, handMonsterFactor: 0.7,
  deckLowPenalty: 0.5,
  activateMin: 0.05,
};

/** The weights this view decides with (the brain's own, else the defaults). */
export const weightsOf = (view: AiView): Readonly<Weights> => view.weights ?? DEFAULT_WEIGHTS;

/** A monster with these stats on the field. With the defaults: 3000 ATK ≈ 2.9, 1800 ≈ 1.9, 1000 ≈ 1.2, 300 ≈ 0.65. */
export function statValue(atk: number, def: number, w: Readonly<Weights> = DEFAULT_WEIGHTS): number {
  return w.monsterBase + Math.max(atk, w.defFactor * def) / w.atkDivisor;
}

/** A monster on the field. */
export function monsterValue(view: AiView, c: CardView): number {
  const w = weightsOf(view);
  if (!c.code) return w.hiddenMonster;
  if (cardType(view, c.code) & TYPE.TOKEN) return w.token;
  return statValue(c.attack, c.defense, w);
}

/** A Spell/Trap on the field. Ones we can't see are a threat (a Mirror Force?). */
export function spellTrapValue(view: AiView, c: CardView): number {
  const w = weightsOf(view);
  if (!c.code) return w.hiddenSetCard;
  if (c.faceDown) return w.setCard;
  const type = cardType(view, c.code);
  if (type & TYPE.EQUIP) return w.equip; // most of its worth is in the monster it's attached to
  return type & (TYPE.CONTINUOUS | TYPE.FIELD) ? w.continuous : w.faceUpSpell;
}

/** A card by its code alone (in hand, GY, deck...): what it would be worth to have it. */
export function codeValue(view: AiView, code: number): number {
  const w = weightsOf(view);
  const r = view.cards.records.get(code);
  if (!r) return w.handUnknown;
  if (r.type & TYPE.TOKEN) return w.token;
  if (r.type & TYPE.MONSTER) return w.handMonsterBase + statValue(r.atk, r.def, w) * w.handMonsterFactor;
  return r.type & TYPE.SPELL ? w.handSpell : w.handTrap;
}

/** The value of whatever card sits at `loc` (field cards by their current state, others by code). */
export function valueAt(view: AiView, loc: OcgCardLoc): number {
  const c = cardAt(view, loc);
  if (loc.location === OcgLocation.MZONE && c) return monsterValue(view, c);
  if (loc.location === OcgLocation.SZONE && c) return spellTrapValue(view, c);
  return loc.code ? codeValue(view, loc.code) : weightsOf(view).handUnknown;
}

/** Life points in cards: each 1000 LP is worth more the fewer you have left (defaults: 8000 ≈ 5.8, 4000 ≈ 4.8, 1000 ≈ 2). */
export function lpValue(lp: number, w: Readonly<Weights> = DEFAULT_WEIGHTS): number {
  return w.lpScale * (1 - Math.exp(-Math.max(0, lp) / w.lpHalf));
}

/** What losing `damage` LP costs a player at `lp` (all of it when it's lethal). */
export function damageCost(lp: number, damage: number, w: Readonly<Weights> = DEFAULT_WEIGHTS): number {
  if (damage >= lp) return 50;
  return lpValue(lp, w) - lpValue(lp - damage, w);
}

/** The highest ATK among a player's face-up monsters (0 if none). */
export function bestAtk(p: PlayerView): number {
  return Math.max(0, ...p.monsters.filter((c): c is CardView => !!c && !c.faceDown).map((c) => c.attack));
}

/**
 * One side's material: LP, monsters, Spells/Traps, hand, and a penalty for an almost empty Deck. Hand cards we can see
 * count by what they are (so drawing 3 and discarding the 2 worst is a gain), hidden ones as an average card.
 */
function sideValue(view: AiView, p: PlayerView): number {
  const w = weightsOf(view);
  let v = lpValue(p.lp, w);
  for (const c of p.monsters) if (c) v += monsterValue(view, c);
  for (const c of p.spells) if (c) v += spellTrapValue(view, c);
  for (const c of p.hand) v += c.code ? codeValue(view, c.code) : w.handUnknown;
  if (p.deckCount < 5) v -= (5 - p.deckCount) * w.deckLowPenalty;
  return v;
}

/** The board from the AI's side: positive = it's ahead. A player at 0 LP decides it outright. */
export function evaluate(view: AiView): number {
  const me = mine(view), opp = theirs(view);
  if (opp.lp <= 0) return 1000;
  if (me.lp <= 0) return -1000;
  return sideValue(view, me) - sideValue(view, opp);
}
