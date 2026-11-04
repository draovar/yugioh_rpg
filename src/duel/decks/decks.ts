// Decks with a name (NPCs, the AI, starting points in the deck editor): the prebuilt ones here, and the shops' starter
// and structure decks by set code once loaded (`setShopDecks`). Every card must be in data/pool.json, every deck legal
// (the smoke tests check).
import { TYPE, type CardDb } from "../engine/cardData.ts";
import type { Deck } from "../engine/DuelSession.ts";
import { DECK_RULES, copiesAllowed, forbiddenCopies, goesToExtra, nameCounts } from "./deckRules.ts";

/** Passcodes of the cards the decks use, by name. */
const C = {
  // monsters
  lonefireBlossom: 48686504, gigaplant: 53257892, regeneratingRose: 31986288, fairyKingTruesdale: 45425051,
  lordPoison: 40320754, rafflesiaSeduction: 31440542, jerryBeansMan: 23635815, samsaraLotus: 5592689,
  rigorousReaver: 39180960, grassPhantom: 41249545, motherGrizzly: 57839750, mysticTomato: 83011277,
  howlingInsect: 93107608, gokipon: 14472500, ultimateInsectLv3: 34088136, ultimateInsectLv5: 34830502,
  ultimateInsectLv7: 19877898, insectQueen: 91512835, pinchHopper: 26185991, insectKnight: 35052053, neoBug: 16587243,
  girochinKuwagata: 84620194, chainsawInsect: 77252217, arsenalBug: 42364374, parasiteParacide: 27911549,
  manEaterBug: 54652250,
  // spells
  forest: 87430998, vileGerms: 39774685, prematureBurial: 70828912, mst: 5318639, fissure: 66788016,
  smashingGround: 97169186, lightningVortex: 69162969, rushRecklessly: 70046172, laserCannonArmor: 77007920,
  multiplicationOfAnts: 22493811, insectImitation: 96965364, insectBarrier: 23615409,
  // traps
  sinisterSeeds: 60406591, sakuretsu: 56120475, callOfTheHaunted: 97077563, mirrorForce: 44095762, torrential: 53582587,
  bottomless: 29401950, dustTornado: 60082869, trapHole: 4206964, spellbindingCircle: 18807108,
} as const;

type Name = keyof typeof C;
const list = (cards: Partial<Record<Name, number>>): number[] =>
  Object.entries(cards).flatMap(([name, n]) => Array<number>(n).fill(C[name as Name]));

interface DeckDef {
  label: string;
  deck: Deck;
}

export const DECKS = {
  // Early-game NPC deck (owner's picks): Lonefire Blossom pulls Plants from the Deck; Mystic Tomato / Mother Grizzly /
  // Lord Poison replace themselves when destroyed. No Dark Hole, Swords or Monster Reborn, to keep it beatable.
  plants: {
    label: "Plants",
    deck: {
      main: list({
        lonefireBlossom: 3, gigaplant: 2, regeneratingRose: 1, fairyKingTruesdale: 2, lordPoison: 2, mysticTomato: 2,
        rafflesiaSeduction: 1, jerryBeansMan: 2, samsaraLotus: 1, rigorousReaver: 1, grassPhantom: 2, motherGrizzly: 2,
        forest: 1, vileGerms: 2, prematureBurial: 1, mst: 1, fissure: 1, smashingGround: 1, lightningVortex: 1,
        rushRecklessly: 1,
        sinisterSeeds: 2, sakuretsu: 2, callOfTheHaunted: 1, mirrorForce: 1, torrential: 1, bottomless: 1,
        dustTornado: 1, trapHole: 1,
      }),
    },
  },
  // Early-game NPC deck in Weevil's style (owner's OK): Howling Insect / Gokipon fetch small Insects, Ultimate Insect
  // levels up to LV7, Insect Queen finishes; Parasite Paracide + Insect Barrier as the gimmick.
  insects: {
    label: "Insects",
    deck: {
      main: list({
        howlingInsect: 3, gokipon: 2, ultimateInsectLv3: 2, ultimateInsectLv5: 1, ultimateInsectLv7: 1, insectQueen: 1,
        pinchHopper: 1, insectKnight: 2, neoBug: 2, girochinKuwagata: 1, chainsawInsect: 1, arsenalBug: 1, manEaterBug: 2,
        parasiteParacide: 1,
        forest: 1, laserCannonArmor: 2, multiplicationOfAnts: 1, insectImitation: 1, insectBarrier: 1, mst: 1,
        prematureBurial: 1, fissure: 1, smashingGround: 1,
        sakuretsu: 2, trapHole: 2, spellbindingCircle: 1, mirrorForce: 1, callOfTheHaunted: 1, bottomless: 1,
        dustTornado: 1,
      }),
    },
  },
} satisfies Record<string, DeckDef>;

