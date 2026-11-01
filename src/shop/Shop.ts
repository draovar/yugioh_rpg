// The card shop (a "shop" spot in the overworld, or `?shop`), drawn like a real shop: on the left a glass display case
// on a panelled wall, two shelves of three booster displays (a set's box: lid standing up behind, packs inside, the
// set code on the front lip, a price label on the shelf edge). Clicking (tapping) a pack, or the arrow keys, picks it:
// its front pack lifts out of the box. On the right the checklist on Runewood's info board: the picked set's name,
// release, size, every card it drops with its rarity (on the paper inset, scrolls; clicking a card opens its details
// over the checklist, like the deck editor's), the price, how many packs (- / +) and BUY: the packs open one after
// another (PackOpening.ts). The card collection isn't built yet: packs are free for now (no chips spent) and the pulled
// cards aren't kept.
// The shop has its own look, not the UI theme's (the owner's choice: one real-shop look); the checklist is always
// Runewood's board and paper, whatever the theme.
// Pack pictures: public/boosters/<SET>.png and large/<SET>.png (`npm run build-boosters`); a missing one shows as a
// blank pack with its code (and is dealt from without tearing). Card lists: public/data/boosters.json (`npm run build-data`).
import Phaser from "phaser";
import { loadEngine, type Engine } from "../duel/engine/loadEngine.ts";
import { CardInfo } from "../duel-screen/CardInfo.ts";
import { INFO, INSET } from "../duel-screen/layout.ts";
import { FONT_UI, INK, fit, measure, text } from "../ui/pixel.ts";
import { THEME, THEMES, ui } from "../ui/theme.ts";
import { transitionTo, transitioning } from "../ui/Transition.ts";
import { setViewMode } from "../ui/view.ts";
import { LIST_BUTTON_H, makeListButton } from "../ui/widgets.ts";
import { BOOSTERS, CARDS_PER_PACK, RARITIES, pullPack, rarityLook, type BoosterList, type BoosterStock } from "./boosters.ts";
import { PackOpening } from "./PackOpening.ts";

/** What the overworld hands over. */
export interface ShopData {
  chips?: number;
}

/** The shop's colours: dark wood panelling, a lighter wood case with a navy back, light price labels. */
const C = {
  wall: 0x3b2a20, wallSeam: 0x30221a,
  wood: 0x9c6b43, woodLight: 0xc08a5a, woodDark: 0x6e4a2e, woodEdge: 0x2a1a10,
  back: 0x1c2233, backShadow: 0x131826,
  sign: 0x2a1a10, signEdge: 0x8a6a3a, signInk: 0xf2c96b,
  ink: 0x2a1a10, tag: 0xf6f0e0, tagPicked: 0xffd75e, light: 0xf2e8d0, glass: 0xffffff,
};

/** Pack pictures are drawn at 1x (tools/art/build-boosters.mjs makes them this size). */
const PACK = { w: 64, h: 110 };
/** The display case (wood frame) and its inside; two shelves, three displays each. */
const CASE = { x: 8, y: 30, w: 400, h: 324 };
const IN = { x: CASE.x + 6, y: CASE.y + 6, w: CASE.w - 12, h: CASE.h - 12 };
const COLS = 3, ROW_H = IN.h / 2;
/** A row's shelf top, from the row's top; the shelf's light top face and front edge (with the price labels). */
const SHELF_TOP = ROW_H - 20, SHELF_FACE = 3, SHELF_FRONT = 10;
/** A display box: its lid stands LID_ABOVE px over the packs behind the front one; the front lip hides the packs' feet. */
const BOX_W = 92, LIP_H = 16, LID_ABOVE = 8;
/** Packs behind the front one, each this much higher, darker. */
const BEHIND = [{ dy: -8, tint: 0x6a6a6a }, { dy: -4, tint: 0x9a9a9a }];
const LIFT = 8, LIFT_MS = 80;
const TAG = { w: 24, h: 9 };

/**
 * The checklist on the right: Runewood's info board (the duel's info panel, the same size), its content inside the
 * board's rim: the set's name and facts, the card list on the paper inset (a scrollbar at its right edge), price, BUY.
 */
