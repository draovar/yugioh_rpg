// The starter deck choice (`?starter` for now; later the start of the game): the first four starter decks
// (STARTER_DECKS in decks.ts: Yugi, Kaiba, Joey, Pegasus; flat blister packs) stand in a glass display case on a
// wooden cabinet, in the shops' room (shopParts.ts), each on a clear stand under a brass spotlight, its name on a brass
// plaque on the cabinet. Clicking (tapping) a pack or its plaque, or the arrow keys, picks it: its spotlight comes on and
// its plaque turns yellow, the others dim. On the right the deck shop's board (ShopBoard.ts): the deck list, no price
// ("PICK YOUR FIRST DECK"), CHOOSE (Enter / Space / X): the pack opens over the case (DeckOpening.ts); BACK (Esc) puts
// it away, TAKE THIS DECK saves it as a custom deck slot, makes it the deck you duel with and goes on to the overworld.
// No chips and no EXIT: a deck has to be taken.
// Pictures: public/deck-boxes/<CODE>.png (`npm run build-deck-boxes`: the packs cropped flat, 78x116 with the outline).
import Phaser from "phaser";
import { loadEngine, type Engine } from "../duel/engine/loadEngine.ts";
import { MAX_CUSTOM_DECKS, customDeckKey, customDecks, saveCustomDeck, setChosenDeck } from "../ui/prefs.ts";
import { text } from "../ui/pixel.ts";
import { transitionTo, transitioning } from "../ui/Transition.ts";
import { setViewMode } from "../ui/view.ts";
import { DeckOpening } from "./DeckOpening.ts";
import { STARTER_DECKS, deckCards, deckLists, deckRows, preloadDeckLists, type DeckList, type DeckStock } from "./decks.ts";
import { ShopBoard } from "./ShopBoard.ts";
import { C, CASE, RUNEWOOD, blankPicture, drawRoom, preloadShopButtons, woodBlock } from "./shopParts.ts";

/** A pack's picture at 1x, outline included (build-deck-boxes fits a flat pack to the boxes' width). */
const PACK = { w: 78, h: 116 };
/**
 * The display case, in the shops' fixture place (CASE), top to bottom: the cornice (sticking out `overhang` px either
 * side), the glass front between two wood posts (inside it the navy back and, from `floorY`, the velvet floor), the
 * rail, the cabinet (one wide recessed panel from `panelY`, `panelInset` px in from its sides and bottom) with the
 * plaques at `plaqueY`. The packs stand on the floor with their bottoms at `packBottom`.
 */
const VIT = {
  corniceH: 7, overhang: 2, post: 6, floorY: 222, packBottom: 240, railY: 250, railH: 7, plaqueY: 263, panelY: 280,
  panelInset: 5, panelBottom: 8,
};
const GLASS_TOP = CASE.y + VIT.corniceH, BOTTOM = CASE.y + CASE.h;
const INSIDE = { x: CASE.x + VIT.post, w: CASE.w - 2 * VIT.post };
/** The packs in a row, GAP apart, centred in the case. */
const GAP = Math.floor((INSIDE.w - STARTER_DECKS.length * PACK.w) / (STARTER_DECKS.length + 1));
const ROW_X = INSIDE.x + Math.floor((INSIDE.w - STARTER_DECKS.length * PACK.w - (STARTER_DECKS.length - 1) * GAP) / 2);
const PLAQUE = { w: 48, h: 11 };
/** The case's own colours (its wood and navy back are the shops': C). */
const V = {
  velvet: 0x5a1e2a, velvetLight: 0x7a2e3a, velvetDark: 0x3e141d,
  brass: 0xd9b45a, brassLight: 0xf0d488, brassDark: 0x8a6a2a, pickedLight: 0xfff0a8, light: 0xfff4d6,
};
/** The spotlights' cone and pool of light on the velvet: the picked pack's, the others'. */
const LIT = { cone: 0.13, pool: 0.18 }, UNLIT = { cone: 0.04, pool: 0.06 };
/** The packs not picked are darkened this much. */
const DIM = 0.25;
/** A pack's shadow on the back: a black copy this far down-right, this opaque (like the deck shop's boxes). */
const SHADOW = { by: 2, alpha: 0.3 };
/** Light streaks on the glass: x at the rail, width, alpha; each leans SLANT px right up to the top. */
const STREAKS: [number, number, number][] = [[40, 14, 0.06], [62, 5, 0.05], [230, 20, 0.05], [258, 6, 0.04]];
const SLANT = 60;

