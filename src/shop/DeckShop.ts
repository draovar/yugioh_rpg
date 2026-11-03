// The deck shop (a "deckshop" spot in the overworld, or `?deckshop`): the starter and structure decks (decks.ts) hang
// on a pegboard on the panelled wall, each on a peg through its box's hanger hole, a price label under it, four
// to a row, two rows in view; with more, the rows scroll a row at a time (wheel, swipe, the arrow tabs on the frame, or
// the arrow keys picking a deck out of view; shopParts.ts ScrollingFixture). Clicking (tapping) a box, or the arrow
// keys, picks it: it lifts a little on its peg. On the right Runewood's board (ShopBoard.ts): the picked deck's name,
// kind and release, the price, how many (- / +) and BUY. Not built yet: the deck lists on the board and buying.
// The room, buttons and scrolling are shared with the card shop (shopParts.ts).
// Box pictures: public/deck-boxes/<CODE>.png (`npm run build-deck-boxes`: pixel art at half the cut-outs' size, with an
// outline); a missing one shows as a blank box with its code.
import Phaser from "phaser";
import { loadEngine, type Engine } from "../duel/engine/loadEngine.ts";
import { text } from "../ui/pixel.ts";
import { transitionTo, transitioning } from "../ui/Transition.ts";
import { setViewMode } from "../ui/view.ts";
import { DECKS, type DeckStock } from "./decks.ts";
import type { ShopData } from "./Shop.ts";
import { ShopBoard } from "./ShopBoard.ts";
import { BUTTON_H, C, CASE, DRAG_PX, IN, MONTHS, ScrollingFixture, drawRoom, preloadShopButtons, shopButton } from "./shopParts.ts";

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
const LIFT = 3, LIFT_MS = 80;
const TAG = { w: 24, h: 9 };
/** Decks bought at once, at most. */
const MAX_DECKS = 3;
/** The pegboard (brown hardboard, its holes with a light lower lip), the pegs' metal, the boxes' shadows. */
const PB = {
  board: 0xa8835a, boardShadow: 0x8f6e4a, hole: 0x4e3622, holeLip: 0xc29a6e, shadow: 0x000000,
  peg: { o: 0x1a1410, l: 0xeceef2, m: 0xc8ccd2, d: 0x80848c } as Record<string, number>,
};
/** A box's shadow on the board: a black copy this far down-right, this opaque. */
const SHADOW = { by: 2, alpha: 0.3 };

const boxKey = (d: DeckStock) => `deck-box-${d.code}`;

export class DeckShop extends Phaser.Scene {
  private engine!: Engine;
  private chips = 0;
  private picked = 0;
  private boxes: Phaser.GameObjects.Container[] = [];
  private tags!: Phaser.GameObjects.Graphics;
  /** The pegboard's rows: everything on them, scrolling a row at a time. */
  private wall!: ScrollingFixture;
  private board!: ShopBoard;

  constructor() {
    super("DeckShop");
  }

  init(data: ShopData) {
    this.chips = data.chips ?? 0;
    this.picked = 0;
    this.boxes = [];
  }

  preload() {
    ShopBoard.preload(this);
    preloadShopButtons(this);
    for (const d of DECKS) if (!this.textures.exists(boxKey(d))) this.load.image(boxKey(d), `deck-boxes/${d.code}.png`);
  }

