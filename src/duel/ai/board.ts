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

/** Tributes this card needs to reach the field from the hand (0 for non-monsters and Special Summon-only / Ritual ones). */
const needsTributes = (view: AiView, code: number): number => {
  const type = cardType(view, code);
  return type & TYPE.MONSTER && !(type & (TYPE.SPSUMMON | TYPE.RITUAL)) ? tributesFor(view, code) : 0;
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
 * board score that simulations compare, battle outcomes, which cards to pick. Defaults were picked by hand, except the
 * LP curve and the hand cards: those were fitted to who won (tools/fit-eval.ts on 5000 generic and 320 planner duels,
 * 2026-10-15; docs/ai-rework-plan.md phase 2). A fit on 1460 more planner duels (phase 3) confirmed the Spell/Trap
 * values. `npm run tune` searches by self-play, trainer styles (M4) can shift them.
 */
export interface Weights {
  /**
   * Life points: lpScale * (1 - exp(-lp / lpHalf)), so each 1000 LP is worth more the fewer are left. Fitted: nearly
   * linear (a flatter curve predicts the winner better, up to lpHalf ≈ 10000), so damage counts from 8000 LP on.
   */
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
  /**
   * Our own set Traps: ready to use (a Trap can't be activated from the hand), the first worth setTrap, each further
   * one setTrapStep less down to setCard, so piling them up stops paying. Fitted: a set Trap ≈ 0.2 more than in hand.
   */
  setTrap: number;
  setTrapStep: number;
  hiddenSetCard: number;
  continuous: number;
  equip: number;
  faceUpSpell: number;
  /**
   * Cards in hand: an unknown one, a known Spell, a known Trap, a known monster (handMonsterBase + factor * its field
   * value). Fitted: a card in hand is worth clearly less than the same card in play (a 1400 ATK monster 1.13 in hand,
   * 1.57 on the field), so holding cards isn't a safe store of value.
   */
  handUnknown: number;
  handSpell: number;
  handTrap: number;
  handMonsterBase: number;
  handMonsterFactor: number;
  /**
   * A monster in hand needing more Tributes than we have monsters on the field: its value times this (stuck there),
   * for one Tribute (Level 5-6; also a Ritual Monster or Spell without the other), and for two (Level 7+), harder to
   * get out. Not for monsters that never Tribute Summon (Special Summon only).
   */
  stuckMonster: number;
  stuckMonster2: number;
  /**
   * The turn planner: ending our turn with no monster while they hold cards (taken off the board after their turn).
   * Their turn in a copy brings one guessed attacker; a real hand can do more against an open field.
   */
  openField: number;
  /** Per card short of 5 left in the Deck. */
  deckLowPenalty: number;
  /** Main phase: a simulated activation is used when it gains more than this. */
  activateMin: number;
}

export const DEFAULT_WEIGHTS: Readonly<Weights> = {
  lpScale: 12, lpHalf: 10000,
  monsterBase: 0.4, atkDivisor: 1200, defFactor: 0.8, hiddenMonster: 1.3, token: 0.4,
  setCard: 1, setTrap: 1.3, setTrapStep: 0.15, hiddenSetCard: 1.2, continuous: 1.2, equip: 0.6, faceUpSpell: 0.5,
  handUnknown: 1, handSpell: 1, handTrap: 1.1, handMonsterBase: 0.5, handMonsterFactor: 0.4, stuckMonster: 0.75, stuckMonster2: 0.5, openField: 0.5,
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
  const type = cardType(view, c.code);
  if (c.faceDown) return type & TYPE.TRAP ? w.setTrap : w.setCard;
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

/** Life points in cards: each 1000 LP is worth more the fewer you have left (defaults: 8000 ≈ 6.6, 4000 ≈ 4.0, 1000 ≈ 1.1). */
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
  // A Ritual Monster and its Ritual Spell (in hand, or our own set one) are one card's worth together (the monster's),
  // each stuck without the other.
  const ritualSpells = [...p.hand, ...p.spells.filter((c): c is CardView => !!c && c.faceDown)]
    .filter((c) => c.code && cardType(view, c.code) & TYPE.RITUAL);
  const ritual = (code: number, partners: readonly CardView[]) => {
    const value = codeValue(view, code);
    const paired = partners.some((h) => h.code && h.code !== code && ritualPair(view, code, h.code));
    return cardType(view, code) & TYPE.MONSTER ? (paired ? value : value * w.stuckMonster) : paired ? 0 : value * w.stuckMonster;
  };
  let setTraps = 0;
  for (const c of p.spells) {
    if (!c) continue;
    if (c.faceDown && c.code && cardType(view, c.code) & TYPE.RITUAL) v += ritual(c.code, p.hand);
    // Our own set Traps: each one after the first is worth less (a sixth Trap rarely adds what the first does).
    else if (c.faceDown && c.code && cardType(view, c.code) & TYPE.TRAP) v += Math.max(w.setCard, w.setTrap - w.setTrapStep * setTraps++);
    else v += spellTrapValue(view, c);
  }
  // Monsters we could tribute (tokens can't be Tributed for a Tribute Summon in GOAT).
  const fodder = p.monsters.filter((c) => c && !(c.code && cardType(view, c.code) & TYPE.TOKEN)).length;
  for (const c of p.hand) {
    if (!c.code) { v += w.handUnknown; continue; }
    if (cardType(view, c.code) & TYPE.RITUAL) { v += ritual(c.code, cardType(view, c.code) & TYPE.MONSTER ? ritualSpells : p.hand); continue; }
    const value = codeValue(view, c.code);
    const need = needsTributes(view, c.code);
    v += need > fodder ? value * (need >= 2 ? w.stuckMonster2 : w.stuckMonster) : value;
  }
  if (p.deckCount < 5) v -= (5 - p.deckCount) * w.deckLowPenalty;
  return v;
}

/** Whether one of the two codes is a Ritual Spell naming the other (its text: 'used to Ritual Summon "Name"'). */
function ritualPair(view: AiView, a: number, b: number): boolean {
  const ra = view.cards.records.get(a), rb = view.cards.records.get(b);
  if (!ra || !rb) return false;
  const [spell, monster] = ra.type & TYPE.SPELL ? [ra, rb] : [rb, ra];
  return !!(spell.type & TYPE.SPELL) && !!(monster.type & TYPE.MONSTER) && spell.desc.includes(`"${monster.name}"`);
}

/** The board from the AI's side: positive = it's ahead. A player at 0 LP decides it outright. */
export function evaluate(view: AiView): number {
  const me = mine(view), opp = theirs(view);
  if (opp.lp <= 0) return 1000;
  if (me.lp <= 0) return -1000;
  return sideValue(view, me) - sideValue(view, opp);
}
