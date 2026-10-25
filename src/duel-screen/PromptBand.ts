import Phaser from "phaser";
import type { PromptButton } from "./BoardPick.ts";
import { FIELD, FIELD_CENTER, INSET, slotXY } from "./layout.ts";
import { text } from "../ui/pixel.ts";
import { THEME, ui } from "../ui/theme.ts";
import { LIST_BUTTON_H, makeListButton, type ListButton } from "../ui/widgets.ts";

/** Button plate on the Extra Deck slot: as wide as fits left of the Spell/Trap zones; light counter text. */
const BUTTON_PLATE_W = 56;

/**
 * The strip across the middle of the field with the prompt text, centred. Buttons (e.g. CONFIRM / CANCEL
 * while choosing on the board) go on a small dark plate over your Extra Deck slot, stacked, under an
 * optional counter line (e.g. "1/2").
 */
export class PromptBand {
  private scene: Phaser.Scene;
  private band: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.band = scene.add.container(0, 0).setDepth(800).setVisible(false);
  }

  /** `null` hides it. Returns the buttons (in order) and the counter, e.g. to update CONFIRM. */
  set(label: string | null, buttons: PromptButton[] = [], withCounter = false): { buttons: ListButton[]; counter: Phaser.GameObjects.BitmapText | null } {
    const scene = this.scene;
    this.band.removeAll(true).setVisible(!!label);
    const none = { buttons: [], counter: null };
    if (!label) return none;
    const top = FIELD_CENTER.y - 6;
    this.band.add(scene.add.rectangle(FIELD.left, top, FIELD.right - FIELD.left, LIST_BUTTON_H, THEME.prompt.strip, THEME.prompt.stripAlpha).setOrigin(0));
    this.band.add(text(scene, FIELD_CENTER.x, top + 3, label.toUpperCase(), { color: THEME.prompt.text, originX: 0.5 }));
    if (!buttons.length) return none;
    // Plate: the theme's "menu-back" (INSET.plate rim) + 2px padding around the buttons, 1px between them.
    const { x: cx, y: cy } = slotXY(0, { kind: "extra" });
    const rim = INSET.plate, pad = 2, ps = THEME.plate.slice;
    const w = BUTTON_PLATE_W, btnW = w - 2 * (rim + pad);
    const counterH = withCounter ? 8 : 0; // 5px text + gap
    const h = 2 * (rim + pad) + counterH + buttons.length * (LIST_BUTTON_H + 1) - 1;
    const left = Math.round(cx - w / 2), plateTop = Math.round(cy - h / 2);
    this.band.add(scene.add.nineslice(left, plateTop, ui("menu-back"), undefined, w, h, ps, ps, ps, ps).setOrigin(0));
    const counter = withCounter ? text(scene, cx, plateTop + rim + pad + 1, "", { color: THEME.plate.ink, originX: 0.5 }) : null;
    if (counter) this.band.add(counter);
    const buttonsTop = plateTop + rim + pad + counterH;
    return {
      counter,
      buttons: buttons.map((b, i) => {
        const btn = makeListButton(scene, left + rim + pad, buttonsTop + i * (LIST_BUTTON_H + 1), btnW, b.label, b.onClick);
        if (b.enabled === false) btn.setEnabled(false);
        this.band.add(btn);
        return btn;
      }),
    };
  }
}
