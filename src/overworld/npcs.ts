import type { DeckName } from "../duel/decks/decks.ts";
import type { Facing } from "./characters.ts";

export interface NpcDef {
  name: string;
  /** Character in characters.json (docs/characters.png shows them all). */
  sprite: string;
  /** Where they look while nobody talks to them (default down; side = right, left = side flipped). */
  facing?: Facing | "left";
  x: number;
  y: number;
  text: string;
  deck: DeckName;
}

// NPCs by map. Placeholder text until real dialog is written.
export const NPCS: Record<string, NpcDef[]> = {
  overworld: [
    { name: "Yugi", sprite: "yugi", x: 500, y: 440, text: "Hey! Do you want to duel?", deck: "yugi" },
    { name: "Kaiba", sprite: "kaiba", x: 680, y: 440, text: "Hmph. Do you think you can beat me?", deck: "kaiba" },
    { name: "Joey", sprite: "joey", x: 160, y: 690, text: "Yo! Wanna see my Red-Eyes?", deck: "dragonsRoar" },
    { name: "Bonz", sprite: "bonz", x: 120, y: 150, text: "Heh heh... care for a shadow game?", deck: "zombieMadness" },
  ],
};

/** An NPC who jumps out of a hedge at random (ambush.ts) and challenges the player. */
export interface AmbushDef {
  name: string;
  /** Character in characters.json, also listed in its "ambush" (tools/art/build-ambush.mjs draws the jump out). */
  sprite: string;
  text: string;
}

// Hedge ambushers by map. Placeholder name and text.
export const AMBUSHERS: Record<string, AmbushDef[]> = {
  maze: [{ name: "Hedge Hopper", sprite: "black-hair-purple", text: "Gotcha! Nobody gets through my maze without a duel!" }],
};
