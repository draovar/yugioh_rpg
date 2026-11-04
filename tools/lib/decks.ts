// Decks by name for the Node tools: a prebuilt deck's key (src/duel/decks/decks.ts) or a shop deck's set code
// (public/data/decks.json, revisions applied: `npm run build-data`; registered by engine.ts), e.g. `plants`, `SDY`.
import { namedDecks } from "../../src/duel/decks/decks.ts";
import type { Deck } from "../../src/duel/engine/DuelSession.ts";
import "./engine.ts";

/** The decks the AI tools play by default (arena, tune): the prebuilt NPC decks and the four starter decks. */
export const AI_TEST_DECKS = ["plants", "insects", "SDY", "SDK", "SDJ", "SDP"];

/** The deck named `name`; throws on an unknown name, listing the known ones. */
export function deckNamed(name: string): Deck {
  const all = namedDecks();
  const deck = all.find((d) => d.key === name)?.deck;
  if (!deck) throw new Error(`unknown deck "${name}" (have: ${all.map((d) => d.key).join(", ")})`);
  return deck;
}