const packKey = (d: DeckStock) => `deck-box-${d.code}`;
/** The pack at its full size (public/deck-boxes/large/), for opening it. */
const largeKey = (d: DeckStock) => `deck-box-large-${d.code}`;
/** The plaque's name: the deck's without "Starter Deck: ". */
const plaqueName = (d: DeckStock) => d.name.replace(/^Starter Deck: /, "").toUpperCase();

export class StarterDecks extends Phaser.Scene {
  private engine!: Engine;
  private lists = new Map<string, DeckList>();
  private picked = 0;
  /** The spotlights' cones and pools, the plaques, the dark veils over the packs not picked: drawn again on a pick. */
  private spots!: Phaser.GameObjects.Graphics;
  private plaques!: Phaser.GameObjects.Graphics;
  private dims: Phaser.GameObjects.Rectangle[] = [];
  private board!: ShopBoard;
  /** A deck being opened over the case; the case ignores input meanwhile. */
  private opening: DeckOpening | null = null;

  constructor() {
    super("StarterDecks");
  }

  init() {
    this.picked = 0;
    this.dims = [];
    this.opening = null;
  }

  preload() {
    preloadDeckLists(this);
    ShopBoard.preload(this);
    preloadShopButtons(this);
    for (const d of STARTER_DECKS) {
      if (!this.textures.exists(packKey(d))) this.load.image(packKey(d), `deck-boxes/${d.code}.png`);
      if (!this.textures.exists(largeKey(d))) this.load.image(largeKey(d), `deck-boxes/large/${d.code}.png`);
    }
  }

  async create() {
    setViewMode(this.game, "fixed");
    this.engine = await loadEngine();
    this.lists = deckLists(this);

    drawRoom(this, "STARTER DECKS", (g) => this.drawCase(g));
    this.spots = this.add.graphics();
    STARTER_DECKS.forEach((d, i) => this.drawPack(d, i));
    this.drawGlass();
    this.plaques = this.add.graphics();
    STARTER_DECKS.forEach((d, i) => {
      text(this, this.packX(i) + PACK.w / 2, VIT.plaqueY + 3, plaqueName(d), { color: C.ink, originX: 0.5 });
      // The pack and its plaque take the click.
      const top = VIT.packBottom - PACK.h;
      this.add.zone(this.packX(i), top, PACK.w, VIT.plaqueY + PLAQUE.h - top).setOrigin(0)
        .setInteractive({ useHandCursor: true }).on("pointerup", () => this.pick(i));
    });
    this.board = new ShopBoard(this, this.engine, {
      maxQuantity: 1, busy: () => !!this.opening, onBuy: () => this.choose(), rows: "cards",
      buyLabel: "CHOOSE", note: "PICK YOUR FIRST DECK",
    });

    this.input.keyboard?.on("keydown", (e: KeyboardEvent) => this.handleKey(e.code));
    this.showDeck();
  }

  private packX(i: number) {
    return ROW_X + i * (PACK.w + GAP);
  }

