import Phaser from "phaser";
import { INK, WHITE, border, text } from "./pixel.ts";

export interface Button extends Phaser.GameObjects.Container {
  setEnabled(on: boolean): this;
  setLabel(label: string): this;
}

/** A flat pixel button: filled rect, 1px dark outline, tiny5 label. (x, y) is the centre. */
export function makeButton(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number, label: string, onClick: () => void,
  color = 0x2d4a7a,
): Button {
  const left = -Math.floor(w / 2), top = -Math.floor(h / 2);
  const bg = scene.add.graphics();
  const draw = (fill: number) => {
    bg.clear();
    bg.fillStyle(fill).fillRect(left, top, w, h);
    border(bg, left, top, w, h, INK);
  };
  draw(color);
  const t = text(scene, 0, 0, label, { color: WHITE, originX: 0.5, originY: 0.5 });
  const c = scene.add.container(Math.round(x), Math.round(y), [bg, t]) as Button;
  c.setSize(w, h).setInteractive({ useHandCursor: true });
  let enabled = true;
  const hover = Phaser.Display.Color.ValueToColor(color).lighten(12).color;
  c.on("pointerover", () => enabled && draw(hover));
  c.on("pointerout", () => draw(color));
  c.on("pointerup", () => enabled && onClick());
  c.setEnabled = (on: boolean) => {
    enabled = on;
    c.setAlpha(on ? 1 : 0.4);
    return c;
  };
  c.setLabel = (s: string) => {
    t.setText(s);
    t.setPosition(Math.round(-t.width / 2), Math.round(-t.height / 2));
    return c;
  };
  return c;
}
