// Card action menu: the clicked card flips over to a card-sized dark Runewood frame (Frame01a) with
// its actions (SUMMON, SET, USE...) and BACK as list-row buttons (FrameList09a, FrameList09c on hover),
// from Crusenho's Complete UI Essential Pack (CC BY 4.0). Closing flips the card face-up again.
import Phaser from "phaser";
import { text } from "../pixel.ts";
import type { CardSprite } from "./CardSprite.ts";
import { CARD } from "./layout.ts";

export const MENU_TEXTURES = ["menu-back", "menu-button", "menu-button-hover"];

/** Frame01a: 3px rim with 3x3 corners. */
const BACK_SLICE = 3;
/**
 * FrameList09a/c, 64x11: 1px outline with 2px corners. Buttons sit inside the frame's rim (x 3-34), leaving
 * a 30px face for the label; four (11px + 1px gap) fit in the frame's 50px interior.
 */
const BTN_SLICE = 2;
const BTN_W = CARD.w - 2 * BACK_SLICE;
const BTN_H = 11;
const GAP = 1;
const TEXT_Y = 3;
const INK = { normal: 0x2a1408, hover: 0xf2c096 };
/** Half of each flip (squash to the centre line, open from it). */
const FLIP_MS = 50;

export interface MenuAction {
  label: string;
  onClick: () => void;
}

export class CardMenu extends Phaser.GameObjects.Container {
  private card: CardSprite | null;

  constructor(scene: Phaser.Scene, card: CardSprite, actions: MenuAction[]) {
    super(scene, card.x, card.y);
    this.card = card;
    // Clicking the frame (between the buttons) flips the card face-up again.
    const back = scene.add.nineslice(0, 0, "ui-menu-back", undefined, CARD.w, CARD.h, BACK_SLICE, BACK_SLICE, BACK_SLICE, BACK_SLICE)
      .setInteractive();
    back.on("pointerup", () => this.close());
    this.add(back);
    // The card's actions, then BACK, centred on the card.
    const all = [...actions, { label: "Back", onClick: () => this.close() }];
    const top = Math.round(-(all.length * (BTN_H + GAP) - GAP) / 2);
    all.forEach((a, i) => this.addButton(-BTN_W / 2, top + i * (BTN_H + GAP), a));
    this.setDepth(900);
    scene.add.existing(this);

    // Flip: the card squashes to its centre line, the menu opens out of it.
    this.scaleX = 0;
    scene.tweens.killTweensOf(card); // e.g. still flipping back from a menu closed a moment ago
    scene.tweens.add({
      targets: card, scaleX: 0, duration: FLIP_MS,
      onComplete: () => {
        if (!this.active) return;
        card.setVisible(false).setScale(1);
        scene.tweens.add({ targets: this, scaleX: 1, duration: FLIP_MS });
      },
    });
  }

  private addButton(x: number, y: number, a: MenuAction) {
    const box = this.scene.add.nineslice(x, y, "ui-menu-button", undefined, BTN_W, BTN_H, BTN_SLICE, BTN_SLICE, BTN_SLICE, BTN_SLICE).setOrigin(0);
    const t = text(this.scene, x + BTN_W / 2, y + TEXT_Y, a.label.toUpperCase(), { color: INK.normal, originX: 0.5 });
    const hover = (on: boolean) => {
      box.setTexture(on ? "ui-menu-button-hover" : "ui-menu-button").setSlices(BTN_W, BTN_H, BTN_SLICE, BTN_SLICE, BTN_SLICE, BTN_SLICE);
      t.setTint(on ? INK.hover : INK.normal);
    };
    const hit = this.scene.add.zone(x, y, BTN_W, BTN_H).setOrigin(0).setInteractive({ useHandCursor: true });
    hit.on("pointerover", () => hover(true));
    hit.on("pointerout", () => hover(false));
    hit.on("pointerup", () => a.onClick());
    this.add([box, t, hit]);
  }

  /**
   * Removes the menu and shows the card again (if it's still on the board). Animated: the reverse flip,
   * the menu squashes to its centre line and the card opens out of it. Instant when an action was chosen
   * (the card is about to move anyway).
   */
  close(animate = true) {
    const card = this.card;
    if (!this.active || !card) return; // already closing
    this.card = null;
    const scene = this.scene;
    scene.tweens.killTweensOf([this, card]);
    for (const o of this.list) o.disableInteractive();
    const open = () => {
      if (!card.active) return;
      if (!animate) return void card.setVisible(true).setScale(1);
      if (!card.visible) card.setVisible(true).setScale(0, 1); // else: still squashing, just reopen it
      scene.tweens.add({ targets: card, scaleX: 1, duration: FLIP_MS });
    };
    if (!animate || this.scaleX === 0) {
      this.destroy();
      open();
      return;
    }
    scene.tweens.add({ targets: this, scaleX: 0, duration: FLIP_MS, onComplete: () => { this.destroy(); open(); } });
  }
}
