// Prebuilt decks until the deck editor exists.
import type { CardDb } from "./cardData.ts";
import type { Deck } from "./DuelSession.ts";

/**
 * Two copies of every card in the pool, cut to 40. Both players use it in a peer-to-peer duel, so it
 * must come out identical on both machines: built from passcodes in ascending order, never from the
 * order of cards.json.
 */
export function starterDeck(cards: CardDb): Deck {
  const pool = [...cards.records.keys()].sort((a, b) => a - b);
  return { main: [...pool, ...pool].slice(0, 40) };
}
