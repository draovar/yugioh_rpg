// Per-browser preferences (localStorage). Storage can be unavailable (private mode, blocked site data):
// reads fall back to the default, writes are skipped.
import type { ChainMode } from "../duel/DuelController.ts";
import { DECK_RULES } from "../duel/deckEditor.ts";
import { DECKS, type DeckName } from "../duel/decks.ts";
import type { Deck } from "../duel/DuelSession.ts";

const DECK_KEY = "deck";

/** A deck the player built in the deck editor (saved in localStorage). */
export interface CustomDeck {
  id: string;
  name: string;
  main: number[];
  extra: number[];
}

const CUSTOM_KEY = "customDecks";
/** Deck slots in the editor (the world menu's deck lists must still fit on screen). */
export const MAX_CUSTOM_DECKS = 8;
/** Deck choices that are custom decks: this prefix + the deck's id (prebuilt decks are chosen by their DeckName). */
const CUSTOM_PREFIX = "custom:";

export function customDecks(): CustomDeck[] {
  try {
    const list = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]") as CustomDeck[];
    return Array.isArray(list) ? list.filter((d) => d && typeof d.id === "string" && Array.isArray(d.main)) : [];
  } catch { return []; }
}

/** Saves a custom deck (replacing the one with its id). */
export function saveCustomDeck(deck: CustomDeck): void {
  const list = customDecks();
  const i = list.findIndex((d) => d.id === deck.id);
  if (i >= 0) list[i] = deck;
  else list.push(deck);
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
}

export function deleteCustomDeck(id: string): void {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(customDecks().filter((d) => d.id !== id))); } catch { /* storage unavailable */ }
}

/** A deck the world menu offers: `key` is a DeckName or `custom:<id>`. */
export interface DeckEntry {
  key: string;
  label: string;
  deck: Deck;
}

/**
 * Every deck you can duel with: the prebuilt ones, then your custom decks that have a full Main Deck (the editor
 * keeps the other limits).
 */
export function deckEntries(): DeckEntry[] {
  const prebuilt = (Object.keys(DECKS) as DeckName[]).map((name) => ({ key: name, label: DECKS[name].label, deck: DECKS[name].deck }));
  const custom = customDecks().filter((d) => d.main.length >= DECK_RULES.mainMin)
    .map((d) => ({ key: CUSTOM_PREFIX + d.id, label: d.name, deck: { main: d.main, extra: d.extra } }));
  return [...prebuilt, ...custom];
}

/** The deck stored under `key`, or the prebuilt `fallback` (the key is unknown, or that custom deck was deleted). */
function deckEntry(key: string | null, fallback: DeckName): DeckEntry {
  return deckEntries().find((e) => e.key === key) ?? { key: fallback, label: DECKS[fallback].label, deck: DECKS[fallback].deck };
}

/** The deck the player picked in the world menu (vs the AI and in multiplayer). */
export function chosenDeck(): DeckEntry {
  try { return deckEntry(localStorage.getItem(DECK_KEY), "yugi"); } catch { return deckEntry(null, "yugi"); }
}

export function setChosenDeck(key: string): void {
  try { localStorage.setItem(DECK_KEY, key); } catch { /* storage unavailable */ }
}

/** The world menu's choice for a custom deck (to pick a deck right after saving it). */
export const customDeckKey = (id: string) => CUSTOM_PREFIX + id;

const AI_DECK_KEY = "aiDeck";

/** The deck the Rival (the AI) uses in a quick duel, picked in the world menu. */
export function aiDeck(): DeckEntry {
  try { return deckEntry(localStorage.getItem(AI_DECK_KEY), "kaiba"); } catch { return deckEntry(null, "kaiba"); }
}

export function setAiDeck(key: string): void {
  try { localStorage.setItem(AI_DECK_KEY, key); } catch { /* storage unavailable */ }
}

const REVEAL_KEY = "duel.revealAi";

/** Testing aid from the world menu: show the AI's hand and set cards during duels. */
export function revealAiCards(): boolean {
  try { return localStorage.getItem(REVEAL_KEY) === "1"; } catch { return false; }
}

export function setRevealAiCards(on: boolean): void {
  try { localStorage.setItem(REVEAL_KEY, on ? "1" : "0"); } catch { /* storage unavailable */ }
}

const LOOK_KEY = "player.look";
/** The player's character in the overworld: its walk and run sprites ("player" / "player-run" in characters.json). */
export const PLAYER_LOOKS = { boy: { walk: "player", run: "player-run" }, girl: { walk: "player-girl", run: "player-girl-run" } };
export type PlayerLook = keyof typeof PLAYER_LOOKS;

export function playerLook(): PlayerLook {
  try { return localStorage.getItem(LOOK_KEY) === "girl" ? "girl" : "boy"; } catch { return "boy"; }
}

export function setPlayerLook(look: PlayerLook): void {
  try { localStorage.setItem(LOOK_KEY, look); } catch { /* storage unavailable */ }
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
