// What the card shop (Shop.ts) and the deck shop (DeckShop.ts) share: the room (dark wood panelling, a sign, a
// wood-framed fixture in the same place: the card shop's glass case, the deck shop's pegboard), the chip count and
// EXIT, the Runewood list buttons, the price labels, what's on the fixture scrolling a row at a time
// (ScrollingFixture). The shops have their own look, not the UI theme's (the owner's choice: one real-shop look).
import Phaser from "phaser";
import { DRAG_PX } from "../ui/listDrag.ts";
import { FONT_UI, measure, text } from "../ui/pixel.ts";
import { THEMES } from "../ui/theme.ts";
import { LIST_BUTTON_H } from "../ui/widgets.ts";

/** The shops' colours: dark wood panelling, lighter wood fixtures with a navy back, light price labels. */
export const C = {
  wall: 0x3b2a20, wallSeam: 0x30221a,
  wood: 0x9c6b43, woodLight: 0xc08a5a, woodDark: 0x6e4a2e, woodEdge: 0x2a1a10,
  back: 0x1c2233, backShadow: 0x131826,
  sign: 0x2a1a10, signEdge: 0x8a6a3a, signInk: 0xf2c96b,
  ink: 0x2a1a10, tag: 0xf6f0e0, tagPicked: 0xffd75e, light: 0xf2e8d0, glass: 0xffffff,
};

/** The fixture on the left (wood frame) and its inside. */
export const CASE = { x: 8, y: 30, w: 400, h: 324 };
export const IN = { x: CASE.x + 6, y: CASE.y + 6, w: CASE.w - 12, h: CASE.h - 12 };
export const RUNEWOOD = THEMES.runewood;
/** The shops' buttons: 2px taller than a list row, the label in the middle. */
export const BUTTON_H = LIST_BUTTON_H + 2;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const TAG = { w: 24, h: 9 };
/** A picked item lifts (and the one picked before settles back) in this long. */
const LIFT_MS = 80;
/** The scroll cues' arrows bob a pixel this often. */
const CUE_BOB_MS = 600;
/** Rows in view; more scroll (a row at a time, SCROLL_MS each). A swipe on the fixture this long scrolls a row (touch,
 * or a mouse drag); so do this many wheel units (a mouse notch is ~100). */
const VISIBLE_ROWS = 2, SCROLL_MS = 250, SWIPE_PX = 16, WHEEL_STEP = 50;

export const shade = (color: number, by: number) => {
  const c = Phaser.Display.Color.ValueToColor(color);
  return (by < 0 ? c.darken(-by) : c.lighten(by)).color;
};

