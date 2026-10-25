// Per-browser preferences (localStorage). Storage can be unavailable (private mode, blocked site data):
// reads fall back to the default, writes are skipped.
import type { ChainMode } from "../duel/DuelController.ts";
import { DECK_RULES } from "../duel/decks/deckRules.ts";
import { DECKS, type DeckName } from "../duel/decks/decks.ts";
import type { Deck } from "../duel/engine/DuelSession.ts";

function load(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function store(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

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

/** The world menu's choice for a custom deck (to pick a deck right after saving it). */
export const customDeckKey = (id: string) => CUSTOM_PREFIX + id;

export function customDecks(): CustomDeck[] {
  try {
    const list = JSON.parse(load(CUSTOM_KEY) ?? "[]") as CustomDeck[];
    return Array.isArray(list) ? list.filter((d) => d && typeof d.id === "string" && Array.isArray(d.main)) : [];
  } catch { return []; }
}

/** Saves a custom deck (replacing the one with its id). */
export function saveCustomDeck(deck: CustomDeck): void {
  const list = customDecks();
  const i = list.findIndex((d) => d.id === deck.id);
  if (i >= 0) list[i] = deck;
  else list.push(deck);
  store(CUSTOM_KEY, JSON.stringify(list));
}

export function deleteCustomDeck(id: string): void {
  store(CUSTOM_KEY, JSON.stringify(customDecks().filter((d) => d.id !== id)));
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
    .map((d) => ({ key: customDeckKey(d.id), label: d.name, deck: { main: d.main, extra: d.extra } }));
  return [...prebuilt, ...custom];
}

/** The deck stored under `key`, or the prebuilt `fallback` (the key is unknown, or that custom deck was deleted). */
function deckEntry(key: string | null, fallback: DeckName): DeckEntry {
  return deckEntries().find((e) => e.key === key) ?? { key: fallback, label: DECKS[fallback].label, deck: DECKS[fallback].deck };
}

/** The deck the player picked in the world menu (vs the AI and in multiplayer). */
export function chosenDeck(): DeckEntry {
  return deckEntry(load(DECK_KEY), "yugi");
}

export function setChosenDeck(key: string): void {
  store(DECK_KEY, key);
}

const AI_DECK_KEY = "aiDeck";

/** The deck the Rival (the AI) uses in a quick duel, picked in the world menu. */
export function aiDeck(): DeckEntry {
  return deckEntry(load(AI_DECK_KEY), "kaiba");
}

export function setAiDeck(key: string): void {
  store(AI_DECK_KEY, key);
}

const REVEAL_KEY = "duel.revealAi";

/** Testing aid from the world menu: show the AI's hand and set cards during duels. */
export function revealAiCards(): boolean {
  return load(REVEAL_KEY) === "1";
}

export function setRevealAiCards(on: boolean): void {
  store(REVEAL_KEY, on ? "1" : "0");
}

const LOOK_KEY = "player.look";
/** The player's character in the overworld: its walk and run sprites ("player" / "player-run" in characters.json). */
export const PLAYER_LOOKS = { boy: { walk: "player", run: "player-run" }, girl: { walk: "player-girl", run: "player-girl-run" } };
export type PlayerLook = keyof typeof PLAYER_LOOKS;

export function playerLook(): PlayerLook {
  return load(LOOK_KEY) === "girl" ? "girl" : "boy";
}

export function setPlayerLook(look: PlayerLook): void {
  store(LOOK_KEY, look);
}

const CHAIN_KEY = "duel.chainMode";
export const CHAIN_MODES: ChainMode[] = ["auto", "all", "off"];

/** When the duel asks whether to chain (the duel screen's CHAIN button). */
export function chainMode(): ChainMode {
  const mode = load(CHAIN_KEY);
  return CHAIN_MODES.includes(mode as ChainMode) ? mode as ChainMode : "auto";
}

export function setChainMode(mode: ChainMode): void {
  store(CHAIN_KEY, mode);
}

const SPEED_KEY = "duel.animSpeed";
export const ANIM_SPEEDS = [1, 2, 4];

/** Duel animation speed (the duel screen's 1X/2X/4X button). */
export function animSpeed(): number {
  const saved = Number(load(SPEED_KEY));
  return ANIM_SPEEDS.includes(saved) ? saved : 1;
}

export function setAnimSpeed(speed: number): void {
  store(SPEED_KEY, String(speed));
}