const RUNEWOOD = THEMES.runewood;
const BOARD = { x: 640 - INFO.w, w: INFO.w };
const CONTENT = { x: BOARD.x + INSET.board + 2, w: BOARD.w - 2 * (INSET.board + 2), top: INSET.board + 3, bottom: 360 - INSET.board - 2 };
/** 30 rows: the paper reaches down to just above the bottom row. */
const PAPER = { x: CONTENT.x, y: 50, w: CONTENT.w, h: 30 * 9 + 2 * INSET.paper };
const LIST = { x: PAPER.x + INSET.paper, y: PAPER.y + INSET.paper, w: PAPER.w - 2 * INSET.paper - 5, rowH: 9, rows: 30 };
const SCROLL = { x: PAPER.x + PAPER.w - INSET.paper - 3, y: LIST.y, w: 3, h: LIST.rows * LIST.rowH };
/** The scrollbar takes presses this far either side of it (it's thin). */
const SCROLL_REACH = 3;
/** Runewood's board and paper, loaded under keys of their own (the theme's `ui-*` ones may be Hologram's). */
const BOARD_KEY = "shop-info-frame", PAPER_KEY = "shop-panel-paper";
/**
 * The shop's buttons: list-row buttons like the info panel's CLOSE, always Runewood's: wood for - / +, green for BUY,
 * dark brown for EXIT (public/assets/ui/shop/, `node tools/art/import-ui.mjs shop`); each file has its hover look beside
 * it (-hover). `light`: a white label, else Runewood's list-button ink (dark, light on hover).
 */
const LIST_BUTTONS: Record<"wood" | "green" | "dark", { key: string; file: string; light?: boolean }> = {
  wood: { key: "shop-list-button", file: "assets/ui/runewood/menu-button" },
  green: { key: "shop-list-button-green", file: "assets/ui/shop/list-button-green" },
  dark: { key: "shop-list-button-dark", file: "assets/ui/shop/list-button-dark", light: true },
};
const CHIP = { w: 17, h: 7 };
/** Pointer travel that turns a press on the list into a scroll (a shorter one opens the card), as in the deck editor. */
const DRAG_PX = 6;
/** Packs bought at once, at most. */
const MAX_PACKS = 10;
/**
 * The bottom row: the price on the left; -, the count (centred between them), + and BUY on the right (x: left edges
 * and the count's centre, from the board's right edge; - / + are `step` wide). Buttons from `top`, BUTTON_H tall (2px
 * more than a list row, the label in the middle); the 2x texts' top at textY, centred on the buttons.
 */
const RIGHT = CONTENT.x + CONTENT.w;
const BUTTON_H = LIST_BUTTON_H + 2;
const BOTTOM = {
  top: CONTENT.bottom - BUTTON_H - 2, textY: CONTENT.bottom - BUTTON_H,
  buy: RIGHT - 36, buyW: 36, plus: RIGHT - 53, count: RIGHT - 60, minus: RIGHT - 79, step: 13,
};
/** A card's details over the checklist: above it, under a pack being opened. */
const DETAILS_DEPTH = 50;
const STATUS_MS = 2000;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const LISTS_KEY = "boosters";

const packKey = (b: BoosterStock) => `booster-${b.code}`;
const largeKey = (b: BoosterStock) => `booster-large-${b.code}`;
const shade = (color: number, by: number) => {
  const c = Phaser.Display.Color.ValueToColor(color);
  return (by < 0 ? c.darken(-by) : c.lighten(by)).color;
};

