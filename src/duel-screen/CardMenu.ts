// Card action menu: the clicked card flips over to a card-sized frame (the theme's "card-menu" sprite) with
// its actions (SUMMON, SET, USE...) and BACK as list-row buttons. Closing flips the card face-up again.
import Phaser from "phaser";
import { THEME, ui } from "../ui/theme.ts";
import { LIST_BUTTON_H, makeListButton } from "../ui/widgets.ts";
import type { CardSprite } from "./CardSprite.ts";
import { CARD, INSET } from "./layout.ts";

/** Buttons sit this far inside the frame's edge. */
const BACK_RIM = INSET.plate;
/**
 * List-row buttons sit inside the frame's rim (x 3-34), leaving a 30px face for the label; four (11px + 1px
 * gap) fit in the frame's 50px interior.
 */
const BTN_W = CARD.w - 2 * BACK_RIM;
const BTN_H = LIST_BUTTON_H;
const GAP = 1;
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
    const slice = THEME.cardMenu.slice;
    const back = scene.add.nineslice(0, 0, ui("card-menu"), undefined, CARD.w, CARD.h, slice, slice, slice, slice)
      .setInteractive();
    back.on("pointerup", () => this.close());
    this.add(back);
    // The card's actions, then BACK, centred on the card.
    const all = [...actions, { label: "Back", onClick: () => this.close() }];
    const top = Math.round(-(all.length * (BTN_H + GAP) - GAP) / 2);
    all.forEach((a, i) => this.add(makeListButton(scene, -BTN_W / 2, top + i * (BTN_H + GAP), BTN_W, a.label, a.onClick)));
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
