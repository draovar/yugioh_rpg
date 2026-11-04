// Per-browser preferences (localStorage). Storage can be unavailable (private mode, blocked site data):
// reads fall back to the default, writes are skipped.
import type { ChainMode } from "../duel/DuelController.ts";
import { DECK_RULES } from "../duel/decks/deckRules.ts";
import { namedDecks } from "../duel/decks/decks.ts";
import type { Deck } from "../duel/engine/DuelSession.ts";
import { DECKS as SHOP_STOCK, STARTER_DECKS } from "../shop/deckStock.ts";

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
/** Deck slots in the editor. */
export const MAX_CUSTOM_DECKS = 8;
/** Deck choices that are custom decks: this prefix + the deck's id (named decks are chosen by their name, `namedDecks`). */
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

/** A deck the world menu offers: `key` is a named deck's (`namedDecks`) or `custom:<id>`. */
export interface DeckEntry {
  key: string;
  label: string;
  deck: Deck;
}

/** The shops' decks' short names by set code (STARTER YUGI...), for menus. */
const SHORT_NAMES = new Map([...STARTER_DECKS, ...SHOP_STOCK].map((d) => [d.code, d.short]));

/** Every named deck as a menu entry: the prebuilt ones, then the shops' (by their short names). */
export function namedDeckEntries(): DeckEntry[] {
  return namedDecks().map((d) => ({ key: d.key, label: SHORT_NAMES.get(d.key) ?? d.label, deck: d.deck }));
}

/**
 * Every deck you can duel with: the named ones, then your custom decks that have a full Main Deck (the editor keeps
 * the other limits).
 */
export function deckEntries(): DeckEntry[] {
  const custom = customDecks().filter((d) => d.main.length >= DECK_RULES.mainMin)
    .map((d) => ({ key: customDeckKey(d.id), label: d.name, deck: { main: d.main, extra: d.extra } }));
  return [...namedDeckEntries(), ...custom];
}

/** The deck stored under `key`, or the named deck `fallback` (the key is unknown, or that custom deck was deleted). */
function deckEntry(key: string | null, fallback: string): DeckEntry {
  const entries = deckEntries();
  return entries.find((e) => e.key === key) ?? entries.find((e) => e.key === fallback)!;
}

/** The deck the player picked in the world menu (vs the AI and in multiplayer); Starter Deck: Yugi by default. */
export function chosenDeck(): DeckEntry {
  return deckEntry(load(DECK_KEY), "SDY");
}

export function setChosenDeck(key: string): void {
  store(DECK_KEY, key);
}

const AI_DECK_KEY = "aiDeck";

/** The deck the Rival (the AI) uses in a quick duel, picked in the world menu; Starter Deck: Kaiba by default. */
export function aiDeck(): DeckEntry {
  return deckEntry(load(AI_DECK_KEY), "SDK");
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

const ZOOM_KEY = "world.zoom";
/**
 * The overworld's sprite size (world menu: ZOOM), in screen pixels per game pixel; null = as big as the window allows
 * (`worldSpriteScale` in src/ui/view.ts).
 */
export function worldZoom(): number | null {
  const zoom = Number(load(ZOOM_KEY));
  return Number.isInteger(zoom) && zoom >= 1 ? zoom : null;
}

export function setWorldZoom(zoom: number): void {
  store(ZOOM_KEY, String(zoom));
}

const INTEGER_KEY = "view.integerScale";
/**
 * Whether the game is scaled up by whole numbers of screen pixels only (world menu: SCALING, INTEGER / FIT); null =
 * not chosen, the device's default (`integerScaling` in src/ui/view.ts).
 */
export function integerScale(): boolean | null {
  const saved = load(INTEGER_KEY);
  if (saved === "1") return true;
  if (saved === "0") return false;
  return null;
}

export function setIntegerScale(on: boolean): void {
  store(INTEGER_KEY, on ? "1" : "0");
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