export class Shop extends Phaser.Scene {
  private engine!: Engine;
  private lists = new Map<string, BoosterList>();
  private chips = 0;
  private picked = 0;
  private packs: Phaser.GameObjects.Container[] = [];
  private tags!: Phaser.GameObjects.Graphics;
  private nameText!: Phaser.GameObjects.BitmapText;
  private nameShadow!: Phaser.GameObjects.BitmapText;
  private factsText!: Phaser.GameObjects.BitmapText;
  private priceText!: Phaser.GameObjects.BitmapText;
  private priceShadow!: Phaser.GameObjects.BitmapText;
  /** Packs to buy at once (- / +), and its count between them. */
  private quantity = 1;
  private countText!: Phaser.GameObjects.BitmapText;
  private statusText!: Phaser.GameObjects.BitmapText;
  private statusTimer: Phaser.Time.TimerEvent | null = null;
  /** A pack being opened over the shop; the shop ignores input meanwhile. */
  private opening: PackOpening | null = null;
  /** The picked set's cards, highest rarity first. */
  private rows: { code: number; name: string; rarity: string }[] = [];
  private scrollRow = 0;
  /** The list row under the pointer (an index into `rows`), -1 for none; its highlight. */
  private hovered = -1;
  private hoverBand!: Phaser.GameObjects.Graphics;
  /** A listed card's details over the checklist (hidden until a card is clicked). */
  private details!: { root: Phaser.GameObjects.Container; info: CardInfo };
  private chipBoxes!: Phaser.GameObjects.Graphics;
  private chipTexts: Phaser.GameObjects.BitmapText[] = [];
  private nameTexts: Phaser.GameObjects.BitmapText[] = [];
  private scrollbar!: Phaser.GameObjects.Graphics;

  constructor() {
    super("Shop");
  }

  init(data: ShopData) {
    this.chips = data.chips ?? 0;
    this.picked = 0;
    this.packs = [];
    this.chipTexts = [];
    this.nameTexts = [];
    this.scrollRow = 0;
    this.hovered = -1;
    this.quantity = 1;
    this.statusTimer = null;
    this.opening = null;
  }

  preload() {
    if (!this.cache.json.exists(LISTS_KEY)) this.load.json(LISTS_KEY, "data/boosters.json");
    if (!this.textures.exists(BOARD_KEY)) this.load.image(BOARD_KEY, "assets/ui/runewood/info-frame.png");
    if (!this.textures.exists(PAPER_KEY)) this.load.image(PAPER_KEY, "assets/ui/runewood/panel-paper.png");
    for (const { key, file } of Object.values(LIST_BUTTONS)) {
      if (!this.textures.exists(key)) this.load.image(key, `${file}.png`);
      if (!this.textures.exists(`${key}-hover`)) this.load.image(`${key}-hover`, `${file}-hover.png`);
    }
    for (const b of BOOSTERS) {
      if (!this.textures.exists(packKey(b))) this.load.image(packKey(b), `boosters/${b.code}.png`);
      if (!this.textures.exists(largeKey(b))) this.load.image(largeKey(b), `boosters/large/${b.code}.png`);
    }
  }

