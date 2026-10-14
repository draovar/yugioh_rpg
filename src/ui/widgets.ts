import Phaser from "phaser";
import { INK, WHITE, border, text } from "./pixel.ts";
import { THEME, ui } from "./theme.ts";
import { LIST_BUTTON } from "./duel/layout.ts";

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

/** One choice in a `makeDropUp` list. */
export interface DropUpOption<T> {
  value: T;
  label: string;
}

/**
 * A flat button showing the current choice (left-aligned label, ▲ on the right). Clicking it opens the list of
 * choices above it, the current one in `pickedColor`; picking one, clicking elsewhere or Esc closes it.
 * (x, y) is the button's centre, like `makeButton`.
 */
export function makeDropUp<T>(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number, options: DropUpOption<T>[], current: T,
  onPick: (value: T) => void, color = 0x2d4a7a, pickedColor = 0x3f7a3a,
): Button {
  const labelOf = (v: T) => (options.find((o) => o.value === v)?.label ?? "").toUpperCase();
  let list: Phaser.GameObjects.Container | null = null;
  let value = current;
  const close = () => {
    list?.destroy();
    list = null;
    scene.input.keyboard?.off("keydown-ESC", close);
  };
  const open = () => {
    if (list) return close();
    const pitch = h + 1, left = Math.round(x - w / 2), bottom = Math.round(y - h / 2) - 2;
    // Invisible full-screen catcher under the rows: a click anywhere else just closes the list.
    const catcher = scene.add.zone(0, 0, scene.scale.width, scene.scale.height).setOrigin(0).setInteractive();
    catcher.on("pointerup", close);
    const rows = options.map((o, i) => {
      const rowY = bottom - (options.length - i) * pitch + Math.floor(h / 2);
      return makeButton(scene, left + Math.floor(w / 2), rowY, w, h, o.label.toUpperCase(), () => {
        close();
        if (o.value === value) return;
        value = o.value;
        button.setLabel(labelOf(value));
        onPick(value);
      }, o.value === value ? pickedColor : color);
    });
    list = scene.add.container(0, 0, [catcher, ...rows]).setDepth(1000);
    scene.input.keyboard?.on("keydown-ESC", close);
  };
  const button = makeButton(scene, x, y, w, h, "", open, color);
  const t = button.list[1] as Phaser.GameObjects.BitmapText;
  const arrow = scene.add.graphics().fillStyle(0xffffff);
  // 5x3 up-pointing triangle, 4px from the right edge.
  const ax = Math.floor(w / 2) - 9, ay = -1;
  arrow.fillRect(ax + 2, ay, 1, 1).fillRect(ax + 1, ay + 1, 3, 1).fillRect(ax, ay + 2, 5, 1);
  button.add(arrow);
  button.setLabel = (s: string) => {
    t.setText(s);
    t.setPosition(-Math.floor(w / 2) + 4, Math.round(-t.height / 2));
    return button;
  };
  button.setLabel(labelOf(value));
  button.once("destroy", close);
  return button;
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

/** List-row buttons ("menu-button", "menu-button-hover" sprites of the theme); size is global. */
export const LIST_BUTTON_H = LIST_BUTTON.h;

/** A list-row button's parts (frame, label, hit zone), to add to a container, plus enabled/label/highlight setters. */
export type ListButton = Phaser.GameObjects.GameObject[] & {
  setEnabled(on: boolean): void;
  setLabel(label: string): void;
  /** Keeps the hover look on without the pointer (e.g. the row picked with the arrow keys). */
  setHighlighted(on: boolean): void;
};

/**
 * A list-row button, top-left at (x, y), 11px tall: darker on hover, fires on release. Returns its parts
 * for the caller to add to a container; the label needs w >= text width + 4. Disabled: faded, inert.
 */
export function makeListButton(
  scene: Phaser.Scene, x: number, y: number, w: number, label: string, onClick: () => void,
): ListButton {
  const slice = THEME.listButton.slice, ink = THEME.listButton.ink, inkHover = THEME.listButton.inkHover;
  const box = scene.add.nineslice(x, y, ui("menu-button"), undefined, w, LIST_BUTTON_H, slice, slice, slice, slice).setOrigin(0);
  const t = text(scene, x + w / 2, y + LIST_BUTTON.textY, label.toUpperCase(), { color: ink, originX: 0.5 });
  let enabled = true, highlighted = false;
  const hover = (on: boolean) => {
    box.setTexture(ui(on ? "menu-button-hover" : "menu-button")).setSlices(w, LIST_BUTTON_H, slice, slice, slice, slice);
    t.setTint(on ? inkHover : ink);
  };
  const hit = scene.add.zone(x, y, w, LIST_BUTTON_H).setOrigin(0).setInteractive({ useHandCursor: true });
  hit.on("pointerover", () => enabled && hover(true));
  hit.on("pointerout", () => hover(highlighted));
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
    setHighlighted(on: boolean) {
      highlighted = on;
      hover(on);
    },
  });
}
