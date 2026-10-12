// Life-point bar: the theme's bar frame (nine-sliced) with a coloured filler in its inset track,
// the LP number on the left and the duelist's name on the right, both drawn inside the track.
import Phaser from "phaser";
import { text } from "../pixel.ts";
import { THEME, ui } from "../theme.ts";
import { INSET } from "./layout.ts";

export const LP_BAR = { h: 15 };
/** The track (where the fill lives) sits this far inside the frame on every side (global). */
const RIM = INSET.lpTrack;
/** The frame sprite's nine-slice inset (theme). */
const FRAME_SLICE = THEME.lpBar.slice;
const TRACK_H = LP_BAR.h - RIM * 2;

/** Filler sprite per LP band, with its nine-slice insets (top highlight / bottom shade rows). */
const FILLS = THEME.lpBar.fills.map((f) => ({ ...f, key: ui(f.role) }));

const { label: LABEL, shadow: SHADOW, loss: LOSS, gain: GAIN } = THEME.lpBar;

export class LPBar extends Phaser.GameObjects.Container {
  private readonly max: number;
  private readonly trackW: number;
  private readonly fill: Phaser.GameObjects.Container;
  private readonly lpText: Phaser.GameObjects.BitmapText[];
  private delta: Phaser.GameObjects.BitmapText[] = [];
  private deltaTimer: Phaser.Time.TimerEvent | null = null;
  private readonly textY: number;

  constructor(scene: Phaser.Scene, x: number, y: number, width: number, name: string, max: number) {
    super(scene, x, y);
    this.max = max;
    this.trackW = width - RIM * 2;
    this.add(scene.add.nineslice(0, 0, ui("lp-frame"), undefined, width, LP_BAR.h, FRAME_SLICE, FRAME_SLICE, FRAME_SLICE, FRAME_SLICE).setOrigin(0));
    this.fill = scene.add.container(RIM, RIM);
    this.add(this.fill);
    const ty = (this.textY = RIM + Math.floor((TRACK_H - 5) / 2));
    this.lpText = this.shadowed(RIM + 3, ty, "", 0);
    this.shadowed(width - RIM - 3, ty, name.toUpperCase(), 1);
    scene.add.existing(this);
  }

  /** Shows `lp` (can be called every frame while LP counts up/down). */
  set(lp: number): this {
    const value = Math.max(0, Math.round(lp));
    const ratio = Math.min(1, value / this.max);
    const band = FILLS.find((f) => ratio >= f.min) ?? FILLS[FILLS.length - 1];
    const w = Math.round(this.trackW * ratio);
    this.fill.removeAll(true);
    if (w > 0) this.fill.add(this.scene.add.nineslice(0, 0, band.key, undefined, w, TRACK_H, ...band.slice).setOrigin(0));
    for (const t of this.lpText) t.setText(String(value));
    return this;
  }

  /**
   * Shows an LP change ("-1500" red / "+500" green) inside the bar, right after the LP number, for `ms`.
   * Placed after the widest LP value (4 digits) so it doesn't jump while the number counts.
   */
  showDelta(delta: number, ms: number): void {
    for (const t of this.delta) t.destroy();
    this.deltaTimer?.remove();
    const label = delta > 0 ? `+${delta}` : `${delta}`;
    this.delta = this.shadowed(RIM + 3 + 18, this.textY, label, 0, delta > 0 ? GAIN : LOSS);
    this.deltaTimer = this.scene.time.delayedCall(ms, () => {
      for (const t of this.delta) t.destroy();
      this.delta = [];
    });
  }

  /** Light label with a 1px dark drop shadow, so it reads over both the fill and the empty track. */
  private shadowed(x: number, y: number, label: string, originX: number, color = LABEL): Phaser.GameObjects.BitmapText[] {
    const shadow = text(this.scene, x + 1, y + 1, label, { color: SHADOW, originX });
    const front = text(this.scene, x, y, label, { color, originX });
    this.add([shadow, front]);
    return [shadow, front];
  }
}
