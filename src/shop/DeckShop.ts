// The deck shop (a "deckshop" spot in the overworld, or `?deckshop`): the starter and structure decks (decks.ts) hang
// on a pegboard on the panelled wall, each on a peg through its box's hanger hole, a price label under it, four
// to a row, two rows in view; with more, the rows scroll a row at a time (wheel, swipe, the arrow tabs on the frame, or
// the arrow keys picking a deck out of view; shopParts.ts ScrollingFixture). Clicking (tapping) a box, or the arrow
// keys, picks it: it lifts a little on its peg. On the right Runewood's board (ShopBoard.ts): the picked deck's name,
// kind, release and size, its deck list (the deck editor's card rows), the price and BUY: the box opens over the shop
// (DeckOpening.ts) and the deck can be saved as one of the custom deck slots. One deck at a time, free for now: the card
// collection isn't built yet, so there's no - / + and no chips are spent.
// Box pictures: public/deck-boxes/<CODE>.png (`npm run build-deck-boxes`: pixel art at half the cut-outs' size, with an
// outline); a missing one shows as a blank box with its code.
import Phaser from "phaser";
import type { DeckList } from "../duel/decks/decks.ts";
import { loadEngine, type Engine } from "../duel/engine/loadEngine.ts";
import { MAX_CUSTOM_DECKS, customDecks, saveCustomDeck } from "../ui/prefs.ts";
import { transitionTo, transitioning } from "../ui/Transition.ts";
import { setViewMode } from "../ui/view.ts";
import { DeckOpening } from "./DeckOpening.ts";
import { deckCards, deckRows } from "./decks.ts";
import { DECKS, type DeckStock } from "./deckStock.ts";
import type { ShopData } from "./Shop.ts";
import { ShopBoard } from "./ShopBoard.ts";
import {
  IN, RUNEWOOD, ScrollingFixture, blankPicture, drawChipsAndExit, drawRoom, drawTag, liftTo, preloadShopButtons, tagPrice,
} from "./shopParts.ts";

/** Box pictures are drawn at 1x (tools/art/build-deck-boxes.mjs makes them this size, outline included). */
const DECK_BOX = { w: 78, h: 126 };
/** Where the peg goes through a box picture's hanger hole (the bump on top of the slot; the same in every cut-out). */
const PEG_AT = { x: 33, y: 9 };
/** Four decks to a row, two rows in view. */
const COLS = 4, ROW_H = IN.h / 2;
/** Pegboard holes HOLE px apart, on x = 0 and y = HOLE_Y (ROW_H is 13 of them, COL_W 8, so every peg sits in a hole). */
const HOLE = 12, HOLE_Y = IN.y + 6;
/** The pegs' x (in holes), COL_W apart; from a row's top: the box's top (its peg then in a hole), the price label's top. */
const PEG_X = 60, COL_W = 96, BOX_Y = 9, TAG_Y = 142;
/** A peg, front on (it comes straight out of the board through the box's hole): 5x5 pixels around its middle, light
 * top-left, dark bottom-right, outlined like the boxes. "o" outline, "l" light, "m" metal, "d" dark. */
const PEG = [".ooo.", "ollmo", "olmdo", "omddo", ".ooo."];
/** A picked box lifts this far: it still hangs in its hole, now on the hole's bottom. */
const LIFT = 3;
/** Decks bought at once, at most (one until the card collection makes more copies worth having: no - / +). */
const MAX_DECKS = 1;
/** The pegboard (brown hardboard, its holes with a light lower lip), the pegs' metal, the boxes' shadows. */
const PB = {
  board: 0xa8835a, boardShadow: 0x8f6e4a, hole: 0x4e3622, holeLip: 0xc29a6e, shadow: 0x000000,
  peg: { o: 0x1a1410, l: 0xeceef2, m: 0xc8ccd2, d: 0x80848c } as Record<string, number>,
};
/** A box's shadow on the board: a black copy this far down-right, this opaque. */
const SHADOW = { by: 2, alpha: 0.3 };

const boxKey = (d: DeckStock) => `deck-box-${d.code}`;
/** The box at its full size (public/deck-boxes/large/), for opening it. */
const largeKey = (d: DeckStock) => `deck-box-large-${d.code}`;

