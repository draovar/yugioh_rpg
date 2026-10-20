// The deck editor's rules and card list, no Phaser: which cards can go in a deck and where, the search (name or
// card text), filters and sort orders of the card list, and the order the deck itself is shown in.
import { TYPE, type CardDb, type CardRecord } from "./cardData.ts";
import { normalize } from "./cardSearch.ts";
import type { Deck } from "./DuelSession.ts";
import { ATTRIBUTES, RACES } from "./text.ts";

/** Deck size and copy limits (the same as `deckProblems` checks). */
export const DECK_RULES = { mainMin: 40, mainMax: 60, extraMax: 15, copies: 3 };

/** Fusion (and Synchro) monsters go to the Extra Deck, everything else to the Main Deck. */
export const goesToExtra = (r: CardRecord) => (r.type & (TYPE.FUSION | TYPE.SYNCHRO)) !== 0;

const isMonster = (r: CardRecord) => (r.type & TYPE.MONSTER) !== 0;
const isSpell = (r: CardRecord) => (r.type & TYPE.SPELL) !== 0;
const isTrap = (r: CardRecord) => (r.type & TYPE.TRAP) !== 0;
/** Spell/Trap kinds besides Normal. */
const ST_KINDS = TYPE.QUICKPLAY | TYPE.CONTINUOUS | TYPE.EQUIP | TYPE.FIELD | TYPE.COUNTER | TYPE.RITUAL;

/** Why `r` can't be added to `deck` right now (copies, a full deck), or null. */
export function addProblem(deck: Deck, r: CardRecord, cards: CardDb): string | null {
  const name = r.alias || r.code;
  const copies = [...deck.main, ...(deck.extra ?? [])].filter((c) => (cards.records.get(c)?.alias || c) === name).length;
  if (copies >= DECK_RULES.copies) return `${DECK_RULES.copies} COPIES MAX`;
  if (goesToExtra(r)) return (deck.extra?.length ?? 0) >= DECK_RULES.extraMax ? `EXTRA DECK FULL (${DECK_RULES.extraMax})` : null;
  return deck.main.length >= DECK_RULES.mainMax ? `MAIN DECK FULL (${DECK_RULES.mainMax})` : null;
}

/** How many Monsters, Spells and Traps are in a list of cards. */
export function countKinds(codes: number[], cards: CardDb): { monsters: number; spells: number; traps: number } {
  const out = { monsters: 0, spells: 0, traps: 0 };
  for (const code of codes) {
    const r = cards.records.get(code);
    if (!r) continue;
    if (isMonster(r)) out.monsters++;
    else if (isSpell(r)) out.spells++;
    else out.traps++;
  }
  return out;
}

// --- Sorting -------------------------------------------------------------------------------------------------

export type SortKey = "type" | "name" | "level" | "atk" | "def";
export const SORT_KEYS: { key: SortKey; label: string }[] = [
  { key: "type", label: "TYPE" }, { key: "name", label: "NAME" }, { key: "level", label: "LEVEL" },
  { key: "atk", label: "ATK" }, { key: "def", label: "DEF" },
];

/** Card kind order: Normal, Effect, Ritual, Fusion Monsters, then Spells, then Traps. */
function kindRank(r: CardRecord): number {
  if (isSpell(r)) return 10;
  if (isTrap(r)) return 20;
  if (r.type & TYPE.FUSION) return 3;
  if (r.type & TYPE.RITUAL) return 2;
  return r.type & TYPE.EFFECT ? 1 : 0;
}

const byName = (a: CardRecord, b: CardRecord) => a.name.localeCompare(b.name);
/** Monsters first, highest value first; Spells and Traps after them in kind order. */
const monstersBy = (value: (r: CardRecord) => number) => (a: CardRecord, b: CardRecord) => {
  const ma = isMonster(a), mb = isMonster(b);
  if (ma !== mb) return ma ? -1 : 1;
  return ma ? value(b) - value(a) || byName(a, b) : kindRank(a) - kindRank(b) || byName(a, b);
};

const COMPARE: Record<SortKey, (a: CardRecord, b: CardRecord) => number> = {
  // Kind, then (Monsters) higher Level first, then name: how a deck list reads.
  type: (a, b) => kindRank(a) - kindRank(b) || (isMonster(a) ? (b.level & 0xff) - (a.level & 0xff) : 0) || byName(a, b),
  name: byName,
  level: monstersBy((r) => r.level & 0xff),
  atk: monstersBy((r) => r.atk),
  def: monstersBy((r) => r.def),
};

/** A deck's cards in the order the editor shows them (kind, Level, name), copies together. */
export function sortDeck(codes: number[], cards: CardDb): number[] {
  const rec = (c: number) => cards.records.get(c);
  return [...codes].sort((a, b) => {
    const ra = rec(a), rb = rec(b);
    return ra && rb ? COMPARE.type(ra, rb) || a - b : a - b;
  });
}

// --- Filters -------------------------------------------------------------------------------------------------

export interface FilterOption {
  label: string;
  test: (r: CardRecord) => boolean;
}

/** One row of the filter panel. A card passes a group when nothing in it is picked or it matches any picked option. */
export interface FilterGroup {
  label: string;
  options: FilterOption[];
  /**
   * A card has one value here (one Attribute, one Level...): picking an option replaces the picked one. Else (monster
   * kinds: Effect and Flip at once) picks add up, as alternatives.
   */
  single: boolean;
}