  /** The case's still parts (baked with the room): back, velvet floor, wood, the spotlights' lamps, the panel. */
  private drawCase(g: Phaser.GameObjects.Graphics) {
    const glassH = VIT.railY - GLASS_TOP, wide = CASE.w + 2 * VIT.overhang;
    g.fillStyle(C.back).fillRect(INSIDE.x, GLASS_TOP, INSIDE.w, glassH);
    g.fillStyle(C.backShadow).fillRect(INSIDE.x, GLASS_TOP, INSIDE.w, 3);
    // The velvet: darker at the back, a light front edge.
    g.fillStyle(V.velvetDark).fillRect(INSIDE.x, VIT.floorY, INSIDE.w, 2);
    g.fillStyle(V.velvet).fillRect(INSIDE.x, VIT.floorY + 2, INSIDE.w, VIT.railY - VIT.floorY - 2);
    g.fillStyle(V.velvetLight).fillRect(INSIDE.x, VIT.railY - 3, INSIDE.w, 1);

    woodBlock(g, CASE.x - VIT.overhang, CASE.y, wide, VIT.corniceH);
    woodBlock(g, CASE.x, GLASS_TOP, VIT.post, glassH);
    woodBlock(g, CASE.x + CASE.w - VIT.post, GLASS_TOP, VIT.post, glassH);
    woodBlock(g, CASE.x - VIT.overhang, VIT.railY, wide, VIT.railH);
    woodBlock(g, CASE.x, VIT.railY + VIT.railH, CASE.w, BOTTOM - VIT.railY - VIT.railH);

    // The panel, set in: dark along its top and left, light along its bottom and right.
    const px = CASE.x + VIT.panelInset, pw = CASE.w - 2 * VIT.panelInset, py = VIT.panelY, ph = BOTTOM - py - VIT.panelBottom;
    g.fillStyle(C.woodDark).fillRect(px, py, pw, ph);
    g.fillStyle(C.wood).fillRect(px + 1, py + 1, pw - 2, ph - 2);
    g.fillStyle(C.woodDark).fillRect(px + 1, py + 1, pw - 2, 1).fillRect(px + 1, py + 1, 1, ph - 2);
    g.fillStyle(C.woodLight).fillRect(px + 1, py + ph - 1, pw - 1, 1).fillRect(px + pw - 1, py + 1, 1, ph - 1);

    STARTER_DECKS.forEach((_, i) => {
      const cx = this.packX(i) + PACK.w / 2;
      g.fillStyle(V.brassDark).fillRect(cx - 6, GLASS_TOP, 12, 4);
      g.fillStyle(V.brass).fillRect(cx - 5, GLASS_TOP, 10, 3);
    });
  }

  /** A pack standing on the velvet: its shadow on the back, the picture (or a blank with its code), a dark veil. */
  private drawPack(d: DeckStock, i: number) {
    const x = this.packX(i), y = VIT.packBottom - PACK.h;
    if (this.textures.exists(packKey(d))) {
      this.add.image(x + SHADOW.by, y + SHADOW.by, packKey(d)).setOrigin(0)
        .setTint(0x000000).setTintMode(Phaser.TintModes.FILL).setAlpha(SHADOW.alpha);
      this.add.image(x, y, packKey(d)).setOrigin(0);
    } else this.add.container(x, y, blankPicture(this, PACK.w, PACK.h, d.code));
    this.dims.push(this.add.rectangle(x, y, PACK.w, PACK.h, 0x000000, DIM).setOrigin(0));
  }

  /** In front of the packs: each one's clear stand (a lip along its bottom), light streaks on the glass. */
  private drawGlass() {
    const g = this.add.graphics(), P = Phaser.Math.Vector2;
    STARTER_DECKS.forEach((_, i) => {
      const x = this.packX(i) - 2, w = PACK.w + 4;
      g.fillStyle(C.glass, 0.35).fillRect(x, VIT.packBottom - 4, w, 1);
      g.fillStyle(C.glass, 0.15).fillRect(x, VIT.packBottom - 3, w, 4);
    });
    for (const [x, w, alpha] of STREAKS) {
      g.fillStyle(C.glass, alpha).fillPoints(
        [new P(x, VIT.railY), new P(x + w, VIT.railY), new P(x + w + SLANT, GLASS_TOP), new P(x + SLANT, GLASS_TOP)], true);
    }
    g.fillStyle(C.glass, 0.25).fillRect(INSIDE.x, GLASS_TOP, INSIDE.w, 1);
  }

