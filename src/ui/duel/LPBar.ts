// Life-point bar: Runewood wooden frame (nine-sliced) with a coloured filler in its inset track,
// the LP number on the left and the duelist's name on the right, both drawn inside the track.
import Phaser from "phaser";
import { text } from "../pixel.ts";

export const LP_BAR = { h: 15 };
/** The frame's rim is 3px on every side; the fill lives in the track inside it. */
const RIM = 3;
const TRACK_H = LP_BAR.h - RIM * 2;

/** Filler sprite per LP band, with its nine-slice insets (top highlight / bottom shade rows). */
const FILLS = [
  { min: 0.5, key: "ui-lp-fill-green", slice: [0, 0, 1, 0] },
  { min: 0.25, key: "ui-lp-fill-orange", slice: [0, 0, 1, 1] },
  { min: 0, key: "ui-lp-fill-red", slice: [0, 0, 1, 0] },
] as const;

const LABEL = 0xf6e3c4;
const SHADOW = 0x432925;

export const LP_BAR_TEXTURES = ["lp-frame", "lp-fill-green", "lp-fill-orange", "lp-fill-red"];

export class LPBar extends Phaser.GameObjects.Container {
  private readonly max: number;
  private readonly trackW: number;
  private readonly fill: Phaser.GameObjects.Container;
  private readonly lpText: Phaser.GameObjects.BitmapText[];

  constructor(scene: Phaser.Scene, x: number, y: number, width: number, name: string, max: number) {
    super(scene, x, y);
    this.max = max;
    this.trackW = width - RIM * 2;
    this.add(scene.add.nineslice(0, 0, "ui-lp-frame", undefined, width, LP_BAR.h, RIM, RIM, RIM, RIM).setOrigin(0));
    this.fill = scene.add.container(RIM, RIM);
    this.add(this.fill);
    const ty = RIM + Math.floor((TRACK_H - 5) / 2);
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

  /** Light label with a 1px dark drop shadow, so it reads over both the fill and the empty track. */
  private shadowed(x: number, y: number, label: string, originX: number): Phaser.GameObjects.BitmapText[] {
    const shadow = text(this.scene, x + 1, y + 1, label, { color: SHADOW, originX });
    const front = text(this.scene, x, y, label, { color: LABEL, originX });
    this.add([shadow, front]);
    return [shadow, front];
  }
}
