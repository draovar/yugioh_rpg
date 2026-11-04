// What the deck shop and the starter deck choice make of a deck list (the shops' stock: deckStock.ts; the lists:
// public/data/decks.json, `npm run build-data`, loaded with the engine): its board rows (deckRows), its cards
// (deckCards). Box pictures: public/deck-boxes/<code>.png (`npm run build-deck-boxes`).
import { sortDeck } from "../duel/decks/deckRules.ts";
import { deckFromList, type DeckList } from "../duel/decks/decks.ts";
import type { Engine } from "../duel/engine/loadEngine.ts";
import { rarityLook } from "./boosters.ts";
import type { DeckStock } from "./deckStock.ts";
import type { BoardRow } from "./ShopBoard.ts";
import { monthYear } from "./shopParts.ts";

/**
 * A deck on a shop board: its cards as the deck editor sorts them by type, each with its copies and (above Common) its
 * rarity chip; the facts line (kind, release, size).
 */
export function deckRows(d: DeckStock, list: DeckList | undefined, engine: Engine): { rows: BoardRow[]; facts: string } {
  const listed = new Map<number, { copies: number; rarity: string }>();
  for (const [, code, rarity, n] of list?.cards ?? []) listed.set(code, { copies: (listed.get(code)?.copies ?? 0) + n, rarity });
  const rows: BoardRow[] = sortDeck([...listed.keys()], engine.cards).map((code) => {
    const c = listed.get(code)!, name = engine.cards.records.get(code)?.name ?? `#${code}`;
    return { code, name, copies: c.copies, chip: c.rarity === "Common" ? null : rarityLook(c.rarity) };
  });
  const total = rows.reduce((n, r) => n + (r.copies ?? 0), 0);
  const facts = `${d.kind === "starter" ? "STARTER DECK" : "STRUCTURE DECK"}  -  ${monthYear(d.released)}` +
    (list ? `  -  ${total} CARDS` : "");
  return { rows, facts };
}

/** A deck's cards: a passcode per copy, Fusions to the Extra Deck; each card's rarity in the deck. */
export function deckCards(list: DeckList, engine: Engine): { main: number[]; extra: number[]; rarity: Map<number, string> } {
  const { main, extra = [] } = deckFromList(list, engine.cards);
  return { main, extra, rarity: new Map(list.cards.map(([, code, r]) => [code, r])) };
}
