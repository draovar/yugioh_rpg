// Scrolling a list of rows by hand, the same in the shops' boards and the deck editor: drag the rows (touch or mouse)
// or the scrollbar's thumb. Once a drag starts it follows the pointer anywhere on the screen until it's released, so a
// finger that slides off a small list keeps scrolling it.
import type Phaser from "phaser";

/** Pointer travel that turns a press into a scroll (a shorter one clicks: picks, adds or opens). */
export const DRAG_PX = 6;

/**
 * A list's rows dragged by the pointer: pressed on `zone`, they follow it a row per `rowH` px. `clicking` tells a click
 * from a drag in the zone's own `pointerup` (it runs before the press is cleared); `onDrag` runs when a press starts
 * dragging.
 */
export class ListDrag {
  private press: { y: number; row: number; moved: boolean } | null = null;

  constructor(scene: Phaser.Scene, zone: Phaser.GameObjects.Zone,
    opts: { rowH: number; row: () => number; scrollTo: (row: number) => void; onDrag?: () => void }) {
    zone.on("pointerdown", (p: Phaser.Input.Pointer) => { this.press = { y: p.y, row: opts.row(), moved: false }; });
    scene.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      const press = this.press;
      if (!press || !p.isDown) return;
      if (!press.moved && Math.abs(p.y - press.y) > DRAG_PX) {
        press.moved = true;
        opts.onDrag?.();
      }
      if (press.moved) opts.scrollTo(press.row - Math.round((p.y - press.y) / opts.rowH));
    });
    scene.input.on("pointerup", () => { this.press = null; });
  }

  /** A press on the list that hasn't dragged (yet). */
  get clicking() {
    return this.press !== null && !this.press.moved;
  }

  /** A press on the list that is scrolling it. */
  get dragging() {
    return this.press?.moved ?? false;
  }
}

/**
 * A scrollbar on `bar` over the track `track`: grab the thumb and drag it; pressing the track elsewhere brings the
 * thumb's middle there, still held. `thumb` is where it's drawn (null: the list fits); the list scrolls to the row whose
 * thumb top is nearest the pointer's, out of `maxRow()`.
 */
export function dragThumb(scene: Phaser.Scene, bar: Phaser.GameObjects.Zone, track: { y: number; h: number },
  thumb: () => { y: number; h: number } | null, maxRow: () => number, scrollTo: (row: number) => void) {
  const moveTo = (top: number) => {
    const t = thumb();
    if (t) scrollTo(Math.round(((top - track.y) / (track.h - t.h)) * maxRow()));
  };
  let grab: number | null = null;
  bar.on("pointerdown", (p: Phaser.Input.Pointer) => {
    const t = thumb();
    if (!t) return;
    grab = p.y >= t.y && p.y < t.y + t.h ? p.y - t.y : Math.floor(t.h / 2);
    moveTo(p.y - grab);
  });
  scene.input.on("pointermove", (p: Phaser.Input.Pointer) => { if (grab !== null && p.isDown) moveTo(p.y - grab); });
  scene.input.on("pointerup", () => { grab = null; });
}