  async create() {
    setViewMode(this.game, "fixed");
    this.engine = await loadEngine();
    this.lists = new Map(((this.cache.json.get(LISTS_KEY) as BoosterList[] | undefined) ?? []).map((l) => [l.code, l]));

    this.drawRoom();
    BOOSTERS.forEach((b, i) => this.packs.push(this.add.container(...this.packXY(i), this.packPicture(b))));
    this.drawFronts();
    this.drawGlass();
    this.drawChecklist();

    text(this, 10, 12, `CHIPS: ${this.chips}`, { color: C.light });
    // EXIT like the checklist's buttons in dark brown, at the case's right edge, level with the sign.
    this.button(CASE.x + CASE.w - 40, 15 - Math.floor(BUTTON_H / 2), 40, "EXIT", "dark", () => this.exit());

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

  // --- The room: wall, sign, display case, shelves, box lids (baked: none of it changes) -------------------------

  private drawRoom() {
    const g = this.make.graphics({}, false);
    g.fillStyle(C.wall).fillRect(0, 0, 640, 360);
    g.fillStyle(C.wallSeam);
    for (let x = 12; x < 640; x += 24) g.fillRect(x, 0, 1, 360);

    // The sign over the case.
    const signW = 84, signX = CASE.x + CASE.w / 2 - signW / 2;
    g.fillStyle(C.signEdge).fillRect(signX, 5, signW, 20).fillStyle(C.sign).fillRect(signX + 1, 6, signW - 2, 18);

    // Case: wood frame with a light top/left edge and a dark bottom/right one, the navy inside.
    g.fillStyle(C.woodEdge).fillRect(CASE.x, CASE.y, CASE.w, CASE.h);
    g.fillStyle(C.wood).fillRect(CASE.x + 1, CASE.y + 1, CASE.w - 2, CASE.h - 2);
    g.fillStyle(C.woodLight).fillRect(CASE.x + 1, CASE.y + 1, CASE.w - 2, 1).fillRect(CASE.x + 1, CASE.y + 1, 1, CASE.h - 2);
    g.fillStyle(C.woodDark).fillRect(CASE.x + 1, CASE.y + CASE.h - 2, CASE.w - 2, 1).fillRect(CASE.x + CASE.w - 2, CASE.y + 1, 1, CASE.h - 2);
    g.fillStyle(C.woodEdge).fillRect(IN.x - 1, IN.y - 1, IN.w + 2, IN.h + 2);
    g.fillStyle(C.back).fillRect(IN.x, IN.y, IN.w, IN.h);
    g.fillStyle(C.backShadow).fillRect(IN.x, IN.y, IN.w, 3);

    for (let row = 0; row < 2; row++) {
      const top = IN.y + row * ROW_H + SHELF_TOP;
      g.fillStyle(C.woodLight).fillRect(IN.x, top, IN.w, SHELF_FACE);
      g.fillStyle(C.wood).fillRect(IN.x, top + SHELF_FACE, IN.w, SHELF_FRONT);
      g.fillStyle(C.woodEdge).fillRect(IN.x, top + SHELF_FACE + SHELF_FRONT, IN.w, 1);
      g.fillStyle(C.backShadow).fillRect(IN.x, top + SHELF_FACE + SHELF_FRONT + 1, IN.w, 2);
    }

    // Box lids standing up behind the packs, and the packs further back in each box (darker).
    BOOSTERS.forEach((b, i) => {
      const { cx, shelfTop } = this.cell(i);
      const top = shelfTop - PACK.h + BEHIND[0].dy - LID_ABOVE, left = cx - BOX_W / 2;
      g.fillStyle(shade(b.color, -40)).fillRect(left, top, BOX_W, shelfTop - top);
      g.fillStyle(shade(b.color, -10)).fillRect(left, top, BOX_W, 1);
      g.fillStyle(shade(b.color, -55)).fillRect(left, top + 1, 1, shelfTop - top - 1).fillRect(left + BOX_W - 1, top + 1, 1, shelfTop - top - 1);
    });
    const baked = this.add.renderTexture(0, 0, 640, 360).setOrigin(0);
    baked.draw(g).render();
    g.destroy();

    text(this, CASE.x + CASE.w / 2, 10, "CARD SHOP", { color: C.signInk, scale: 2, originX: 0.5 });
    BOOSTERS.forEach((b, i) => {
      const [x, y] = this.packXY(i);
      if (!this.textures.exists(packKey(b))) return;
      for (const p of BEHIND) this.add.image(x, y + p.dy, packKey(b)).setOrigin(0).setTint(p.tint);
    });
  }

  /** The pack's picture, or a blank pack with its set code when the picture is missing. */
  private packPicture(b: BoosterStock): Phaser.GameObjects.GameObject[] {
    if (this.textures.exists(packKey(b))) return [this.add.image(0, 0, packKey(b)).setOrigin(0)];
    const g = this.add.graphics().fillStyle(0x8a8a8a).fillRect(0, 0, PACK.w, PACK.h).fillStyle(0x6a6a6a).fillRect(3, 3, PACK.w - 6, PACK.h - 6);
    return [g, text(this, PACK.w / 2, PACK.h / 2 - 2, b.code, { color: 0xffffff, originX: 0.5 })];
  }

  /** In front of the packs: each box's lip with the set code, the price labels on the shelf edge, the hit zones. */
  private drawFronts() {
    const g = this.add.graphics();
    BOOSTERS.forEach((b, i) => {
      const { cx, shelfTop } = this.cell(i), left = cx - BOX_W / 2, top = shelfTop - LIP_H;
      g.fillStyle(shade(b.color, -45)).fillRect(left, top, BOX_W, LIP_H);
      g.fillStyle(b.color).fillRect(left + 1, top + 1, BOX_W - 2, LIP_H - 1);
      g.fillStyle(shade(b.color, 20)).fillRect(left + 1, top + 1, BOX_W - 2, 1);
      text(this, cx + 1, top + 5, b.code, { color: shade(b.color, -50), scale: 2, originX: 0.5 });
      text(this, cx, top + 4, b.code, { color: 0xffffff, scale: 2, originX: 0.5 });
      text(this, cx, shelfTop + SHELF_FACE + 3, String(b.price), { color: C.ink, originX: 0.5 }).setDepth(1);
      // The hit area covers the lifted pack too.
      const [x, y] = this.packXY(i);
      const hit = this.add.zone(x, y - LIFT, PACK.w, PACK.h + LIFT).setOrigin(0).setInteractive({ useHandCursor: true });
      hit.on("pointerup", () => this.pick(i));
    });
    this.tags = this.add.graphics();
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

  // --- The checklist ---------------------------------------------------------------------------------------------

  private drawChecklist() {
    const panel = RUNEWOOD.panel, ps = panel.paperSlice;
    this.add.nineslice(BOARD.x, 0, BOARD_KEY, undefined, BOARD.w, 360, ...panel.infoSlice).setOrigin(0);
    this.add.nineslice(PAPER.x, PAPER.y, PAPER_KEY, undefined, PAPER.w, PAPER.h, ps, ps, ps, ps).setOrigin(0);

    // The set name like a card's in the info panel: light, 2x, a 1px dark drop shadow.
    const left = CONTENT.x, right = CONTENT.x + CONTENT.w;
    this.nameShadow = text(this, left + 1, CONTENT.top + 1, "", { color: RUNEWOOD.cardName.shadow, scale: 2 });
    this.nameText = text(this, left, CONTENT.top, "", { color: RUNEWOOD.cardName.ink, scale: 2 });
    this.factsText = text(this, left, PAPER.y - 9, "", { color: panel.inkSoft });

    this.hoverBand = this.add.graphics();
    this.chipBoxes = this.add.graphics();
    for (let r = 0; r < LIST.rows; r++) {
      const y = LIST.y + r * LIST.rowH + 1;
      this.chipTexts.push(text(this, LIST.x + CHIP.w / 2, y + 1, "", { color: 0xffffff, originX: 0.5 }));
      this.nameTexts.push(text(this, LIST.x + CHIP.w + 4, y + 1, "", { color: panel.paperInk }));
    }
    this.scrollbar = this.add.graphics();

    // Price (the packs' total) in the set name's lettering; the count plain black, the buttons' size and line; - / +
    // change it.
    // A status (rare: no card list) shows in the price's place for a moment.
    this.statusText = text(this, left, BOTTOM.top + (BUTTON_H - 5) / 2, "", { color: panel.inkSoft });
    this.priceShadow = text(this, left + 1, BOTTOM.textY + 1, "", { color: RUNEWOOD.cardName.shadow, scale: 2 });
    this.priceText = text(this, left, BOTTOM.textY, "", { color: RUNEWOOD.cardName.ink, scale: 2 });
    this.countText = text(this, BOTTOM.count, BOTTOM.top + (BUTTON_H - 5) / 2, "", { color: INK });
    this.button(BOTTOM.minus, BOTTOM.top, BOTTOM.step, "-", "wood", () => this.setQuantity(this.quantity - 1));
    this.button(BOTTOM.plus, BOTTOM.top, BOTTOM.step, "+", "wood", () => this.setQuantity(this.quantity + 1));
    this.button(BOTTOM.buy, BOTTOM.top, BOTTOM.buyW, "BUY", "green", () => this.buy());

    // The list scrolls by the wheel or by dragging it (touch); a click (tap) on a card that doesn't drag opens its
    // details; the row under the pointer is highlighted.
    this.input.on("wheel", (p: Phaser.Input.Pointer, _: unknown, __: number, dy: number) => {
      if (p.x >= BOARD.x && !this.opening && !this.details.root.visible) this.scrollTo(this.scrollRow + Math.sign(dy) * 3);
    });
    const rowAt = (y: number) => this.scrollRow + Math.floor((y - LIST.y) / LIST.rowH);
    const zone = this.add.zone(LIST.x, LIST.y, SCROLL.x - SCROLL_REACH - LIST.x, SCROLL.h).setOrigin(0).setInteractive({ useHandCursor: true });
    let press: { y: number; row: number; moved: boolean } | null = null;
    zone.on("pointerdown", (p: Phaser.Input.Pointer) => { press = { y: p.y, row: this.scrollRow, moved: false }; });
    zone.on("pointermove", (p: Phaser.Input.Pointer) => { if (!p.isDown) this.hover(rowAt(p.y)); });
    zone.on("pointerout", () => this.hover(-1));
    zone.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (press && !press.moved) this.openDetails(rowAt(p.y));
      press = null;
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!press || !p.isDown) return;
      if (Math.abs(p.y - press.y) > DRAG_PX) press.moved = true;
      if (press.moved) this.scrollTo(press.row - Math.round((p.y - press.y) / LIST.rowH));
    });
    this.input.on("pointerup", () => { press = null; });

