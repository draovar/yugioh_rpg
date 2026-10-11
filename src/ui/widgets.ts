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

export interface WoodButton {
  setLabel(label: string): void;
}

/**
 * Small raised Runewood button (the phase-column sprites), top-left at (x, y). Shows the pressed frame
 * while held and fires on release. Height 18 leaves a 6px face for one line of tiny5 text.
 */
export function makeWoodButton(scene: Phaser.Scene, x: number, y: number, w: number, label: string, onClick: () => void): WoodButton {
  const h = 18;
  // Raised: 5 rows of rim above the face, 7 of side below. Pressed: face 3px lower.
  const raised = { key: "ui-phase-clickable", slice: [4, 4, 5, 7] as const, textY: 5 };
  const pressed = { key: "ui-phase-idle", slice: [4, 4, 8, 4] as const, textY: 8 };
  const box = scene.add.nineslice(x, y, raised.key, undefined, w, h, ...raised.slice).setOrigin(0);
  const t = text(scene, x + w / 2, y + raised.textY, label, { color: 0x3b2414, originX: 0.5 });
  const press = (down: boolean) => {
    const look = down ? pressed : raised;
    box.setTexture(look.key).setSlices(w, h, ...look.slice);
    t.setY(y + look.textY);
  };
  const hit = scene.add.zone(x, y, w, h).setOrigin(0).setInteractive({ useHandCursor: true });
  hit.on("pointerdown", () => press(true));
  hit.on("pointerout", () => press(false));
  hit.on("pointerup", () => { press(false); onClick(); });
  return {
    setLabel: (s: string) => { t.setText(s).setX(Math.round(x + w / 2 - t.width / 2)); },
  };
}

/** Runewood list-row button textures (FrameList09a, 09c on hover), 64x11: 1px outline, 2px corners. */
export const LIST_BUTTON_TEXTURES = ["menu-button", "menu-button-hover"];
export const LIST_BUTTON_H = 11;
const LIST_SLICE = 2;
const LIST_INK = { normal: 0x2a1408, hover: 0xf2c096 };

/**
 * A list-row button, top-left at (x, y), 11px tall: darker on hover, fires on release. Returns its parts
 * (frame, label, hit zone) for the caller to add to a container; the label needs w >= text width + 4.
 */
export function makeListButton(
  scene: Phaser.Scene, x: number, y: number, w: number, label: string, onClick: () => void,
): Phaser.GameObjects.GameObject[] {
  const box = scene.add.nineslice(x, y, "ui-menu-button", undefined, w, LIST_BUTTON_H, LIST_SLICE, LIST_SLICE, LIST_SLICE, LIST_SLICE).setOrigin(0);
  const t = text(scene, x + w / 2, y + 3, label.toUpperCase(), { color: LIST_INK.normal, originX: 0.5 });
  const hover = (on: boolean) => {
    box.setTexture(on ? "ui-menu-button-hover" : "ui-menu-button").setSlices(w, LIST_BUTTON_H, LIST_SLICE, LIST_SLICE, LIST_SLICE, LIST_SLICE);
    t.setTint(on ? LIST_INK.hover : LIST_INK.normal);
  };
  const hit = scene.add.zone(x, y, w, LIST_BUTTON_H).setOrigin(0).setInteractive({ useHandCursor: true });
  hit.on("pointerover", () => hover(true));
  hit.on("pointerout", () => hover(false));
  hit.on("pointerup", onClick);
  return [box, t, hit];
}
