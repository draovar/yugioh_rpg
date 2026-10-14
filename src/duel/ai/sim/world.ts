// Laying out a board the AI can see as a fresh duel ("a copy"), so the engine can play a move on it.
// Built ONLY from the AiView: the opponent's hidden cards (hand, face-down cards, Deck) become blank stand-ins with
// no effects, so a copy never knows more than the AI does. The AI's own Deck is its decklist minus the cards it can
// see (it knows what's left, not the order). The AI is always team 0 in the copy.
import { OcgLocation, OcgPosition } from "ocgcore-wasm";
import { CardDb, TYPE, type CardRecord } from "../../cardData.ts";
import type { CardView, Deck, PlayerView, StartCard } from "../../DuelSession.ts";
import { shuffle } from "../../rng.ts";
import type { AiView } from "../AiSeat.ts";

/** Stand-in passcodes (no real card uses them). */
export const BLANK = { TRAP: 1, MONSTER: 2, CARD: 3 } as const;
const BLANK_CODES = new Set<number>(Object.values(BLANK));

const blank = (code: number, type: number, def = 0): CardRecord => ({
  code, alias: 0, setcode: "0", type, atk: 0, def, level: type & TYPE.MONSTER ? 3 : 0, race: type & TYPE.MONSTER ? "1" : "0",
  attribute: type & TYPE.MONSTER ? 1 : 0, name: "(hidden card)", desc: "", strings: Array<string>(16).fill(""),
});

/** The game's cards plus the stand-ins: a face-down Spell/Trap, a face-down monster (guessed DEF), any other card. */
export function withBlanks(cards: CardDb): CardDb {
  return new CardDb([
    ...cards.records.values(),
    blank(BLANK.TRAP, TYPE.TRAP), blank(BLANK.MONSTER, TYPE.MONSTER | TYPE.NORMAL, 1300), blank(BLANK.CARD, TYPE.SPELL),
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
  return { decks: [ownSide(view, me), opponentSide(opp)], lp: [me.lp, opp.lp] };
}

const place = (c: CardView, code = c.code, position = c.position): StartCard =>
  ({ code, location: c.location, sequence: c.sequence, position });

function piles(p: PlayerView, hidden: (c: CardView) => StartCard | null): StartCard[] {
  const out: StartCard[] = [];
  for (const c of [...p.monsters, ...p.spells]) if (c) { const s = c.code ? place(c) : hidden(c); if (s) out.push(s); }
  for (const c of [...p.grave, ...p.banished]) if (c.code) out.push(place(c));
  return out;
}

function ownSide(view: AiView, me: PlayerView): Deck {
  const start: StartCard[] = me.hand.map((c) => ({ code: c.code, location: OcgLocation.HAND, sequence: c.sequence, position: OcgPosition.FACEDOWN_DEFENSE }));
  start.push(...piles(me, () => null));
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

function opponentSide(opp: PlayerView): Deck {
  const start = piles(opp, (c) => place(c, c.location === OcgLocation.MZONE ? BLANK.MONSTER : BLANK.TRAP));
  start.push(...opp.hand.map((_c, i) => ({ code: BLANK.CARD, location: OcgLocation.HAND, sequence: i, position: OcgPosition.FACEDOWN_DEFENSE })));
  return { main: Array<number>(opp.deckCount).fill(BLANK.CARD), start };
}
