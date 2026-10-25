// Laying out a board the AI can see as a fresh duel ("a copy"), so the engine can play a move on it.
// Built ONLY from the AiView: the opponent's hidden cards (hand, face-down cards, Deck) become blank stand-ins with
// no effects, so a copy never knows more than the AI does. The AI's own Deck is its decklist minus the cards it can
// see (it knows what's left, not the order). The AI is always team 0 in the copy.
import { OcgLocation, OcgPosition } from "ocgcore-wasm";
import { CardDb, TYPE, type CardRecord } from "../../engine/cardData.ts";
import type { CardView, Deck, PlayerView, StartCard } from "../../engine/DuelSession.ts";
import { shuffle } from "../../engine/rng.ts";
import type { AiView } from "../AiSeat.ts";

/** Stand-in passcodes (no real card uses them). */
export const BLANK = { TRAP: 1, MONSTER: 2, CARD: 3, ATTACKER: 4 } as const;
const BLANK_CODES = new Set<number>(Object.values(BLANK));

const blank = (code: number, type: number, def = 0, atk = 0, level = 3): CardRecord => ({
  code, alias: 0, setcode: "0", type, atk, def, level: type & TYPE.MONSTER ? level : 0, race: type & TYPE.MONSTER ? "1" : "0",
  attribute: type & TYPE.MONSTER ? 1 : 0, name: "(hidden card)", desc: "", strings: Array<string>(16).fill(""),
});

/**
 * The game's cards plus the stand-ins: a face-down Spell/Trap, a face-down monster (guessed DEF), any other card, and an
 * average monster in the opponent's hand (Level 4, 1600 ATK, typical for GOAT decks): without it the opponent's turn in
 * a copy never brings a new attacker, so set traps and blockers would look worthless.
 */
export function withBlanks(cards: CardDb): CardDb {
  return new CardDb([
    ...cards.records.values(),
    blank(BLANK.TRAP, TYPE.TRAP), blank(BLANK.MONSTER, TYPE.MONSTER | TYPE.NORMAL, 1300), blank(BLANK.CARD, TYPE.SPELL),
    blank(BLANK.ATTACKER, TYPE.MONSTER | TYPE.NORMAL, 1200, 1600, 4),
  ]);
}

/**
 * Rule files the GOAT format never uses, left out of the copies (a fifth less Lua to load per copy). Each stand-in only
 * defines its module table. Checked: 120 full duels play out with identical boards with and without them. (Not
 * proc_maximum.lua: Polymerization's helpers call into it.)
 */
const UNUSED_RULES: Record<string, string> = {
  "proc_synchro.lua": "Synchro = Synchro or {}", "proc_xyz.lua": "Xyz = Xyz or {}", "proc_pendulum.lua": "Pendulum = Pendulum or {}",
  "proc_link.lua": "Link = Link or {}", "proc_skill.lua": "", "proc_rush.lua": "",
};

/** Script reader for the copies: the stand-ins get a script without effects, unused rule files are skipped. */
export function copyScripts(readScript: (name: string) => string | null): (name: string) => string | null {
  return (name) => {
    const file = name.split("/").pop() ?? "";
    if (file in UNUSED_RULES) return UNUSED_RULES[file];
    const code = Number(/^c(\d+)\.lua$/.exec(file)?.[1]);
    return BLANK_CODES.has(code) ? "local s,id=GetID()\nfunction s.initial_effect(c) end" : readScript(name);
  };
}

export interface SimLayout {
  /** [AI, opponent]. */
  decks: [Deck, Deck];
  lp: [number, number];
}

/** The board in `view` as the copy's starting position. */
export function layoutFrom(view: AiView): SimLayout {
  const me = view.board.players[view.seat];
  const opp = view.board.players[1 - view.seat];
  const decks: [Deck, Deck] = [ownSide(view, me), opponentSide(opp, view.seat)];
  returnStolen(decks);
  return { decks, lp: [me.lp, opp.lp] };
}

type Place = { team: 0 | 1; sequence: number };

/**
 * Monsters one side controls but the other owns (`StartCard.control`, set by `piles`) go back to their owner's side,
 * in a Monster Zone free there (not one a monster of that side really stands in), and are handed over again as the copy
 * starts. Else the copy would make them the controller's own cards: destroying Snatch Steal would give nothing back.
 * Equip links and card targets aimed at them follow. One without a free zone stays where it is.
 */