export type DeckName = keyof typeof DECKS;

/**
 * A starter or structure deck's list in public/data/decks.json: data/decks.json from build-pool (as printed), with this
 * game's revisions (data/deck-revisions.json) applied by build-data. Each card is [number, passcode, rarity, copies].
 */
export interface DeckList {
  code: string;
  name: string;
  /** TCG release date, YYYY-MM-DD. */
  released: string;
  cards: [string, number, string, number][];
}

/** A list's cards as a deck: a passcode per copy, Fusions to the Extra Deck. */
export function deckFromList(list: DeckList, cards: CardDb): Deck {
  const main: number[] = [], extra: number[] = [];
  for (const [, code, , copies] of list.cards) {
    const r = cards.records.get(code);
    for (let i = 0; i < copies; i++) (r && goesToExtra(r) ? extra : main).push(code);
  }
  return { main, extra };
}

/** The shops' starter and structure decks by set code, in release order (`setShopDecks`). */
const shopDecks = new Map<string, DeckDef>();

/** Makes the shops' decks pickable by set code like the prebuilt ones (loadEngine; the Node tools' engine.ts). */
export function setShopDecks(lists: DeckList[], cards: CardDb): void {
  shopDecks.clear();
  for (const l of lists) shopDecks.set(l.code, { label: l.name, deck: deckFromList(l, cards) });
}

/** Every deck with a name: the prebuilt ones by key, then the shops' by set code (release order). */
export function namedDecks(): ({ key: string } & DeckDef)[] {
  return [
    ...Object.entries(DECKS).map(([key, d]) => ({ key, ...d })),
    ...[...shopDecks].map(([key, d]) => ({ key, ...d })),
  ];
}

const namedDeck = (name: string): Deck | undefined =>
  Object.hasOwn(DECKS, name) ? DECKS[name as DeckName].deck : shopDecks.get(name)?.deck;

/** The deck named `name` (a prebuilt deck's key or a shop deck's set code), else `fallback`'s. */
export function deckByName(name: string | null | undefined, fallback: string): Deck {
  const deck = (name ? namedDeck(name) : undefined) ?? namedDeck(fallback);
  if (!deck) throw new Error(`no deck named "${fallback}"`);
  return deck;
}

/** The name of a named deck (the same object, as passed around by the scenes), or null for any other deck. */
export function deckNameOf(deck: Deck): string | null {
  return namedDecks().find((d) => d.deck === deck)?.key ?? null;
}

/**
 * Why a deck isn't legal: 40-60 main, up to 15 extra, every card known (tokens excluded), and the banlist
 * (`banlistProblems`). Prebuilt decks and the shops' decks follow the same rules (smoke checks them).
 */
export function deckProblems(deck: Deck, cards: CardDb): string[] {
  const out: string[] = [];
  const main = deck.main, extra = deck.extra ?? [];
  if (main.length < DECK_RULES.mainMin || main.length > DECK_RULES.mainMax) out.push(`main deck has ${main.length} cards`);
  if (extra.length > DECK_RULES.extraMax) out.push(`extra deck has ${extra.length} cards`);
  for (const code of new Set([...main, ...extra])) {
    const r = cards.records.get(code);
    if (!r) out.push(`unknown card ${code}`);
    else if (r.type & TYPE.TOKEN) out.push(`${r.name} is a token`);
  }
  return [...out, ...banlistProblems(deck, cards)];
}

/**
 * The copy limits per name (`nameCounts`; data/banlist.json, else 3): too many of one name, or more Forbidden cards
 * than `DECK_RULES.forbidden` (copies, all names together).
 */
export function banlistProblems(deck: Deck, cards: CardDb): string[] {
  const out: string[] = [];
  const counts = nameCounts(deck, cards);
  const forbidden: string[] = [];
  for (const [key, n] of counts) {
    const r = cards.records.get(key);
    if (!r) continue;
    const allowed = copiesAllowed(r);
    if (allowed === 0) forbidden.push(n > 1 ? `${r.name} x${n}` : r.name);
    else if (n > allowed) out.push(`${r.name} x${n} (${allowed} allowed)`);
  }
  if (forbiddenCopies(counts, cards) > DECK_RULES.forbidden) {
    out.push(`${forbidden.join(", ")}: forbidden (${DECK_RULES.forbidden} forbidden card allowed)`);
  }
  return out;
}
