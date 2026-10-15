// Laying out a board the AI can see as a fresh duel ("a copy"), so the engine can play a move on it.
// Built ONLY from the AiView: the opponent's hidden cards (hand, face-down cards, Deck) become stand-ins, so a copy
// never knows more than the AI does. The AI's own Deck is its decklist minus the cards it can see (it knows what's
// left, not the order). The AI is always team 0 in the copy.
//
// Two kinds of stand-ins. The single guess (no world): blanks without effects, one of them an average 1600 ATK
// monster in hand. A sampled world (`sampleWorlds`): real cards drawn at the odds decks play them, so in some worlds
// their hand holds no monster or a weak one, a set card is a Mirror Force, a hand card a removal Spell.
import { OcgLocation, OcgPosition } from "ocgcore-wasm";
import { CardDb, TYPE, type CardRecord } from "../../cardData.ts";
import { DECKS } from "../../decks.ts";
import type { CardView, Deck, PlayerView, StartCard } from "../../DuelSession.ts";
import { mulberry32, shuffle } from "../../rng.ts";
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

/** The board in `view` as the copy's starting position: the opponent's hidden cards from `world`, else the single guess. */
export function layoutFrom(view: AiView, world?: World): SimLayout {
  const me = view.board.players[view.seat];
  const opp = view.board.players[1 - view.seat];
  return { decks: [ownSide(view, me), opponentSide(opp, view.seat, world)], lp: [me.lp, opp.lp] };
}

const place = (c: CardView, code = c.code, position = c.position): StartCard =>
  ({ code, location: c.location, sequence: c.sequence, position });

/** `p`'s field, GY and banished cards (hidden ones through `hidden`); equip links kept (`seat` = the AI's real seat). */
function piles(p: PlayerView, seat: number, hidden: (c: CardView) => StartCard | null): StartCard[] {
  const out: StartCard[] = [];
  for (const c of [...p.monsters, ...p.spells]) if (c) {
    const s = c.code ? place(c) : hidden(c);
    const t = c.equipTarget;
    if (s && t?.location === OcgLocation.MZONE) s.equipTo = { team: t.controller === seat ? 0 : 1, sequence: t.sequence };
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

function opponentSide(opp: PlayerView, seat: number, world?: World): Deck {
  const start = piles(opp, seat, (c) => place(c, c.location === OcgLocation.MZONE
    ? world?.monsters[c.sequence] || BLANK.MONSTER
    : world?.spells[c.sequence] || BLANK.TRAP));
  // Their hidden hand: the world's cards, else one average monster (they'll usually have one to summon) and cards that
  // do nothing.
  start.push(...opp.hand.map((_c, i) => ({
    code: world ? world.hand[i] || BLANK.CARD : i === 0 ? BLANK.ATTACKER : BLANK.CARD,
    location: OcgLocation.HAND, sequence: i, position: OcgPosition.FACEDOWN_DEFENSE,
  })));
  return { main: Array<number>(opp.deckCount).fill(BLANK.CARD), start };
}

/** What the opponent's hidden cards are in one sampled world: card codes by hand position and by zone (0 = a blank). */
export interface World {
  hand: number[];
  /** Face-down Spells/Traps by Spell & Trap Zone. */
  spells: number[];
  /** Face-down monsters by Monster Zone. */
  monsters: number[];
}

/**
 * How many copies decks play of each Main Deck card, from the decks the game knows (the prebuilt decks; later the
 * trainers' too). `any`: averaged over all decks, the odds for a card they haven't shown. `played`: averaged over the
 * decks that play it, for a card they have shown (their deck plays it; how many copies is still a guess).
 */
interface CardOdds {
  any: Map<number, number>;
  played: Map<number, number>;
}
let odds: CardOdds | null = null;

function cardOdds(): CardOdds {
  if (odds) return odds;
  const decks = Object.values(DECKS).map((d) => d.deck.main);
  const any = new Map<number, number>(), played = new Map<number, number>(), decksWith = new Map<number, number>();
  for (const deck of decks) {
    const copies = new Map<number, number>();
    for (const code of deck) copies.set(code, (copies.get(code) ?? 0) + 1);
    for (const [code, n] of copies) {
      any.set(code, (any.get(code) ?? 0) + n / decks.length);
      played.set(code, (played.get(code) ?? 0) + n);
      decksWith.set(code, (decksWith.get(code) ?? 0) + 1);
    }
  }
  for (const [code, n] of played) played.set(code, n / decksWith.get(code)!);
  return (odds = { any, played });
}

/** A face-down Field Spell sits in Spell & Trap Zone 5. */
const FIELD_ZONE = 5;

/**
 * `count` guesses of the opponent's hidden hand and face-down cards, from what the AI can see (`view` only, never
 * their real cards): each hidden card is drawn at the odds decks play it (`cardOdds`), cards they've shown count as
 * played by their deck, and copies already visible (field, GY, banished) are used up. Face-down Spells/Traps are drawn
 * from Spells/Traps, face-down monsters from Level 1-4 monsters. The same `seed` gives the same worlds.
 */
export function sampleWorlds(view: AiView, count: number, seed: number): World[] {
  const opp = view.board.players[1 - view.seat];
  const shown = view.memory.seen[1 - view.seat];
  const type = (code: number) => view.cards.records.get(code)?.type ?? 0;
  const mainDeck = (code: number) => {
    const t = type(code);
    return t !== 0 && !(t & (TYPE.TOKEN | TYPE.FUSION));
  };
  const visible = new Map<number, number>();
  for (const c of [...opp.monsters, ...opp.spells, ...opp.grave, ...opp.banished])
    if (c?.code) visible.set(c.code, (visible.get(c.code) ?? 0) + 1);
  // Copies of each card we expect among their unseen cards.
  const { any, played } = cardOdds();
  const expected = new Map<number, number>();
  for (const code of new Set([...any.keys(), ...shown])) {
    if (!mainDeck(code)) continue;
    const copies = shown.has(code) ? played.get(code) ?? 1 : any.get(code)!;
    const left = copies - (visible.get(code) ?? 0);
    if (left > 0) expected.set(code, left);
  }

  const fitsSpell = (zone: number) => (code: number) =>
    (type(code) & (TYPE.SPELL | TYPE.TRAP)) !== 0 && (zone === FIELD_ZONE) === ((type(code) & TYPE.FIELD) !== 0);
  const fitsMonster = (code: number) => {
    const t = type(code);
    return (t & TYPE.MONSTER) !== 0 && !(t & (TYPE.RITUAL | TYPE.SPSUMMON)) && (view.cards.records.get(code)?.level ?? 0) <= 4;
  };
  const worlds: World[] = [];
  for (let k = 0; k < count; k++) {
    const rng = mulberry32((seed + k * 0x9e3779b9) >>> 0);
    const left = new Map(expected);
    const draw = (fits: (code: number) => boolean): number => {
      let total = 0;
      for (const [code, n] of left) if (fits(code)) total += n;
      let r = rng() * total;
      for (const [code, n] of left) {
        if (!fits(code)) continue;
        r -= n;
        if (r < 0) {
          if (n > 1) left.set(code, n - 1);
          else left.delete(code);
          return code;
        }
      }
      return 0;
    };
    const world: World = { hand: [], spells: [], monsters: [] };
    opp.monsters.forEach((c, zone) => { if (c && !c.code) world.monsters[zone] = draw(fitsMonster); });
    opp.spells.forEach((c, zone) => { if (c && !c.code) world.spells[zone] = draw(fitsSpell(zone)); });
    world.hand = opp.hand.map(() => draw(() => true));
    worlds.push(world);
  }
  return worlds;
}
