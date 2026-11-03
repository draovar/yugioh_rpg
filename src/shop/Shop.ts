// The card shop (a "shop" spot in the overworld, or `?shop`), drawn like a real shop: on the left a glass display case
// on a panelled wall, shelves of three booster displays (a set's box: lid standing up behind, packs inside, the set
// code on the front lip, a price label on the shelf edge), two shelves in view; with more, the shelves scroll smoothly
// a row at a time (wheel, swipe, the bobbing arrow tabs on the case's frame, or the arrow keys picking a pack out of
// view; shopParts.ts ScrollingFixture).
// Clicking (tapping) a pack, or the arrow keys, picks it: its front pack lifts out of the box. On the right the checklist
// on Runewood's info board (ShopBoard.ts): the picked set's name, release, size, every card it drops with its rarity,
// the price, how many packs (- / +) and BUY: the packs open one after another (PackOpening.ts). The card collection
// isn't built yet: packs are free for now (no chips spent) and the pulled cards aren't kept.
// The room, buttons and scroll cues are shared with the deck shop (shopParts.ts).
// Pack pictures: public/boosters/<SET>.png and large/<SET>.png (`npm run build-boosters`); a missing one shows as a
// blank pack with its code (and is dealt from without tearing). Card lists: public/data/boosters.json (`npm run build-data`).
import Phaser from "phaser";
import { loadEngine, type Engine } from "../duel/engine/loadEngine.ts";
import { text } from "../ui/pixel.ts";
import { transitionTo, transitioning } from "../ui/Transition.ts";
import { setViewMode } from "../ui/view.ts";
import { BOOSTERS, CARDS_PER_PACK, RARITIES, pullPack, rarityLook, type BoosterList, type BoosterStock } from "./boosters.ts";
import { PackOpening } from "./PackOpening.ts";
import { ShopBoard } from "./ShopBoard.ts";
import { BUTTON_H, C, CASE, DRAG_PX, IN, MONTHS, RUNEWOOD, ScrollingFixture, drawRoom, preloadShopButtons, shade, shopButton } from "./shopParts.ts";
import { rarityPack } from "../dev/rarityPack.ts";

/** What the overworld hands over. */
export interface ShopData {
  chips?: number;
}

/** Pack pictures are drawn at 1x (tools/art/build-boosters.mjs makes them this size). */
const PACK = { w: 64, h: 110 };
/** The display case's two shelves, three displays each. */
const COLS = 3, ROW_H = IN.h / 2;
/** A row's shelf top, from the row's top; the shelf's light top face and front edge (with the price labels). */
const SHELF_TOP = ROW_H - 20, SHELF_FACE = 3, SHELF_FRONT = 10;
/** A display box: its lid stands LID_ABOVE px over the packs behind the front one; the front lip hides the packs' feet. */
const BOX_W = 92, LIP_H = 16, LID_ABOVE = 8;
/** Packs behind the front one, each this much higher, darker. */
const BEHIND = [{ dy: -8, tint: 0x6a6a6a }, { dy: -4, tint: 0x9a9a9a }];
const LIFT = 8, LIFT_MS = 80;
const TAG = { w: 24, h: 9 };
/** Packs bought at once, at most. */
const MAX_PACKS = 10;
const LISTS_KEY = "boosters";

const packKey = (b: BoosterStock) => `booster-${b.code}`;
const largeKey = (b: BoosterStock) => `booster-large-${b.code}`;

export class Shop extends Phaser.Scene {
  private engine!: Engine;
  private lists = new Map<string, BoosterList>();
  private chips = 0;
  private picked = 0;
  private packs: Phaser.GameObjects.Container[] = [];
  private tags!: Phaser.GameObjects.Graphics;
  /** The shelves: everything on them, scrolling a row at a time. */
  private shelves!: ScrollingFixture;
  private board!: ShopBoard;
  /** A pack being opened over the shop; the shop ignores input meanwhile. */
  private opening: PackOpening | null = null;

  constructor() {
    super("Shop");
  }

  init(data: ShopData) {
    this.chips = data.chips ?? 0;
    this.picked = 0;
    this.packs = [];
    this.opening = null;
  }

  preload() {
    if (!this.cache.json.exists(LISTS_KEY)) this.load.json(LISTS_KEY, "data/boosters.json");
    ShopBoard.preload(this);
    preloadShopButtons(this);
    for (const b of BOOSTERS) {
      if (!this.textures.exists(packKey(b))) this.load.image(packKey(b), `boosters/${b.code}.png`);
      if (!this.textures.exists(largeKey(b))) this.load.image(largeKey(b), `boosters/large/${b.code}.png`);
    }
  }