    // The scrollbar: grab the thumb and drag it (the pointer may wander off the bar); pressing the track elsewhere
    // brings the thumb's middle there, still held.
    const bar = this.add.zone(SCROLL.x - SCROLL_REACH, SCROLL.y, SCROLL.w + 2 * SCROLL_REACH, SCROLL.h).setOrigin(0)
      .setInteractive({ useHandCursor: true });
    let grab: number | null = null;
    bar.on("pointerdown", (p: Phaser.Input.Pointer) => {
      const t = this.thumb();
      if (!t) return;
      grab = p.y >= t.y && p.y < t.y + t.h ? p.y - t.y : Math.floor(t.h / 2);
      this.dragThumb(p.y - grab);
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => { if (grab !== null && p.isDown) this.dragThumb(p.y - grab); });
    this.input.on("pointerup", () => { grab = null; });
    this.makeDetails();
  }

  /** A Runewood list-row button (LIST_BUTTONS), BUTTON_H tall, top-left at (x, y): darker on hover, fires on release. */
  private button(x: number, y: number, w: number, label: string, look: keyof typeof LIST_BUTTONS, onClick: () => void) {
    const { key, light } = LIST_BUTTONS[look], { slice } = RUNEWOOD.listButton;
    const ink = light ? 0xffffff : RUNEWOOD.listButton.ink, inkHover = light ? 0xffffff : RUNEWOOD.listButton.inkHover;
    const box = this.add.nineslice(x, y, key, undefined, w, BUTTON_H, slice, slice, slice, slice).setOrigin(0);
    const t = text(this, x + w / 2, y + (BUTTON_H - 5) / 2, label, { color: ink, originX: 0.5 });
    const hover = (on: boolean) => {
      box.setTexture(on ? `${key}-hover` : key).setSlices(w, BUTTON_H, slice, slice, slice, slice);
      t.setTint(on ? inkHover : ink);
    };
    const hit = this.add.zone(x, y, w, BUTTON_H).setOrigin(0).setInteractive({ useHandCursor: true });
    hit.on("pointerover", () => hover(true));
    hit.on("pointerout", () => hover(false));
    hit.on("pointerup", onClick);
  }