export class DeckShop extends Phaser.Scene {
  private engine!: Engine;
  private lists = new Map<string, DeckList>();
  private chips = 0;
  private picked = 0;
  private boxes: Phaser.GameObjects.Container[] = [];
  private tags!: Phaser.GameObjects.Graphics;
  /** The pegboard's rows: everything on them, scrolling a row at a time. */
  private wall!: ScrollingFixture;
  private board!: ShopBoard;
  /** A deck being opened over the shop; the shop ignores input meanwhile. */
  private opening: DeckOpening | null = null;

  constructor() {
    super("DeckShop");
  }

  init(data: ShopData) {
    this.chips = data.chips ?? 0;
    this.picked = 0;
    this.boxes = [];
    this.opening = null;
  }

  preload() {
    ShopBoard.preload(this);
    preloadShopButtons(this);
    for (const d of DECKS) {
      if (!this.textures.exists(boxKey(d))) this.load.image(boxKey(d), `deck-boxes/${d.code}.png`);
      if (!this.textures.exists(largeKey(d))) this.load.image(largeKey(d), `deck-boxes/large/${d.code}.png`);
    }
  }

  async create() {
    setViewMode(this.game, "fixed");
    this.engine = await loadEngine();
    this.lists = this.engine.deckLists;

    // The pegboard's hardboard, a shadow under the frame's top; its holes scroll with the rows.
    drawRoom(this, "DECK SHOP", (g) => {
      g.fillStyle(PB.board).fillRect(IN.x, IN.y, IN.w, IN.h);
      g.fillStyle(PB.boardShadow).fillRect(IN.x, IN.y, IN.w, 3);
    });
    this.drawWall();
    this.board = new ShopBoard(this, this.engine, {
      maxQuantity: MAX_DECKS, busy: () => !!this.opening, onBuy: () => this.buy(), rows: "cards",
    });
    drawChipsAndExit(this, this.chips, () => this.exit());

    this.input.keyboard?.on("keydown", (e: KeyboardEvent) => this.handleKey(e.code));

    this.boxes[0].y -= LIFT;
    this.showDeck();
  }

  /** Deck i's peg (x) and its row's top. */
  private cell(i: number) {
    return { pegX: PEG_X + (i % COLS) * COL_W, rowTop: IN.y + Math.floor(i / COLS) * ROW_H };
  }

  /** Top-left of deck i's box, hanging on its peg. */
  private boxXY(i: number): [number, number] {
    const { pegX, rowTop } = this.cell(i);
    return [pegX - PEG_AT.x, rowTop + BOX_Y];
  }

  /** Deck i's price label: its centre (under the box's), its top. */
  private tagXY(i: number): [number, number] {
    const [x] = this.boxXY(i), { rowTop } = this.cell(i);
    return [x + DECK_BOX.w / 2, rowTop + TAG_Y];
  }

  /**
   * The pegboard and everything on it: the holes (all rows), per deck the box with its shadow on the board (the board
   * shows through its hanger hole), its peg in front (out of a hole, through the box's hole), the price label under it,
   * a hit zone (covering the lifted box too).
   */
  private drawWall() {
    this.wall = new ScrollingFixture(this, { count: DECKS.length, perRow: COLS, rowH: ROW_H, busy: () => !!this.opening });
    const content = this.wall.content;

    const g = this.add.graphics();
    for (let y = HOLE_Y; y < IN.y + this.wall.rows * ROW_H; y += HOLE) {
      for (let x = Math.ceil(IN.x / HOLE) * HOLE; x < IN.x + IN.w - 1; x += HOLE) {
        g.fillStyle(PB.hole).fillRect(x - 1, y - 1, 2, 2);
        g.fillStyle(PB.holeLip).fillRect(x - 1, y + 1, 2, 1);
      }
    }
    content.add(g);

    DECKS.forEach((d, i) => {
      const box = this.add.container(...this.boxXY(i), this.boxPicture(d));
      this.boxes.push(box);
      content.add(box);
    });
    const pegs = this.add.graphics();
    DECKS.forEach((_, i) => {
      const { pegX, rowTop } = this.cell(i), top = rowTop + BOX_Y + PEG_AT.y - 2;
      PEG.forEach((row, dy) => [...row].forEach((ch, dx) => {
        if (ch !== ".") pegs.fillStyle(PB.peg[ch]).fillRect(pegX - 2 + dx, top + dy, 1, 1);
      }));
    });
    content.add(pegs);

    this.tags = this.add.graphics();
    content.add(this.tags);
    DECKS.forEach((d, i) => {
      content.add(tagPrice(this, ...this.tagXY(i), d.price));
      const [x, y] = this.boxXY(i);
      this.wall.addItem(x, y - LIFT, DECK_BOX.w, DECK_BOX.h + LIFT, () => this.pick(i));
    });
  }