  async create() {
    setViewMode(this.game, "fixed");
    this.engine = await loadEngine();
    this.lists = new Map(((this.cache.json.get(LISTS_KEY) as BoosterList[] | undefined) ?? []).map((l) => [l.code, l]));

    // Case: the navy inside, a shadow under its top frame.
    drawRoom(this, "CARD SHOP", (g) => {
      g.fillStyle(C.back).fillRect(IN.x, IN.y, IN.w, IN.h);
      g.fillStyle(C.backShadow).fillRect(IN.x, IN.y, IN.w, 3);
    });
    this.drawShelves();
    this.drawGlass();
    this.shelves.makeCues();
    this.board = new ShopBoard(this, this.engine, { maxQuantity: MAX_PACKS, busy: () => !!this.opening, onBuy: () => this.buy() });

    text(this, 10, 12, `CHIPS: ${this.chips}`, { color: C.light });
    // EXIT like the checklist's buttons in dark brown, at the case's right edge, level with the sign.
    shopButton(this, CASE.x + CASE.w - 40, 15 - Math.floor(BUTTON_H / 2), 40, "EXIT", "dark", () => this.exit());

    this.input.keyboard?.on("keydown", (e: KeyboardEvent) => this.handleKey(e.code));

    this.packs[0].y -= LIFT;
    this.showSet();
  }

  /** Column / row of display i. */
  private cell(i: number) {
    const col = i % COLS, row = Math.floor(i / COLS);
    const cx = Math.round(IN.x + (IN.w * (2 * col + 1)) / (2 * COLS));
    return { cx, shelfTop: IN.y + row * ROW_H + SHELF_TOP };
  }

  /** Top-left of display i's front pack, resting in its box. */
  private packXY(i: number): [number, number] {
    const { cx, shelfTop } = this.cell(i);
    return [cx - PACK.w / 2, shelfTop - PACK.h];
  }

  /**
   * The shelves and everything on them: per row a shelf; per display its lid standing up behind, the packs further back
   * in the box (darker), the front pack, the lip with the set code, the price label, a hit zone (covering the lifted
   * pack too).
   */
  private drawShelves() {
    this.shelves = new ScrollingFixture(this, { count: BOOSTERS.length, perLine: COLS, lineSize: ROW_H, axis: "y", busy: () => !!this.opening });
    const content = this.shelves.content;

    const g = this.add.graphics();
    for (let row = 0; row < this.shelves.lines; row++) {
      const top = IN.y + row * ROW_H + SHELF_TOP;
      g.fillStyle(C.woodLight).fillRect(IN.x, top, IN.w, SHELF_FACE);
      g.fillStyle(C.wood).fillRect(IN.x, top + SHELF_FACE, IN.w, SHELF_FRONT);
      g.fillStyle(C.woodEdge).fillRect(IN.x, top + SHELF_FACE + SHELF_FRONT, IN.w, 1);
      g.fillStyle(C.backShadow).fillRect(IN.x, top + SHELF_FACE + SHELF_FRONT + 1, IN.w, 2);
    }
    BOOSTERS.forEach((b, i) => {
      const { cx, shelfTop } = this.cell(i);
      const top = shelfTop - PACK.h + BEHIND[0].dy - LID_ABOVE, left = cx - BOX_W / 2;
      g.fillStyle(shade(b.color, -40)).fillRect(left, top, BOX_W, shelfTop - top);
      g.fillStyle(shade(b.color, -10)).fillRect(left, top, BOX_W, 1);
      g.fillStyle(shade(b.color, -55)).fillRect(left, top + 1, 1, shelfTop - top - 1).fillRect(left + BOX_W - 1, top + 1, 1, shelfTop - top - 1);
    });
    content.add(g);

    BOOSTERS.forEach((b, i) => {
      const [x, y] = this.packXY(i);
      if (this.textures.exists(packKey(b))) {
        for (const p of BEHIND) content.add(this.add.image(x, y + p.dy, packKey(b)).setOrigin(0).setTint(p.tint));
      }
    });
    BOOSTERS.forEach((b, i) => {
      const pack = this.add.container(...this.packXY(i), this.packPicture(b));
      this.packs.push(pack);
      content.add(pack);
    });

    const lips = this.add.graphics();
    content.add(lips);
    BOOSTERS.forEach((b, i) => {
      const { cx, shelfTop } = this.cell(i), left = cx - BOX_W / 2, top = shelfTop - LIP_H;
      lips.fillStyle(shade(b.color, -45)).fillRect(left, top, BOX_W, LIP_H);
      lips.fillStyle(b.color).fillRect(left + 1, top + 1, BOX_W - 2, LIP_H - 1);
      lips.fillStyle(shade(b.color, 20)).fillRect(left + 1, top + 1, BOX_W - 2, 1);
      content.add([
        text(this, cx + 1, top + 5, b.code, { color: shade(b.color, -50), scale: 2, originX: 0.5 }),
        text(this, cx, top + 4, b.code, { color: 0xffffff, scale: 2, originX: 0.5 }),
      ]);
    });
    this.tags = this.add.graphics();
    content.add(this.tags);
    BOOSTERS.forEach((b, i) => {
      const { cx, shelfTop } = this.cell(i);
      content.add(text(this, cx, shelfTop + SHELF_FACE + 3, String(b.price), { color: C.ink, originX: 0.5 }));
      const [x, y] = this.packXY(i);
      const hit = this.add.zone(x, y - LIFT, PACK.w, PACK.h + LIFT).setOrigin(0).setInteractive({ useHandCursor: true });
      // A press that drags (a swipe) scrolls instead.
      hit.on("pointerup", (p: Phaser.Input.Pointer) => { if (Math.abs(p.y - p.downY) <= DRAG_PX) this.pick(i); });
      this.shelves.addZone(hit);
    });
  }

