import Phaser from "phaser";
import { CARD_BACK } from "../duel-screen/CardSprite.ts";

/** Card back size (assets/cards/back.png). */
const CARD_W = 38, CARD_H = 56;
const COLS = Math.ceil(640 / CARD_W), ROWS = Math.ceil(360 / CARD_H);
/** The grid is centred, so the cut-off edges are even on both sides. */
const LEFT = Math.round((640 - COLS * CARD_W) / 2), TOP = Math.round((360 - ROWS * CARD_H) / 2);
/** Delay between diagonals of the wave, and how long one card takes to flip. */
const STEP_MS = 25, FLIP_MS = 120;
/** Covered for this long before the next scene starts. */
const HOLD_MS = 150;

/**
 * Screen transition between scenes: a wave of card backs flips in from the top-left until they cover the screen, the
 * next scene starts underneath, then the wave flips them away again. Always drawn above every other scene.
 */
export class Transition extends Phaser.Scene {
  /** Covering, covered or uncovering: the scene underneath should ignore input. */
  active = false;
  private cards: Phaser.GameObjects.Image[] = [];
  /** Black under the cards once they cover the screen (the card backs' rounded corners). */
  private backdrop!: Phaser.GameObjects.Rectangle;
  /** Takes every click while a transition plays, so none reach the scene underneath. */
  private blocker!: Phaser.GameObjects.Zone;

  constructor() {
    super("Transition");
  }

  create() {
    this.backdrop = this.add.rectangle(0, 0, 640, 360, 0x000000).setOrigin(0).setVisible(false);
    this.cards = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const card = this.add.image(LEFT + col * CARD_W + CARD_W / 2, TOP + row * CARD_H + CARD_H / 2, CARD_BACK)
          .setScale(0, 1).setVisible(false);
        card.setData("wave", col + row);
        this.cards.push(card);
      }
    }
    this.blocker = this.add.zone(0, 0, 640, 360).setOrigin(0);
  }

  /** Card backs flip in, diagonal by diagonal, until they cover the screen. */
  async cover() {
    this.active = true;
    this.scene.bringToTop();
    this.blocker.setInteractive();
    await this.wave(0, 1);
    this.backdrop.setVisible(true);
    await this.wait(HOLD_MS);
  }

  /** The card backs flip away in the same order, uncovering the scene underneath. */
  async uncover() {
    this.backdrop.setVisible(false);
    await this.wave(1, 0);
    for (const card of this.cards) card.setVisible(false);
    this.blocker.disableInteractive();
    this.active = false;
  }

  private wave(from: number, to: number) {
    return Promise.all(this.cards.map((card) => new Promise<void>((resolve) => {
      card.setScale(from, 1).setVisible(true);
      this.tweens.add({
        targets: card, scaleX: to, duration: FLIP_MS, delay: (card.getData("wave") as number) * STEP_MS,
        ease: to ? "Quad.Out" : "Quad.In", onComplete: () => resolve(),
      });
    })));
  }

  private wait(ms: number) {
    return new Promise<void>((resolve) => this.time.delayedCall(ms, resolve));
  }
}

/** The Transition scene (Boot launches it, it runs for the whole game). */
const transitionScene = (game: Phaser.Game) => game.scene.getScene("Transition") as Transition;

/** A transition is playing: the scenes underneath ignore input and keep still. */
export function transitioning(game: Phaser.Game): boolean {
  return transitionScene(game).active;
}

/**
 * `from` hands over to scene `key` (started with `data`) behind the card wave: cover, start, uncover once the new
 * scene has been created (`key` "" = cover and uncover the scene itself, for the `&anims` preview). `onCovered`
 * runs once the screen is covered, just before the switch.
 */
export async function transitionTo(from: Phaser.Scene, key: string, data?: object, opts: { onCovered?: () => void } = {}) {
  const game = from.game, t = transitionScene(game);
  if (t.active) return;
  await t.cover();
  opts.onCovered?.();
  if (!key) {
    // Preview (`&anims`): no scene switch.
    await new Promise<void>((resolve) => from.time.delayedCall(300, resolve));
    return t.uncover();
  }
  const next = game.scene.getScene(key)!;
  next.events.once(Phaser.Scenes.Events.CREATE, () => void t.uncover());
  from.scene.start(key, data);
}