/** Picked option labels per group label (an empty or missing set = any). */
export type FilterState = Map<string, Set<string>>;

const typeBit = (label: string, bit: number): FilterOption => ({ label, test: (r) => isMonster(r) && (r.type & bit) !== 0 });
const stKind = (label: string, bit: number): FilterOption => ({ label, test: (r) => !isMonster(r) && (r.type & bit) !== 0 });

const ALL_GROUPS: FilterGroup[] = [
  { label: "CARD", single: true, options: [{ label: "MONSTER", test: isMonster }, { label: "SPELL", test: isSpell }, { label: "TRAP", test: isTrap }] },
  {
    label: "MONSTER",
    single: false,
    options: [
      typeBit("NORMAL", TYPE.NORMAL), typeBit("EFFECT", TYPE.EFFECT), typeBit("RITUAL", TYPE.RITUAL), typeBit("FUSION", TYPE.FUSION),
      typeBit("FLIP", TYPE.FLIP), typeBit("SPIRIT", TYPE.SPIRIT), typeBit("UNION", TYPE.UNION), typeBit("GEMINI", TYPE.GEMINI),
      typeBit("TOON", TYPE.TOON), typeBit("TUNER", TYPE.TUNER),
    ],
  },
  { label: "ATTRIBUTE", single: true, options: ATTRIBUTES.map(([bit, label]) => ({ label, test: (r) => isMonster(r) && (r.attribute & bit) !== 0 })) },
  {
    label: "LEVEL",
    single: true,
    options: Array.from({ length: 12 }, (_, i) => ({ label: String(i + 1), test: (r: CardRecord) => isMonster(r) && (r.level & 0xff) === i + 1 })),
  },
  { label: "TYPE", single: true, options: RACES.map(([bit, label]) => ({ label, test: (r) => isMonster(r) && (BigInt(r.race) & bit) !== 0n })) },
  {
    label: "SPELL/TRAP",
    single: true,
    options: [
      { label: "NORMAL", test: (r) => !isMonster(r) && (r.type & ST_KINDS) === 0 },
      stKind("QUICK-PLAY", TYPE.QUICKPLAY), stKind("CONTINUOUS", TYPE.CONTINUOUS), stKind("EQUIP", TYPE.EQUIP),
      stKind("FIELD", TYPE.FIELD), stKind("RITUAL", TYPE.RITUAL), stKind("COUNTER", TYPE.COUNTER),
    ],
  },
];

/** The filter groups, keeping only the options some card of `pool` has (no choice that always shows nothing). */
export function filterGroups(pool: CardRecord[]): FilterGroup[] {
  return ALL_GROUPS
    .map((g) => ({ ...g, options: g.options.filter((o) => pool.some(o.test)) }))
    .filter((g) => g.options.length > 0);
}

/** Picks or unpicks `option` of `group` (a `single` group keeps at most one pick). */
export function toggleFilter(state: FilterState, group: FilterGroup, option: string): void {
  const picked = state.get(group.label) ?? new Set<string>();
  if (picked.has(option)) picked.delete(option);
  else {
    if (group.single) picked.clear();
    picked.add(option);
  }
  state.set(group.label, picked);
}

/** How many options are picked across all groups. */
export const filterCount = (state: FilterState) => [...state.values()].reduce((n, s) => n + s.size, 0);

function passes(r: CardRecord, groups: FilterGroup[], state: FilterState): boolean {
  for (const g of groups) {
    const picked = state.get(g.label);
    if (picked?.size && !g.options.some((o) => picked.has(o.label) && o.test(r))) return false;
  }
  return true;
}

// --- The card list -------------------------------------------------------------------------------------------

/** The cards the editor lists (tokens never go in a deck), prepared for searching. */
export class CardList {
  readonly cards: CardRecord[];
  readonly groups: FilterGroup[];
  private readonly text = new Map<number, { name: string; compact: string; desc: string }>();

  constructor(records: Iterable<CardRecord>) {
    this.cards = [...records].filter((r) => !(r.type & TYPE.TOKEN));
    this.groups = filterGroups(this.cards);
    for (const r of this.cards) {
      const name = normalize(r.name);
      this.text.set(r.code, { name, compact: name.replace(/ /g, ""), desc: normalize(r.desc) });
    }
  }

  /**
   * The cards passing the filters whose name (or, with `inText`, card text) has every word of `query` (any order, case
   * and punctuation ignored), sorted by `sort`; name matches come before text-only matches.
   */
  find(query: string, state: FilterState, sort: SortKey, inText = true): CardRecord[] {
    const q = normalize(query);
    const words = q ? q.split(" ") : [];
    const named: CardRecord[] = [], described: CardRecord[] = [];
    for (const r of this.cards) {
      if (!passes(r, this.groups, state)) continue;
      const t = this.text.get(r.code)!;
      if (!words.length || words.every((w) => t.name.includes(w)) || t.compact.includes(q.replace(/ /g, ""))) named.push(r);
      else if (inText && words.every((w) => t.desc.includes(w))) described.push(r);
    }
    const cmp = COMPARE[sort];
    return [...named.sort(cmp), ...described.sort(cmp)];
  }
}
