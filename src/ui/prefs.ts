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

const AI_DECK_KEY = "aiDeck";

/** The prebuilt deck the Rival (the AI) uses, picked in the world menu. */
export function aiDeck(): DeckName {
  try {
    const name = localStorage.getItem(AI_DECK_KEY);
    if (name && name in DECKS) return name as DeckName;
  } catch { /* storage unavailable */ }
  return "kaiba";
}

export function setAiDeck(name: DeckName): void {
  try { localStorage.setItem(AI_DECK_KEY, name); } catch { /* storage unavailable */ }
}

const REVEAL_KEY = "duel.revealAi";

/** Testing aid from the world menu: show the AI's hand and set cards during duels. */
export function revealAiCards(): boolean {
  try { return localStorage.getItem(REVEAL_KEY) === "1"; } catch { return false; }
}

export function setRevealAiCards(on: boolean): void {
  try { localStorage.setItem(REVEAL_KEY, on ? "1" : "0"); } catch { /* storage unavailable */ }
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

const SPEED_KEY = "duel.animSpeed";
export const ANIM_SPEEDS = [1, 2, 4];

/** Duel animation speed (the duel screen's 1X/2X/4X button). */
export function animSpeed(): number {
  try {
    const saved = Number(localStorage.getItem(SPEED_KEY));
    if (ANIM_SPEEDS.includes(saved)) return saved;
  } catch { /* storage unavailable */ }
  return 1;
}

export function setAnimSpeed(speed: number): void {
  try { localStorage.setItem(SPEED_KEY, String(speed)); } catch { /* storage unavailable */ }
}
