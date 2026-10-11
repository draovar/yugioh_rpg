import Phaser from "phaser";
import { INK, WHITE, border, text } from "./pixel.ts";
import { THEME, ui } from "./theme.ts";

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
 * Small raised button made from the phase-column sprites (theme), top-left at (x, y). Shows the pressed
 * frame while held and fires on release. Height 18 leaves a 6px face for one line of tiny5 text.
 */
export function makeWoodButton(scene: Phaser.Scene, x: number, y: number, w: number, label: string, onClick: () => void): WoodButton {
  const h = 18;
  const look = THEME.woodButton;
  const raised = { key: ui("phase-clickable"), ...look.raised };
  const pressed = { key: ui("phase-idle"), ...look.pressed };
  const box = scene.add.nineslice(x, y, raised.key, undefined, w, h, ...raised.slice).setOrigin(0);
  const t = text(scene, x + w / 2, y + raised.textY, label, { color: look.ink, originX: 0.5 });
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

/** List-row buttons ("menu-button", "menu-button-hover" sprites of the theme). */
export const LIST_BUTTON_H = THEME.listButton.h;
const LIST_SLICE = THEME.listButton.slice;
const LIST_INK = { normal: THEME.listButton.ink, hover: THEME.listButton.inkHover };

/** A list-row button's parts (frame, label, hit zone), to add to a container, plus enabled/label setters. */
export type ListButton = Phaser.GameObjects.GameObject[] & { setEnabled(on: boolean): void; setLabel(label: string): void };

/**
 * A list-row button, top-left at (x, y), 11px tall: darker on hover, fires on release. Returns its parts
 * for the caller to add to a container; the label needs w >= text width + 4. Disabled: faded, inert.
 */
export function makeListButton(
  scene: Phaser.Scene, x: number, y: number, w: number, label: string, onClick: () => void,
): ListButton {
  const box = scene.add.nineslice(x, y, ui("menu-button"), undefined, w, LIST_BUTTON_H, LIST_SLICE, LIST_SLICE, LIST_SLICE, LIST_SLICE).setOrigin(0);
  const t = text(scene, x + w / 2, y + THEME.listButton.textY, label.toUpperCase(), { color: LIST_INK.normal, originX: 0.5 });
  let enabled = true;
  const hover = (on: boolean) => {
    box.setTexture(ui(on ? "menu-button-hover" : "menu-button")).setSlices(w, LIST_BUTTON_H, LIST_SLICE, LIST_SLICE, LIST_SLICE, LIST_SLICE);
    t.setTint(on ? LIST_INK.hover : LIST_INK.normal);
  };
  const hit = scene.add.zone(x, y, w, LIST_BUTTON_H).setOrigin(0).setInteractive({ useHandCursor: true });
  hit.on("pointerover", () => enabled && hover(true));
  hit.on("pointerout", () => hover(false));
  hit.on("pointerup", () => enabled && onClick());
  return Object.assign([box, t, hit], {
    setEnabled(on: boolean) {
      enabled = on;
      if (!on) hover(false);
      box.setAlpha(on ? 1 : 0.5);
      t.setAlpha(on ? 1 : 0.5);
      if (hit.input) hit.input.cursor = on ? "pointer" : "default";
    },
    setLabel(s: string) {
      t.setText(s.toUpperCase()).setX(Math.round(x + w / 2 - t.width / 2));
    },
  });
}
