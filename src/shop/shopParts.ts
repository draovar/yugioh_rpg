// What the card shop (Shop.ts) and the deck shop (DeckShop.ts) share: the room (dark wood panelling, a sign, a
// wood-framed fixture in the same place: the card shop's glass case, the deck shop's pegboard), the Runewood list
// buttons, what's on the fixture scrolling a row or column at a time (ScrollingFixture). The shops have their own
// look, not the UI theme's (the owner's choice: one real-shop look).
import Phaser from "phaser";
import { text } from "../ui/pixel.ts";
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
/** Pointer travel that turns a press into a scroll (a shorter one picks or opens), as in the deck editor. */
export const DRAG_PX = 6;
export const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** The scroll cues' arrows bob a pixel this often. */
const CUE_BOB_MS = 600;
/** Lines (rows or columns) in view; more scroll (a line at a time, SCROLL_MS each). A swipe on the fixture this long
 * scrolls a line (touch, or a mouse drag); so do this many wheel units (a mouse notch is ~100). */
const VISIBLE_LINES = 2, SCROLL_MS = 250, SWIPE_PX = 16, WHEEL_STEP = 50;

export const shade = (color: number, by: number) => {
  const c = Phaser.Display.Color.ValueToColor(color);
  return (by < 0 ? c.darken(-by) : c.lighten(by)).color;
};

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

  const signW = 84, signX = CASE.x + CASE.w / 2 - signW / 2;
  g.fillStyle(C.signEdge).fillRect(signX, 5, signW, 20).fillStyle(C.sign).fillRect(signX + 1, 6, signW - 2, 18);

  g.fillStyle(C.woodEdge).fillRect(CASE.x, CASE.y, CASE.w, CASE.h);
  g.fillStyle(C.wood).fillRect(CASE.x + 1, CASE.y + 1, CASE.w - 2, CASE.h - 2);
  g.fillStyle(C.woodLight).fillRect(CASE.x + 1, CASE.y + 1, CASE.w - 2, 1).fillRect(CASE.x + 1, CASE.y + 1, 1, CASE.h - 2);
  g.fillStyle(C.woodDark).fillRect(CASE.x + 1, CASE.y + CASE.h - 2, CASE.w - 2, 1).fillRect(CASE.x + CASE.w - 2, CASE.y + 1, 1, CASE.h - 2);
  g.fillStyle(C.woodEdge).fillRect(IN.x - 1, IN.y - 1, IN.w + 2, IN.h + 2);
  inside(g);
  const baked = scene.add.renderTexture(0, 0, 640, 360).setOrigin(0);
  baked.draw(g).render();
  g.destroy();

  text(scene, CASE.x + CASE.w / 2, 10, title, { color: C.signInk, scale: 2, originX: 0.5 });
}

/**
 * Scroll cues for a fixture with more lines than fit: a small tab like the sign on its frame (top / bottom for rows,
 * left / right for columns), a gold arrow in it bobbing a pixel toward the lines out of view (pixel steps, CUE_BOB_MS
 * apart). Clicking one calls `onScroll`.
 */
class ScrollCues {
  private cues: { by: -1 | 1; root: Phaser.GameObjects.Container; arrow: Phaser.GameObjects.Graphics; rest: number }[];

  constructor(scene: Phaser.Scene, axis: "x" | "y", onScroll: (by: -1 | 1) => void) {
    const long = 17, short = 9;
    this.cues = ([-1, 1] as const).map((by) => {
      let tab: Phaser.GameObjects.Graphics, arrow: Phaser.GameObjects.Graphics, hit: Phaser.GameObjects.Zone, rest: number;
      if (axis === "y") {
        // Top: across the top frame, under the sign; bottom: across the bottom frame. The arrow 7 wide, 4 tall: rows 1,
        // 3, 5, 7 px pointing up, the reverse pointing down.
        const cx = CASE.x + CASE.w / 2, y = by < 0 ? CASE.y - 2 : CASE.y + CASE.h - short + 2;
        tab = scene.add.graphics().fillStyle(C.signEdge).fillRect(cx - 8, y, long, short).fillStyle(C.sign).fillRect(cx - 7, y + 1, long - 2, short - 2);
        arrow = scene.add.graphics({ x: cx, y: y + 2 });
        for (let k = 0; k < 4; k++) arrow.fillStyle(C.signInk).fillRect(-k, by < 0 ? k : 3 - k, 2 * k + 1, 1);
        hit = scene.add.zone(cx - 24, y - 2, 48, short + 4);
        rest = y + 2;
      } else {
        // Left: across the left frame; right: across the right frame. The arrow 4 wide, 7 tall, pointing out.
        const cy = CASE.y + CASE.h / 2, x = by < 0 ? CASE.x - 2 : CASE.x + CASE.w - short + 2;
        tab = scene.add.graphics().fillStyle(C.signEdge).fillRect(x, cy - 8, short, long).fillStyle(C.sign).fillRect(x + 1, cy - 7, short - 2, long - 2);
        arrow = scene.add.graphics({ x: x + 2, y: cy });
        for (let k = 0; k < 4; k++) arrow.fillStyle(C.signInk).fillRect(by < 0 ? k : 3 - k, -k, 1, 2 * k + 1);
        hit = scene.add.zone(x - 2, cy - 24, short + 4, 48);
        rest = x + 2;
      }
      hit.setOrigin(0).setInteractive({ useHandCursor: true }).on("pointerup", () => onScroll(by));
      return { by, root: scene.add.container(0, 0, [tab, arrow, hit]).setDepth(3), arrow, rest };
    });
    let out = false;
    scene.time.addEvent({
      delay: CUE_BOB_MS, loop: true,
      callback: () => {
        out = !out;
        for (const c of this.cues) c.arrow[axis] = c.rest + (out ? c.by : 0);
      },
    });
  }