  /** The scrollbar's thumb (top, height), or null when the whole list fits. */
  private thumb(): { y: number; h: number } | null {
    if (this.rows.length <= LIST.rows) return null;
    const h = Math.max(8, Math.round((SCROLL.h * LIST.rows) / this.rows.length));
    return { y: SCROLL.y + Math.round(((SCROLL.h - h) * this.scrollRow) / (this.rows.length - LIST.rows)), h };
  }

  /** Scrolls so the thumb's top is as near `top` as the rows allow. */
  private dragThumb(top: number) {
    const t = this.thumb();
    if (t) this.scrollTo(Math.round(((top - SCROLL.y) / (SCROLL.h - t.h)) * (this.rows.length - LIST.rows)));
  }

  /**
   * A listed card's details over the checklist, like the deck editor's: the duel's info panel (the UI theme's, like
   * the one a pack opens beside), CLOSE (Esc) under it. It swallows clicks on the checklist.
   */
  private makeDetails() {
    const by = CONTENT.bottom - LIST_BUTTON_H;
    const info = new CardInfo(this, this.engine, { x: CONTENT.x, w: CONTENT.w, top: INSET.board + 2, bottom: by - 4 });
    const close = makeListButton(this, CONTENT.x + CONTENT.w - 48, by, 48, "CLOSE", () => this.closeDetails());
    const root = this.add.container(0, 0, [
      this.add.zone(BOARD.x, 0, BOARD.w, 360).setOrigin(0).setInteractive(),
      this.add.nineslice(BOARD.x, 0, ui("info-frame"), undefined, BOARD.w, 360, ...THEME.panel.infoSlice).setOrigin(0),
      info.container, ...close,
    ]).setDepth(DETAILS_DEPTH).setVisible(false);
    this.details = { root, info };
  }

