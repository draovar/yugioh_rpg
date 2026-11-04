// The deck editor's left side: the table, the top bar's plate, the mat (in the "mat" template), and where a deck lies
// on it (labels, empty slots, each card's place). Shared with the deck shop's unboxing, which lays a bought deck out
// just as the deck editor shows it.
import Phaser from "phaser";
import { countKinds, DECK_RULES, sortDeck } from "../duel/decks/deckRules.ts";
import type { CardDb } from "../duel/engine/cardData.ts";
import { drawTable } from "../duel-screen/field.ts";
import { CARD, INSET } from "../duel-screen/layout.ts";
import { text } from "../ui/pixel.ts";
import { THEME, ui } from "../ui/theme.ts";
import { BAR, EXTRA_LABEL_Y, EXTRA_Y, FELT, GRID_W, GRID_X, MAIN_LABEL_Y, MAIN_Y, MAT, PITCH, ROW_PITCH } from "./layout.ts";

/** A Main Deck count under the minimum. */
const SHORT_COLOR = 0xff8a70;

/** The table, the top bar's plate and the mat under the deck, into `parts`. */
export function drawDeckTable(scene: Phaser.Scene, parts: Phaser.GameObjects.Container) {
  drawTable(scene, parts, 0);
  const pr = INSET.plate;
  parts.add(scene.add.nineslice(BAR.x, BAR.y, ui("menu-back"), undefined, BAR.w, BAR.h, pr, pr, pr, pr).setOrigin(0));
  // "mat" template: a framed felt mat under the deck; "open": the deck straight on the table (slot plates, deckSlots).
  if (THEME.template === "mat") {
    parts.add(scene.add.nineslice(MAT.x, MAT.y, ui("menu-back"), undefined, MAT.w, MAT.h, pr, pr, pr, pr).setOrigin(0));
    parts.add(scene.add.graphics().fillStyle(THEME.field.felt).fillRect(FELT.x, FELT.y, FELT.w, FELT.h));
  }
}

/**
 * A deck's labels ("MAIN DECK" and its size, red under the minimum; Monsters / Spells / Traps; "EXTRA DECK" and its
 * size) and the empty slots of the first 40 Main / 10 Extra, like the duel's zones: outlined on the mat, or plates on
 * the table ("zone-monster" for the Main Deck, "menu-back" for the Extra Deck, as the duel's monster / other zones).
 */
export function deckSlots(scene: Phaser.Scene, into: Phaser.GameObjects.Container, main: number[], extra: number[], cards: CardDb) {
  const label = THEME.field.label, kinds = countKinds(main, cards);
  into.add(text(scene, GRID_X, MAIN_LABEL_Y, "MAIN DECK", { color: label }));
  into.add(text(scene, GRID_X + 40, MAIN_LABEL_Y, String(main.length), { color: main.length < DECK_RULES.mainMin ? SHORT_COLOR : THEME.plate.ink }));
  into.add(text(scene, GRID_X + GRID_W, MAIN_LABEL_Y, `MONSTERS ${kinds.monsters}   SPELLS ${kinds.spells}   TRAPS ${kinds.traps}`, { color: label, originX: 1 }));
  into.add(text(scene, GRID_X, EXTRA_LABEL_Y, "EXTRA DECK", { color: label }));
  into.add(text(scene, GRID_X + 44, EXTRA_LABEL_Y, String(extra.length), { color: THEME.plate.ink }));

  const empty: [number, number, boolean][] = [];
  for (let i = main.length; i < 40; i++) empty.push([GRID_X + (i % 10) * PITCH, MAIN_Y + Math.floor(i / 10) * ROW_PITCH, true]);
  for (let i = extra.length; i < 10; i++) empty.push([GRID_X + i * PITCH, EXTRA_Y, false]);
  if (THEME.template === "mat") {
    const g = scene.add.graphics().lineStyle(1, THEME.field.line);
    for (const [x, y] of empty) g.strokeRect(x + 0.5, y + 0.5, CARD.w - 1, CARD.h - 1);
    into.add(g);
  } else {
    const rim = THEME.plate.slice;
    for (const [x, y, inMain] of empty) {
      into.add(scene.add.nineslice(x, y, ui(inMain ? "zone-monster" : "menu-back"), undefined, CARD.w, CARD.h, rim, rim, rim, rim).setOrigin(0));
    }
  }
}

/** One card of a deck on the mat: (x, y) is its top-left. */
export interface DeckPlace {
  code: number;
  part: "main" | "extra";
  x: number;
  y: number;
}

/**
 * Where a deck's cards lie, sorted as the deck editor shows them (`sortDeck`). Ten to a row; past that (Main Deck over
 * 40, Extra over 10) the cards squeeze together, each overlapping the last.
 */
export function deckPlaces(main: number[], extra: number[], cards: CardDb): DeckPlace[] {
  const sortedMain = sortDeck(main, cards), sortedExtra = sortDeck(extra, cards);
  const perRow = Math.max(10, Math.ceil(sortedMain.length / 4));
  const pitchOf = (n: number) => (n > 10 ? (GRID_W - CARD.w) / (n - 1) : PITCH);
  return [
    ...sortedMain.map((code, i): DeckPlace => ({
      code, part: "main", x: GRID_X + Math.round((i % perRow) * pitchOf(perRow)), y: MAIN_Y + Math.floor(i / perRow) * ROW_PITCH,
    })),
    ...sortedExtra.map((code, i): DeckPlace => ({ code, part: "extra", x: GRID_X + Math.round(i * pitchOf(sortedExtra.length)), y: EXTRA_Y })),
  ];
}
