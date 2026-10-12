// Per-browser preferences (localStorage). Storage can be unavailable (private mode, blocked site data):
// reads fall back to the default, writes are skipped.
import type { ChainMode } from "../duel/DuelController.ts";
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

/** Saves the duel UI theme (read by theme.ts at startup) and reloads the page, since the theme is fixed per page. */
export function switchTheme(name: string): void {
  try { localStorage.setItem("theme", name); } catch { /* storage unavailable */ }
  const url = new URL(location.href);
  if (!url.searchParams.has("theme")) return location.reload();
  url.searchParams.delete("theme"); // the dev URL option would override the saved choice
  location.replace(url);
}

const CHAIN_KEY = "duel.chainMode";
export const CHAIN_MODES: ChainMode[] = ["auto", "all", "off"];

/** When the duel asks whether to chain (the duel screen's CHAIN button). */
export function chainMode(): ChainMode {
  try {
    const mode = localStorage.getItem(CHAIN_KEY);
    if (CHAIN_MODES.includes(mode as ChainMode)) return mode as ChainMode;
  } catch { /* storage unavailable */ }
  return "auto";
}

export function setChainMode(mode: ChainMode): void {
  try { localStorage.setItem(CHAIN_KEY, mode); } catch { /* storage unavailable */ }
}