  /** The box's picture over its shadow on the board, or a blank box with its code when it's missing. */
  private boxPicture(d: DeckStock): Phaser.GameObjects.GameObject[] {
    if (this.textures.exists(boxKey(d))) {
      return [
        this.add.image(SHADOW.by, SHADOW.by, boxKey(d)).setOrigin(0).setTint(PB.shadow).setTintMode(Phaser.TintModes.FILL).setAlpha(SHADOW.alpha),
        this.add.image(0, 0, boxKey(d)).setOrigin(0),
      ];
    }
    return blankPicture(this, DECK_BOX.w, DECK_BOX.h, d.code);
  }

  /** The price labels, the picked one yellow. */
  private drawTags() {
    this.tags.clear();
    DECKS.forEach((_, i) => drawTag(this.tags, ...this.tagXY(i), i === this.picked));
  }

  /** The picked deck on the board. */
  private showDeck() {
    const d = DECKS[this.picked], { rows, facts } = deckRows(d, this.lists.get(d.code), this.engine);
    this.board.show(d.name, facts, rows, d.price);
    this.drawTags();
  }

  /**
   * Arrows pick a deck (columns, then rows), Enter / Space / X buy, Esc closes a card's details or leaves; while a deck
   * opens, its keys.
   */
  private handleKey(code: string) {
    if (this.opening) return this.opening.handleKey(code);
    if (code === "Escape" && this.board.detailsOpen) return this.board.closeDetails();
    const col = this.picked % COLS;
    if (code === "ArrowLeft" && col > 0) this.pick(this.picked - 1);
    else if (code === "ArrowRight" && col < COLS - 1) this.pick(this.picked + 1);
    else if (code === "ArrowUp") this.pick(this.picked - COLS);
    else if (code === "ArrowDown") this.pick(this.picked + COLS);
    else if (code === "Enter" || code === "Space" || code === "KeyX") this.buy();
    else if (code === "Escape") this.exit();
  }

  private pick(i: number) {
    if (transitioning(this.game) || this.opening || i === this.picked || i < 0 || i >= DECKS.length) return;
    liftTo(this, this.boxes[this.picked], this.boxXY(this.picked)[1]);
    liftTo(this, this.boxes[i], this.boxXY(i)[1] - LIFT);
    this.picked = i;
    // A deck on a row out of view (picked with the arrow keys) scrolls it in.
    this.wall.show(i);
    this.showDeck();
  }

  /**
   * Opens the picked deck over the shop (free for now: no chips are spent): a passcode per copy, Fusions to the Extra
   * Deck; SAVE AS DECK there makes it a custom deck slot named `short`, while one is free.
   */
  private buy() {
    if (transitioning(this.game) || this.opening) return;
    const d = DECKS[this.picked], list = this.lists.get(d.code);
    if (!list) return this.board.setStatus("NO DECK LIST: RUN BUILD-DATA", RUNEWOOD.panel.error);
    this.board.closeDetails();
    const { main, extra, rarity } = deckCards(list, this.engine);
    this.opening = new DeckOpening(this, {
      box: this.openingBox(d), title: d.name, main, extra, rarity, engine: this.engine,
      onSave: () => {
        if (customDecks().length >= MAX_CUSTOM_DECKS) return { saved: false, message: `ALL ${MAX_CUSTOM_DECKS} DECK SLOTS ARE USED` };
        saveCustomDeck({ id: Date.now().toString(36), name: d.short, main, extra });
        return { saved: true, message: `SAVED AS ${d.short}` };
      },
      onClose: () => { this.opening = null; },
    });
  }

  /** The box to open: at its full size, else the pegboard's at 2x; null without either picture. */
  private openingBox(d: DeckStock): { key: string; scale: number } | null {
    if (this.textures.exists(largeKey(d))) return { key: largeKey(d), scale: 1 };
    if (this.textures.exists(boxKey(d))) return { key: boxKey(d), scale: 2 };
    return null;
  }

  private exit() {
    if (!transitioning(this.game) && !this.opening) void transitionTo(this, "Overworld");
  }
}