  /** Each cue shows while the fixture can scroll its way (back: -1, on: 1). */
  show(back: boolean, on: boolean) {
    for (const c of this.cues) c.root.setVisible(c.by < 0 ? back : on);
  }
}

/**
 * What hangs or stands on a fixture, in lines of `perLine` items, `lineSize` px apart: rows down the fixture (axis y:
 * the card shop's shelves) or columns along it (axis x: the deck shop's pegboard, one deck each). Everything on them
 * goes in `content`, clipped to the fixture's inside (a mask on its parent). Two lines are in view; with more, they
 * scroll smoothly a line at a time: the scroll cues, a swipe over the fixture (along the axis), the wheel over it, or
 * `show` (an item picked out of view). Only the items on the lines in view take clicks (their zones, `addZone`), none
 * while the lines move.
 */
export class ScrollingFixture {
  readonly content: Phaser.GameObjects.Container;
  readonly lines: number;
  private scene: Phaser.Scene;
  private axis: "x" | "y";
  private perLine: number;
  private lineSize: number;
  private busy: () => boolean;
  /** The first line in view, and whether the lines are moving to it. */
  private line = 0;
  private scrolling = false;
  private zones: Phaser.GameObjects.Zone[] = [];
  private cues: ScrollCues | null = null;

  constructor(scene: Phaser.Scene, opts: { count: number; perLine: number; lineSize: number; axis: "x" | "y"; busy: () => boolean }) {
    this.scene = scene;
    this.axis = opts.axis;
    this.perLine = opts.perLine;
    this.lineSize = opts.lineSize;
    this.busy = opts.busy;
    this.lines = Math.ceil(opts.count / opts.perLine);
    this.content = scene.add.container(0, 0);
    const clip = scene.make.graphics({}, false).fillStyle(0xffffff).fillRect(IN.x, IN.y, IN.w, IN.h);
    scene.add.container(0, 0, [this.content]).enableFilters().filters!.internal.addMask(clip);

    // Swiping over the fixture along its axis (touch, or a mouse drag) scrolls it a line; so does the wheel over it
    // (WHEEL_STEP units; sideways too on a columns fixture).
    scene.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      const inside = p.downX >= IN.x && p.downX < IN.x + IN.w && p.downY >= IN.y && p.downY < IN.y + IN.h;
      const moved = this.axis === "y" ? p.y - p.downY : p.x - p.downX;
      if (inside && !this.busy() && Math.abs(moved) > SWIPE_PX) this.scroll(moved < 0 ? 1 : -1);
    });
    let wheel = 0;
    scene.input.on("wheel", (p: Phaser.Input.Pointer, _: unknown, dx: number, dy: number) => {
      if (this.busy() || p.x < CASE.x || p.x >= CASE.x + CASE.w || p.y < CASE.y || p.y >= CASE.y + CASE.h) return;
      wheel += this.axis === "x" && Math.abs(dx) > Math.abs(dy) ? dx : dy;
      if (Math.abs(wheel) >= WHEEL_STEP) {
        this.scroll(Math.sign(wheel));
        wheel = 0;
      }
    });
  }

  /** The scroll cues on the fixture's frame (only with more lines than fit). */
  makeCues() {
    if (this.lines <= VISIBLE_LINES) return;
    this.cues = new ScrollCues(this.scene, this.axis, (by) => { if (!this.busy()) this.scroll(by); });
    this.showCues();
  }

  /** The next item's hit zone (added in item order): it takes clicks while its line is in view. */
  addZone(zone: Phaser.GameObjects.Zone) {
    this.zones.push(zone);
    this.content.add(zone);
    this.setZones();
  }

  /** Scrolls item i's line into view. */
  show(i: number) {
    const line = Math.floor(i / this.perLine);
    if (line < this.line) this.scroll(line - this.line);
    else if (line >= this.line + VISIBLE_LINES) this.scroll(line - this.line - VISIBLE_LINES + 1);
  }

  /** Scrolls `by` lines (smoothly; one move at a time), as far as there are lines. */
  private scroll(by: number) {
    const to = Phaser.Math.Clamp(this.line + by, 0, Math.max(0, this.lines - VISIBLE_LINES));
    if (this.scrolling || to === this.line) return;
    this.line = to;
    this.scrolling = true;
    this.setZones();
    this.showCues();
    this.scene.tweens.add({
      targets: this.content, [this.axis]: -to * this.lineSize, duration: SCROLL_MS, ease: "Sine.easeInOut",
      onComplete: () => {
        this.scrolling = false;
        this.setZones();
      },
    });
  }

  private setZones() {
    this.zones.forEach((z, i) => {
      const line = Math.floor(i / this.perLine);
      z.input!.enabled = !this.scrolling && line >= this.line && line < this.line + VISIBLE_LINES;
    });
  }

  private showCues() {
    this.cues?.show(this.line > 0, this.line < this.lines - VISIBLE_LINES);
  }
}