  async create() {
    setViewMode(this.game, "fixed");
    this.engine = await loadEngine();

    // The pegboard's hardboard, a shadow under the frame's top; its holes scroll with the rows.
    drawRoom(this, "DECK SHOP", (g) => {
      g.fillStyle(PB.board).fillRect(IN.x, IN.y, IN.w, IN.h);
      g.fillStyle(PB.boardShadow).fillRect(IN.x, IN.y, IN.w, 3);
    });
    this.drawWall();
    this.wall.makeCues();
    this.board = new ShopBoard(this, this.engine, { maxQuantity: MAX_DECKS, busy: () => false, onBuy: () => this.buy() });

    text(this, 10, 12, `CHIPS: ${this.chips}`, { color: C.light });
    shopButton(this, CASE.x + CASE.w - 40, 15 - Math.floor(BUTTON_H / 2), 40, "EXIT", "dark", () => this.exit());

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

  /**
   * The pegboard and everything on it: the holes (all rows), per deck the box with its shadow on the board (the board
   * shows through its hanger hole), its peg in front (out of a hole, through the box's hole), the price label under it,
   * a hit zone (covering the lifted box too).
   */
  private drawWall() {
    this.wall = new ScrollingFixture(this, { count: DECKS.length, perLine: COLS, lineSize: ROW_H, axis: "y", busy: () => false });
    const content = this.wall.content;

    const g = this.add.graphics();
    for (let y = HOLE_Y; y < IN.y + this.wall.lines * ROW_H; y += HOLE) {
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
      const [x, y] = this.boxXY(i), { rowTop } = this.cell(i);
      content.add(text(this, x + DECK_BOX.w / 2, rowTop + TAG_Y + 2, String(d.price), { color: C.ink, originX: 0.5 }));
      const hit = this.add.zone(x, y - LIFT, DECK_BOX.w, DECK_BOX.h + LIFT).setOrigin(0).setInteractive({ useHandCursor: true });
      // A press that drags (a swipe) scrolls instead.
      hit.on("pointerup", (p: Phaser.Input.Pointer) => { if (Math.abs(p.y - p.downY) <= DRAG_PX) this.pick(i); });
      this.wall.addZone(hit);
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
    const g = this.add.graphics().fillStyle(0x8a8a8a).fillRect(0, 0, DECK_BOX.w, DECK_BOX.h).fillStyle(0x6a6a6a).fillRect(3, 3, DECK_BOX.w - 6, DECK_BOX.h - 6);
    return [g, text(this, DECK_BOX.w / 2, DECK_BOX.h / 2 - 2, d.code, { color: 0xffffff, originX: 0.5 })];
  }

  /** The price labels, the picked one yellow. */
  private drawTags() {
    this.tags.clear();
    DECKS.forEach((_, i) => {
      const [x] = this.boxXY(i), { rowTop } = this.cell(i), tx = x + DECK_BOX.w / 2 - TAG.w / 2, ty = rowTop + TAG_Y;
      this.tags.fillStyle(C.woodEdge).fillRect(tx, ty, TAG.w, TAG.h);
      this.tags.fillStyle(i === this.picked ? C.tagPicked : C.tag).fillRect(tx + 1, ty + 1, TAG.w - 2, TAG.h - 2);
    });
  }

  /** The picked deck on the board. */
  private showDeck() {
    const d = DECKS[this.picked], [year, month] = d.released.split("-").map(Number);
    const facts = `${d.kind === "starter" ? "STARTER DECK" : "STRUCTURE DECK"}  -  ${MONTHS[month - 1]} ${year}`;
    this.board.show(d.name, facts, [], d.price);
    this.drawTags();
  }

  /** Arrows pick a deck (columns, then rows), - / + set how many, Enter / Space / X buy, Esc closes a card's details or leaves. */
  private handleKey(code: string) {
    if (code === "Escape" && this.board.detailsOpen) return this.board.closeDetails();
    const col = this.picked % COLS;
    if (code === "ArrowLeft" && col > 0) this.pick(this.picked - 1);
    else if (code === "ArrowRight" && col < COLS - 1) this.pick(this.picked + 1);
    else if (code === "ArrowUp") this.pick(this.picked - COLS);
    else if (code === "ArrowDown") this.pick(this.picked + COLS);
    else if (code === "Minus" || code === "NumpadSubtract") this.board.setQuantity(this.board.quantity - 1);
    else if (code === "Equal" || code === "NumpadAdd") this.board.setQuantity(this.board.quantity + 1);
    else if (code === "Enter" || code === "Space" || code === "KeyX") this.buy();
    else if (code === "Escape") this.exit();
  }

  private pick(i: number) {
    if (transitioning(this.game) || i === this.picked || i < 0 || i >= DECKS.length) return;
    const lift = (i: number, up: boolean) => {
      const box = this.boxes[i];
      this.tweens.killTweensOf(box);
      this.tweens.add({ targets: box, y: this.boxXY(i)[1] - (up ? LIFT : 0), duration: LIFT_MS, ease: "Linear" });
    };
    lift(this.picked, false);
    lift(i, true);
    this.picked = i;
    // A deck on a row out of view (picked with the arrow keys) scrolls it in.
    this.wall.show(i);
    this.showDeck();
  }

  /** Not yet: the deck lists and opening a bought deck come next. */
  private buy() {
    if (!transitioning(this.game)) this.board.setStatus("NOT FOR SALE YET");
  }

  private exit() {
    if (!transitioning(this.game)) void transitionTo(this, "Overworld");
  }
}