  /** Opens list row `i`'s card in the details panel. */
  private openDetails(i: number) {
    const card = this.rows[i];
    if (!card || this.opening) return;
    this.details.info.show(card.code);
    this.details.root.setVisible(true);
    this.hover(-1);
  }

  private closeDetails() {
    if (!this.details.root.visible) return;
    this.details.root.setVisible(false);
    this.details.info.clear();
  }

  /** Highlights list row `i` (-1: none). */
  private hover(i: number) {
    this.hovered = i >= 0 && i < this.rows.length ? i : -1;
    this.drawHover();
  }

  private drawHover() {
    const r = this.hovered - this.scrollRow;
    this.hoverBand.clear();
    if (this.hovered >= 0 && r >= 0 && r < LIST.rows) {
      this.hoverBand.fillStyle(RUNEWOOD.panel.paperInk, 0.12).fillRect(LIST.x - 1, LIST.y + r * LIST.rowH, LIST.w + 1, LIST.rowH);
    }
  }

  /** Packs to buy at once: 1 to MAX_PACKS; the count and the total price follow. */
  private setQuantity(n: number) {
    if (this.opening) return;
    this.quantity = Phaser.Math.Clamp(n, 1, MAX_PACKS);
    // Centred on its glyphs (measure leaves out the font's trailing spacing, which `width` counts).
    const count = String(this.quantity);
    this.countText.setText(count).setX(Math.round(BOTTOM.count - measure(this, FONT_UI, count) / 2));
    const price = `${BOOSTERS[this.picked].price * this.quantity} CHIPS`;
    this.priceText.setText(price);
    this.priceShadow.setText(price);
  }