/** A release date (YYYY-MM-DD) as its month and year: "MAR 2004". */
export function monthYear(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

/**
 * The shops' buttons: list-row buttons like the info panel's CLOSE, always Runewood's: wood for - / +, green for BUY,
 * dark brown for EXIT (public/assets/ui/shop/, `node tools/art/import-ui.mjs shop`); each file has its hover look beside
 * it (-hover). `light`: a white label, else Runewood's list-button ink (dark, light on hover).
 */
const LIST_BUTTONS: Record<"wood" | "green" | "dark", { key: string; file: string; light?: boolean }> = {
  wood: { key: "shop-list-button", file: "assets/ui/runewood/menu-button" },
  green: { key: "shop-list-button-green", file: "assets/ui/shop/list-button-green" },
  dark: { key: "shop-list-button-dark", file: "assets/ui/shop/list-button-dark", light: true },
};

export function preloadShopButtons(scene: Phaser.Scene) {
  for (const { key, file } of Object.values(LIST_BUTTONS)) {
    if (!scene.textures.exists(key)) scene.load.image(key, `${file}.png`);
    if (!scene.textures.exists(`${key}-hover`)) scene.load.image(`${key}-hover`, `${file}-hover.png`);
  }
}

/** A Runewood list-row button (LIST_BUTTONS), BUTTON_H tall, top-left at (x, y): darker on hover, fires on release. */
export function shopButton(scene: Phaser.Scene, x: number, y: number, w: number, label: string, look: keyof typeof LIST_BUTTONS, onClick: () => void) {
  const { key, light } = LIST_BUTTONS[look], { slice } = RUNEWOOD.listButton;
  const ink = light ? 0xffffff : RUNEWOOD.listButton.ink, inkHover = light ? 0xffffff : RUNEWOOD.listButton.inkHover;
  const box = scene.add.nineslice(x, y, key, undefined, w, BUTTON_H, slice, slice, slice, slice).setOrigin(0);
  const t = text(scene, x + w / 2, y + (BUTTON_H - 5) / 2, label, { color: ink, originX: 0.5 });
  const hover = (on: boolean) => {
    box.setTexture(on ? `${key}-hover` : key).setSlices(w, BUTTON_H, slice, slice, slice, slice);
    t.setTint(on ? inkHover : ink);
  };
  const hit = scene.add.zone(x, y, w, BUTTON_H).setOrigin(0).setInteractive({ useHandCursor: true });
  hit.on("pointerover", () => hover(true));
  hit.on("pointerout", () => hover(false));
  hit.on("pointerup", onClick);
}

/**
 * The room, baked (none of it changes): the panelled wall, the sign over the fixture with `title` on it, the fixture's
 * wood frame with a light top/left edge and a dark bottom/right one; `inside` draws the fixture's inside (IN).
 */
export function drawRoom(scene: Phaser.Scene, title: string, inside: (g: Phaser.GameObjects.Graphics) => void) {
  const g = scene.make.graphics({}, false);
  g.fillStyle(C.wall).fillRect(0, 0, 640, 360);
  g.fillStyle(C.wallSeam);
  for (let x = 12; x < 640; x += 24) g.fillRect(x, 0, 1, 360);

  // 84 wide, wider for a longer title (at 2x, 6 px either side).
  const signW = Math.max(84, 2 * measure(scene, FONT_UI, title) + 12), signX = CASE.x + CASE.w / 2 - signW / 2;
  g.fillStyle(C.signEdge).fillRect(signX, 5, signW, 20).fillStyle(C.sign).fillRect(signX + 1, 6, signW - 2, 18);

  woodBlock(g, CASE.x, CASE.y, CASE.w, CASE.h);
  g.fillStyle(C.woodEdge).fillRect(IN.x - 1, IN.y - 1, IN.w + 2, IN.h + 2);
  inside(g);
  const baked = scene.add.renderTexture(0, 0, 640, 360).setOrigin(0);
  baked.draw(g).render();
  g.destroy();

  text(scene, CASE.x + CASE.w / 2, 10, title, { color: C.signInk, scale: 2, originX: 0.5 });
}

/** A piece of the fixtures' wood: a dark edge, light along its top and left, darker along its bottom and right. */
export function woodBlock(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number) {
  g.fillStyle(C.woodEdge).fillRect(x, y, w, h);
  g.fillStyle(C.wood).fillRect(x + 1, y + 1, w - 2, h - 2);
  g.fillStyle(C.woodLight).fillRect(x + 1, y + 1, w - 2, 1).fillRect(x + 1, y + 1, 1, h - 2);
  g.fillStyle(C.woodDark).fillRect(x + 1, y + h - 2, w - 2, 1).fillRect(x + w - 2, y + 1, 1, h - 2);
}

/** The chip count top-left; EXIT in dark brown at the fixture's right edge, level with the sign. */
export function drawChipsAndExit(scene: Phaser.Scene, chips: number, onExit: () => void) {
  text(scene, 10, 12, `CHIPS: ${chips}`, { color: C.light });
  shopButton(scene, CASE.x + CASE.w - 40, 15 - Math.floor(BUTTON_H / 2), 40, "EXIT", "dark", onExit);
}

/** A blank picture with `code` on it, for an item whose picture is missing. */
export function blankPicture(scene: Phaser.Scene, w: number, h: number, code: string): Phaser.GameObjects.GameObject[] {
  const g = scene.add.graphics().fillStyle(0x8a8a8a).fillRect(0, 0, w, h).fillStyle(0x6a6a6a).fillRect(3, 3, w - 6, h - 6);
  return [g, text(scene, w / 2, h / 2 - 2, code, { color: 0xffffff, originX: 0.5 })];
}

/** A price label centred on x, its top at y: light, the picked one yellow (its price: `tagPrice`). */
export function drawTag(g: Phaser.GameObjects.Graphics, x: number, y: number, picked: boolean) {
  const left = x - TAG.w / 2;
  g.fillStyle(C.woodEdge).fillRect(left, y, TAG.w, TAG.h);
  g.fillStyle(picked ? C.tagPicked : C.tag).fillRect(left + 1, y + 1, TAG.w - 2, TAG.h - 2);
}

/** The price on a label centred on x, its top at y. */
export function tagPrice(scene: Phaser.Scene, x: number, y: number, price: number): Phaser.GameObjects.BitmapText {
  return text(scene, x, y + 2, String(price), { color: C.ink, originX: 0.5 });
}

/** Moves an item to `y`: up off its rest when picked, back down when another one is. */
export function liftTo(scene: Phaser.Scene, item: Phaser.GameObjects.Container, y: number) {
  scene.tweens.killTweensOf(item);
  scene.tweens.add({ targets: item, y, duration: LIFT_MS, ease: "Linear" });
}

/**
 * Scroll cues for a fixture with more rows than fit: a small tab like the sign across its top and bottom frame, a gold
 * arrow in it bobbing a pixel toward the rows out of view (pixel steps, CUE_BOB_MS apart). Clicking one calls `onScroll`.
 */
class ScrollCues {
  private cues: { by: -1 | 1; root: Phaser.GameObjects.Container; arrow: Phaser.GameObjects.Graphics; rest: number }[];

  constructor(scene: Phaser.Scene, onScroll: (by: -1 | 1) => void) {
    const w = 17, h = 9, cx = CASE.x + CASE.w / 2;
    this.cues = ([-1, 1] as const).map((by) => {
      // Top: across the top frame, under the sign; bottom: across the bottom frame. The arrow 7 wide, 4 tall: rows 1,
      // 3, 5, 7 px pointing up, the reverse pointing down.
      const y = by < 0 ? CASE.y - 2 : CASE.y + CASE.h - h + 2;
      const tab = scene.add.graphics().fillStyle(C.signEdge).fillRect(cx - 8, y, w, h).fillStyle(C.sign).fillRect(cx - 7, y + 1, w - 2, h - 2);
      const arrow = scene.add.graphics({ x: cx, y: y + 2 });
      for (let k = 0; k < 4; k++) arrow.fillStyle(C.signInk).fillRect(-k, by < 0 ? k : 3 - k, 2 * k + 1, 1);
      const hit = scene.add.zone(cx - 24, y - 2, 48, h + 4).setOrigin(0).setInteractive({ useHandCursor: true });
      hit.on("pointerup", () => onScroll(by));
      return { by, root: scene.add.container(0, 0, [tab, arrow, hit]).setDepth(3), arrow, rest: y + 2 };
    });
    let out = false;
    scene.time.addEvent({
      delay: CUE_BOB_MS, loop: true,
      callback: () => {
        out = !out;
        for (const c of this.cues) c.arrow.y = c.rest + (out ? c.by : 0);
      },
    });
  }

  /** Each cue shows while the fixture can scroll its way (up: -1, down: 1). */
  show(up: boolean, down: boolean) {
    for (const c of this.cues) c.root.setVisible(c.by < 0 ? up : down);
  }
}

/**
 * What hangs or stands on a fixture, in rows of `perRow` items, `rowH` px apart (the card shop's shelves, the deck
 * shop's pegboard). Everything on them goes in `content`, clipped to the fixture's inside (a mask on its parent). Two
 * rows are in view; with more, they scroll smoothly a row at a time: the scroll cues, a swipe over the fixture, the
 * wheel over it, or `show` (an item picked out of view). Only the items on the rows in view take clicks (`addItem`),
 * none while the rows move.
 */
export class ScrollingFixture {
  readonly content: Phaser.GameObjects.Container;
  readonly rows: number;
  private scene: Phaser.Scene;
  private perRow: number;
  private rowH: number;
  private busy: () => boolean;
  /** The first row in view, and whether the rows are moving to it. */
  private row = 0;
  private scrolling = false;
  private zones: Phaser.GameObjects.Zone[] = [];
  private cues: ScrollCues | null = null;

  constructor(scene: Phaser.Scene, opts: { count: number; perRow: number; rowH: number; busy: () => boolean }) {
    this.scene = scene;
    this.perRow = opts.perRow;
    this.rowH = opts.rowH;
    this.busy = opts.busy;
    this.rows = Math.ceil(opts.count / opts.perRow);
    this.content = scene.add.container(0, 0);
    const clip = scene.make.graphics({}, false).fillStyle(0xffffff).fillRect(IN.x, IN.y, IN.w, IN.h);
    scene.add.container(0, 0, [this.content]).enableFilters().filters!.internal.addMask(clip);

    // Swiping up or down over the fixture (touch, or a mouse drag) scrolls it a row; so does the wheel over it.
    scene.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      const inside = p.downX >= IN.x && p.downX < IN.x + IN.w && p.downY >= IN.y && p.downY < IN.y + IN.h;
      const moved = p.y - p.downY;
      if (inside && !this.busy() && Math.abs(moved) > SWIPE_PX) this.scroll(moved < 0 ? 1 : -1);
    });
    let wheel = 0;
    scene.input.on("wheel", (p: Phaser.Input.Pointer, _: unknown, __: number, dy: number) => {
      if (this.busy() || p.x < CASE.x || p.x >= CASE.x + CASE.w || p.y < CASE.y || p.y >= CASE.y + CASE.h) return;
      wheel += dy;
      if (Math.abs(wheel) >= WHEEL_STEP) {
        this.scroll(Math.sign(wheel));
        wheel = 0;
      }
    });

    if (this.rows > VISIBLE_ROWS) this.cues = new ScrollCues(scene, (by) => { if (!this.busy()) this.scroll(by); });
    this.showCues();
  }

  /**
   * The next item's hit zone (added in item order), top-left at (x, y): a click picks it while its row is in view; a
   * press that drags (a swipe) scrolls instead.
   */
  addItem(x: number, y: number, w: number, h: number, onPick: () => void) {
    const zone = this.scene.add.zone(x, y, w, h).setOrigin(0).setInteractive({ useHandCursor: true });
    zone.on("pointerup", (p: Phaser.Input.Pointer) => { if (Math.abs(p.y - p.downY) <= DRAG_PX) onPick(); });
    this.zones.push(zone);
    this.content.add(zone);
    this.setZones();
  }

  /** Scrolls item i's row into view. */
  show(i: number) {
    const row = Math.floor(i / this.perRow);
    if (row < this.row) this.scroll(row - this.row);
    else if (row >= this.row + VISIBLE_ROWS) this.scroll(row - this.row - VISIBLE_ROWS + 1);
  }

  /** Scrolls `by` rows (smoothly; one move at a time), as far as there are rows. */
  private scroll(by: number) {
    const to = Phaser.Math.Clamp(this.row + by, 0, Math.max(0, this.rows - VISIBLE_ROWS));
    if (this.scrolling || to === this.row) return;
    this.row = to;
    this.scrolling = true;
    this.setZones();
    this.showCues();
    this.scene.tweens.add({
      targets: this.content, y: -to * this.rowH, duration: SCROLL_MS, ease: "Sine.easeInOut",
      onComplete: () => {
        this.scrolling = false;
        this.setZones();
      },
    });
  }

  private setZones() {
    this.zones.forEach((z, i) => {
      const row = Math.floor(i / this.perRow);
      z.input!.enabled = !this.scrolling && row >= this.row && row < this.row + VISIBLE_ROWS;
    });
  }

  private showCues() {
    this.cues?.show(this.row > 0, this.row < this.rows - VISIBLE_ROWS);
  }
}
