// Dev-only test boards: `/?duel&setup=NAME` places these cards before the duel starts (you go first), so a
// situation can be tried straight away instead of played into. Both decks are otherwise unchanged.
import { OcgLocation } from "ocgcore-wasm";
import type { Deck, StartCard } from "../duel/DuelSession.ts";

const BLUE_EYES = 89631139, DARK_MAGICIAN = 46986414, SKULL = 70781052, CELTIC = 91152256, GEMINI = 69140098;
const VORSE = 14898066, MAN_EATER = 54652250;

const hand = (code: number): StartCard => ({ code, location: OcgLocation.HAND });
const monster = (code: number, sequence: number): StartCard => ({ code, location: OcgLocation.MZONE, sequence });

const SETUPS: Record<string, { you: StartCard[]; opponent: StartCard[] }> = {
  /**
   * Tribute Summons: three monsters to tribute from, Blue-Eyes (2 tributes) and Summoned Skull / Dark
   * Magician (1 tribute) in hand, and two opponent monsters to attack.
   */
  tribute: {
    you: [monster(CELTIC, 1), monster(VORSE, 2), monster(MAN_EATER, 3), hand(BLUE_EYES), hand(SKULL), hand(DARK_MAGICIAN)],
    opponent: [monster(GEMINI, 1), monster(CELTIC, 3)],
  },
};

/** Adds the named setup's cards to the two decks (unknown names are reported and ignored). */
export function withDevSetup(decks: [Deck, Deck], name: string | undefined): [Deck, Deck] {
  if (!name) return decks;
  const setup = SETUPS[name];
  if (!setup) {
    console.warn(`unknown &setup=${name}; known: ${Object.keys(SETUPS).join(", ")}`);
    return decks;
  }
  return [{ ...decks[0], start: setup.you }, { ...decks[1], start: setup.opponent }];
}