function returnStolen(decks: [Deck, Deck]): void {
  const zones = (t: 0 | 1) => new Set((decks[t].start ?? []).filter((s) => s.location === OcgLocation.MZONE).map((s) => s.sequence ?? 0));
  const taken = [zones(0), zones(1)];
  const moved: { from: Place; to: Place }[] = [];
  for (const team of [0, 1] as const) {
    const owner = (1 - team) as 0 | 1;
    for (const s of [...(decks[team].start ?? [])]) {
      if (!s.control) continue;
      const free = [0, 1, 2, 3, 4].find((z) => !taken[owner].has(z));
      if (free === undefined) { delete s.control; continue; }
      taken[owner].add(free);
      moved.push({ from: { team, sequence: s.sequence ?? 0 }, to: { team: owner, sequence: free } });
      decks[team].start = decks[team].start!.filter((x) => x !== s);
      decks[owner].start!.push({ ...s, sequence: free });
    }
  }
  const follow = (p: Place): Place => moved.find((m) => m.from.team === p.team && m.from.sequence === p.sequence)?.to ?? p;
  for (const d of decks) for (const s of d.start ?? []) {
    if (s.equipTo) s.equipTo = follow(s.equipTo);
    if (s.cardTargets) s.cardTargets = s.cardTargets.map(follow);
  }
}

/** The same layout with the two sides' places swapped (team 0 becomes the opponent): decks, LP and every team reference. */
export function swapSides(layout: SimLayout): SimLayout {
  const flip = (p: Place): Place => ({ team: (1 - p.team) as 0 | 1, sequence: p.sequence });
  const side = (d: Deck): Deck => ({
    ...d,
    start: (d.start ?? []).map((s) => ({
      ...s,
      ...(s.equipTo ? { equipTo: flip(s.equipTo) } : {}),
      ...(s.cardTargets ? { cardTargets: s.cardTargets.map(flip) } : {}),
      ...(s.control ? { control: flip(s.control) } : {}),
    })),
  });
  return { decks: [side(layout.decks[1]), side(layout.decks[0])], lp: [layout.lp[1], layout.lp[0]] };
}

const place = (c: CardView, code = c.code, position = c.position): StartCard =>
  ({ code, location: c.location, sequence: c.sequence, position });

/**
 * `p`'s field, GY and banished cards (hidden ones through `hidden`); equip links and card targets (a persistent Trap's
 * lock on a monster) kept (`seat` = the AI's real seat).
 */
function piles(p: PlayerView, seat: number, hidden: (c: CardView) => StartCard | null): StartCard[] {
  const out: StartCard[] = [];
  for (const c of [...p.monsters, ...p.spells]) if (c) {
    const s = c.code ? place(c) : hidden(c);
    const t = c.equipTarget;
    if (s && t?.location === OcgLocation.MZONE) s.equipTo = { team: t.controller === seat ? 0 : 1, sequence: t.sequence };
    const targets = (c.cardTargets ?? []).filter((x) => x.location === OcgLocation.MZONE);
    if (s && targets.length) s.cardTargets = targets.map((x) => ({ team: x.controller === seat ? 0 : 1, sequence: x.sequence }));
    // Owned by the other side: returnStolen moves it there and the copy hands it over again.
    if (s && c.code && c.owner !== undefined && c.location === OcgLocation.MZONE) s.control = { team: c.controller === seat ? 0 : 1, sequence: c.sequence };
    if (s) out.push(s);
  }
  for (const c of [...p.grave, ...p.banished]) if (c.code) out.push(place(c));
  return out;
}

function ownSide(view: AiView, me: PlayerView): Deck {
  const start: StartCard[] = me.hand.map((c) => ({ code: c.code, location: OcgLocation.HAND, sequence: c.sequence, position: OcgPosition.FACEDOWN_DEFENSE }));
  start.push(...piles(me, view.seat, () => null));
  // What's left in the Deck: the decklist minus every card of ours we can see (order unknown: shuffled).
  const left = [...(view.deckList ?? [])];
  for (const s of start) {
    const i = left.indexOf(s.code);
    if (i >= 0) left.splice(i, 1);
  }
  shuffle(left, view.rng);
  const main = left.slice(0, me.deckCount);
  while (main.length < me.deckCount) main.push(BLANK.CARD);
  return { main, extra: me.extra.map((c) => c.code).filter((c) => c), start };
}

function opponentSide(opp: PlayerView, seat: number): Deck {
  const start = piles(opp, seat, (c) => place(c, c.location === OcgLocation.MZONE ? BLANK.MONSTER : BLANK.TRAP));
  // Their hidden hand: one average monster (they'll usually have one to summon), the rest cards that do nothing.
  start.push(...opp.hand.map((_c, i) => ({
    code: i === 0 ? BLANK.ATTACKER : BLANK.CARD, location: OcgLocation.HAND, sequence: i, position: OcgPosition.FACEDOWN_DEFENSE,
  })));
  return { main: Array<number>(opp.deckCount).fill(BLANK.CARD), start };
}