  /** The pack's picture, or a blank pack with its set code when the picture is missing. */
  private packPicture(b: BoosterStock): Phaser.GameObjects.GameObject[] {
    if (this.textures.exists(packKey(b))) return [this.add.image(0, 0, packKey(b)).setOrigin(0)];
    const g = this.add.graphics().fillStyle(0x8a8a8a).fillRect(0, 0, PACK.w, PACK.h).fillStyle(0x6a6a6a).fillRect(3, 3, PACK.w - 6, PACK.h - 6);
    return [g, text(this, PACK.w / 2, PACK.h / 2 - 2, b.code, { color: 0xffffff, originX: 0.5 })];
  }

  /** The price labels, the picked one yellow. */
  private drawTags() {
    this.tags.clear();
    BOOSTERS.forEach((_, i) => {
      const { cx, shelfTop } = this.cell(i), x = cx - TAG.w / 2, y = shelfTop + SHELF_FACE + 1;
      this.tags.fillStyle(C.woodEdge).fillRect(x, y, TAG.w, TAG.h);
      this.tags.fillStyle(i === this.picked ? C.tagPicked : C.tag).fillRect(x + 1, y + 1, TAG.w - 2, TAG.h - 2);
    });
  }

  /** Light streaks on the case's glass front, over everything inside. */
  private drawGlass() {
    const g = this.add.graphics().setDepth(2);
    const slant = Math.round(IN.h * 0.35), bottom = IN.y + IN.h;
    for (const [x, w, alpha] of [[IN.x + 20, 16, 0.07], [IN.x + 44, 5, 0.06], [IN.x + 200, 22, 0.05]]) {
      const V = Phaser.Math.Vector2;
      g.fillStyle(C.glass, alpha).fillPoints([new V(x, bottom), new V(x + w, bottom), new V(x + w + slant, IN.y), new V(x + slant, IN.y)], true);
    }
  }

  /** The picked set on the checklist: its cards highest rarity first. */
  private showSet() {
    const b = BOOSTERS[this.picked], list = this.lists.get(b.code);
    const order = RARITIES.map(([r]) => r);
    const rows = (list?.cards ?? [])
      .map(([number, code, rarity]) => ({ number, code, rarity, name: this.engine.cards.records.get(code)?.name ?? `#${code}` }))
      .sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity) || a.number.localeCompare(b.number))
      .map(({ code, name, rarity }) => ({ code, name, chip: rarityLook(rarity) }));
    const [year, month] = (list?.released ?? "").split("-").map(Number);
    const facts = list ? `${MONTHS[month - 1]} ${year}  -  ${list.cards.length} CARDS  -  ${CARDS_PER_PACK} PER PACK` : "";
    this.board.show(list?.name ?? b.code, facts, rows, b.price);
    this.drawTags();
  }

  // --- Picking and buying ----------------------------------------------------------------------------------------

  /**
   * Arrows pick a pack (columns, then rows), - / + set how many, Enter / Space / X buy them, Esc closes a card's
   * details or leaves; while packs open, their keys.
   */
  private handleKey(code: string) {
    if (this.opening) return this.opening.handleKey(code);
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
    if (transitioning(this.game) || this.opening || i === this.picked || i < 0 || i >= BOOSTERS.length) return;
    const lift = (i: number, up: boolean) => {
      const pack = this.packs[i];
      this.tweens.killTweensOf(pack);
      this.tweens.add({ targets: pack, y: this.packXY(i)[1] - (up ? LIFT : 0), duration: LIFT_MS, ease: "Linear" });
    };
    lift(this.picked, false);
    lift(i, true);
    this.picked = i;
    // A pack on a row out of view (picked with the arrow keys) scrolls it in.
    this.shelves.show(i);
    this.showSet();
  }

  /** Opens the packs bought, one after another (free for now: no chips are spent, the cards aren't kept). */
  private buy() {
    if (transitioning(this.game) || this.opening) return;
    const b = BOOSTERS[this.picked], list = this.lists.get(b.code);
    if (!list) return this.board.setStatus("NO CARD LIST: RUN BUILD-DATA", RUNEWOOD.panel.error);
    this.board.closeDetails();
    const key = [largeKey(b), packKey(b)].find((k) => this.textures.exists(k)) ?? null;
    // Dev: `&anims` deals one card of each rarity instead, to preview every reveal (src/dev/rarityPack.ts).
    const preview = import.meta.env.DEV && new URLSearchParams(location.search).has("anims");
    const packs = preview ? [rarityPack(list, [...this.lists.values()])] : Array.from({ length: this.board.quantity }, () => pullPack(list));
    this.opening = new PackOpening(this, {
      packKey: key, title: list.name, packs, engine: this.engine,
      onClose: () => { this.opening = null; },
    });
  }

  private exit() {
    if (!transitioning(this.game) && !this.opening) void transitionTo(this, "Overworld");
  }
}