  /** The spotlights (the picked pack's on), the plaques (the picked one yellow), the veils (all but the picked pack). */
  private drawPicked() {
    this.spots.clear();
    this.plaques.clear();
    STARTER_DECKS.forEach((_, i) => {
      const x = this.packX(i), cx = x + PACK.w / 2, on = i === this.picked, lit = on ? LIT : UNLIT;
      const P = Phaser.Math.Vector2, bottom = VIT.packBottom + 4;
      this.spots.fillStyle(V.light, lit.cone)
        .fillPoints([new P(cx - 5, GLASS_TOP + 4), new P(cx + 5, GLASS_TOP + 4), new P(x + PACK.w + 8, bottom), new P(x - 8, bottom)], true);
      this.spots.fillStyle(V.light, lit.pool).fillEllipse(cx, bottom - 1, PACK.w + 20, 10);

      const px = cx - PLAQUE.w / 2;
      this.plaques.fillStyle(C.woodEdge).fillRect(px, VIT.plaqueY, PLAQUE.w, PLAQUE.h);
      this.plaques.fillStyle(on ? C.tagPicked : V.brass).fillRect(px + 1, VIT.plaqueY + 1, PLAQUE.w - 2, PLAQUE.h - 2);
      this.plaques.fillStyle(on ? V.pickedLight : V.brassLight).fillRect(px + 1, VIT.plaqueY + 1, PLAQUE.w - 2, 1);
      this.dims[i].setVisible(!on);
    });
  }

  /** The picked deck on the board, and in the case. */
  private showDeck() {
    const d = STARTER_DECKS[this.picked], { rows, facts } = deckRows(d, this.lists.get(d.code), this.engine);
    this.board.show(d.name, facts, rows, d.price);
    this.drawPicked();
  }

  /** Left / Right pick a deck, Enter / Space / X choose it, Esc closes a card's details; while a deck opens, its keys. */
  private handleKey(code: string) {
    if (this.opening) return this.opening.handleKey(code);
    if (code === "Escape" && this.board.detailsOpen) return this.board.closeDetails();
    if (code === "ArrowLeft") this.pick(this.picked - 1);
    else if (code === "ArrowRight") this.pick(this.picked + 1);
    else if (code === "Enter" || code === "Space" || code === "KeyX") this.choose();
  }

  private pick(i: number) {
    if (transitioning(this.game) || this.opening || i === this.picked || i < 0 || i >= STARTER_DECKS.length) return;
    this.picked = i;
    this.showDeck();
  }

  /** Opens the picked deck over the case; TAKE THIS DECK there takes it (BACK puts it away). */
  private choose() {
    if (transitioning(this.game) || this.opening) return;
    const d = STARTER_DECKS[this.picked], list = this.lists.get(d.code);
    if (!list) return this.board.setStatus("NO DECK LIST: RUN BUILD-DATA", RUNEWOOD.panel.error);
    this.board.closeDetails();
    const { main, extra, rarity } = deckCards(list, this.engine);
    this.opening = new DeckOpening(this, {
      box: this.openingBox(d), title: d.name, main, extra, rarity, engine: this.engine, take: "TAKE THIS DECK",
      onSave: () => this.take(d, main, extra),
      onClose: () => { this.opening = null; },
    });
  }

  /** Takes the deck: a custom deck slot named `short` (while one is free), the deck you duel with; then on to the overworld. */
  private take(d: DeckStock, main: number[], extra: number[]): { saved: boolean; message: string } {
    if (customDecks().length >= MAX_CUSTOM_DECKS) return { saved: false, message: `ALL ${MAX_CUSTOM_DECKS} DECK SLOTS ARE USED` };
    const id = Date.now().toString(36);
    saveCustomDeck({ id, name: d.short, main, extra });
    setChosenDeck(customDeckKey(id));
    void transitionTo(this, "Overworld");
    return { saved: true, message: `${d.short} IS YOUR DECK` };
  }

  /** The pack to open: at its full size, else the case's at 2x; null without either picture. */
  private openingBox(d: DeckStock): { key: string; scale: number } | null {
    if (this.textures.exists(largeKey(d))) return { key: largeKey(d), scale: 1 };
    if (this.textures.exists(packKey(d))) return { key: packKey(d), scale: 2 };
    return null;
  }
}
