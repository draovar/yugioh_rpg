import Phaser from "phaser";

export const FONT = "Verdana, Arial, sans-serif";

export interface Button extends Phaser.GameObjects.Container {
  setEnabled(on: boolean): this;
}

/** A simple rounded button. Disabled buttons are dimmed and ignore clicks. */
export function makeButton(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number, label: string, onClick: () => void,
  color = 0x2d4a7a,
): Button {
  const bg = scene.add.graphics();
  const draw = (fill: number) => {
    bg.clear();
    bg.fillStyle(fill).fillRoundedRect(-w / 2, -h / 2, w, h, 6);
    bg.lineStyle(1, 0xffffff, 0.35).strokeRoundedRect(-w / 2, -h / 2, w, h, 6);
  };
  draw(color);
  const text = scene.add.text(0, 0, label, { fontFamily: FONT, fontSize: "15px", color: "#ffffff", align: "center", wordWrap: { width: w - 10 } }).setOrigin(0.5);
  const c = scene.add.container(x, y, [bg, text]) as Button;
  c.setSize(w, h).setInteractive({ useHandCursor: true });
  let enabled = true;
  c.on("pointerover", () => enabled && draw(Phaser.Display.Color.ValueToColor(color).lighten(15).color));
  c.on("pointerout", () => draw(color));
  c.on("pointerup", () => enabled && onClick());
  c.setEnabled = (on: boolean) => {
    enabled = on;
    c.setAlpha(on ? 1 : 0.35);
    return c;
  };
  return c;
}