  /** The picked set on the checklist. */
  private showSet() {
    const b = BOOSTERS[this.picked], list = this.lists.get(b.code);
    const order = RARITIES.map(([r]) => r);
    this.rows = (list?.cards ?? [])
      .map(([number, code, rarity]) => ({ number, code, rarity, name: this.engine.cards.records.get(code)?.name ?? `#${code}` }))
      .sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity) || a.number.localeCompare(b.number));
    const name = this.wrapName((list?.name ?? b.code).toUpperCase());
    this.nameText.setText(name);
    this.nameShadow.setText(name);
    const [year, month] = (list?.released ?? "").split("-").map(Number);
    this.factsText.setText(list ? `${MONTHS[month - 1]} ${year}  -  ${list.cards.length} CARDS  -  ${CARDS_PER_PACK} PER PACK` : "");
    this.setQuantity(this.quantity);
    this.setStatus("");
    this.drawTags();
    this.closeDetails();
    this.hovered = -1;
    this.scrollTo(0);
  }

  /** The set name in lines that fit the board at 2x, word by word (two lines for every name so far). */
  private wrapName(name: string): string {
    const width = CONTENT.w / 2, lines: string[] = [];
    for (const word of name.split(" ")) {
      const last = lines.length - 1;
      if (last >= 0 && measure(this, FONT_UI, `${lines[last]} ${word}`) <= width) lines[last] += ` ${word}`;
      else lines.push(word);
    }
    return lines.join("\n");
  }

  private scrollTo(row: number) {
    this.scrollRow = Phaser.Math.Clamp(row, 0, Math.max(0, this.rows.length - LIST.rows));
    const nameW = LIST.w - CHIP.w - 4;
    this.chipBoxes.clear();
    for (let r = 0; r < LIST.rows; r++) {
      const card = this.rows[this.scrollRow + r];
      const look = card && rarityLook(card.rarity);
      this.chipTexts[r].setText(look ? look.label : "");
      this.chipTexts[r].setX(Math.round(LIST.x + CHIP.w / 2 - this.chipTexts[r].width / 2));
      this.nameTexts[r].setText(card ? fit(this, FONT_UI, card.name.toUpperCase(), nameW) : "");
      if (look) this.chipBoxes.fillStyle(look.color).fillRect(LIST.x, LIST.y + r * LIST.rowH + 1, CHIP.w, CHIP.h);
    }
    // Scrollbar: the track, and the thumb for the rows in view (as the card text's scrollbar in the info panel: a faint
    // track, the thumb darker).
    this.scrollbar.clear();
    const t = this.thumb();
    if (t) {
      this.scrollbar.fillStyle(RUNEWOOD.panel.paperInk, 0.15).fillRect(SCROLL.x, SCROLL.y, SCROLL.w, SCROLL.h);
      this.scrollbar.fillStyle(RUNEWOOD.panel.paperInk, 0.6).fillRect(SCROLL.x, t.y, SCROLL.w, t.h);
    }
    this.drawHover();
  }

  // --- Picking and buying ----------------------------------------------------------------------------------------

  /**
   * Arrows pick a pack (columns, then rows), - / + set how many, Enter / Space / X buy them, Esc closes a card's
   * details or leaves; while packs open, their keys.
   */
  private handleKey(code: string) {
    if (this.opening) return this.opening.handleKey(code);
    if (code === "Escape" && this.details.root.visible) return this.closeDetails();
    const col = this.picked % COLS;
    if (code === "ArrowLeft" && col > 0) this.pick(this.picked - 1);
    else if (code === "ArrowRight" && col < COLS - 1) this.pick(this.picked + 1);
    else if (code === "ArrowUp") this.pick(this.picked - COLS);
    else if (code === "ArrowDown") this.pick(this.picked + COLS);
    else if (code === "Minus" || code === "NumpadSubtract") this.setQuantity(this.quantity - 1);
    else if (code === "Equal" || code === "NumpadAdd") this.setQuantity(this.quantity + 1);
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
    this.showSet();
  }

  /** Opens the packs bought, one after another (free for now: no chips are spent, the cards aren't kept). */
  private buy() {
    if (transitioning(this.game) || this.opening) return;
    const b = BOOSTERS[this.picked], list = this.lists.get(b.code);
    if (!list) return this.setStatus("NO CARD LIST: RUN BUILD-DATA", RUNEWOOD.panel.error);
    this.closeDetails();
    const key = [largeKey(b), packKey(b)].find((k) => this.textures.exists(k)) ?? null;
    this.opening = new PackOpening(this, {
      packKey: key, title: list.name, packs: Array.from({ length: this.quantity }, () => pullPack(list)), engine: this.engine,
      onClose: () => { this.opening = null; },
    });
  }

  /** A line in the price's place for a moment ("": the price again). */
  private setStatus(s: string, color = RUNEWOOD.panel.inkSoft) {
    this.statusTimer?.remove();
    this.statusText.setText(s).setTint(color);
    this.priceText.setVisible(!s);
    this.priceShadow.setVisible(!s);
    this.statusTimer = s ? this.time.delayedCall(STATUS_MS, () => this.setStatus("")) : null;
  }

  private exit() {
    if (!transitioning(this.game) && !this.opening) void transitionTo(this, "Overworld");
  }
}
