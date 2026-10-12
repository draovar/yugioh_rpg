// Per-browser preferences (localStorage). Storage can be unavailable (private mode, blocked site data):
// reads fall back to the default, writes are skipped.
import { DECKS, type DeckName } from "../duel/decks.ts";

const DECK_KEY = "deck";

/** The prebuilt deck the player picked in the world menu (vs the AI and in multiplayer). */
export function chosenDeck(): DeckName {
  try {
    const name = localStorage.getItem(DECK_KEY);
    if (name && name in DECKS) return name as DeckName;
  } catch { /* storage unavailable */ }
  return "yugi";
}

export function setChosenDeck(name: DeckName): void {
  try { localStorage.setItem(DECK_KEY, name); } catch { /* storage unavailable */ }
}
