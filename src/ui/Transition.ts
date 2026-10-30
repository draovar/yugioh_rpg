import Phaser from "phaser";
import { CARD_BACK } from "../duel-screen/CardSprite.ts";
import { HEIGHT, WIDTH, onViewResize } from "./view.ts";

/** Card back size (assets/cards/back.png). */
const CARD_W = 38, CARD_H = 56;
/** The grid of card backs covering a `width` x `height` screen, centred so the cut-off edges are even on both sides. */
const grid = (width: number, height: number) => {
  const cols = Math.ceil(width / CARD_W), rows = Math.ceil(height / CARD_H);
  return { cols, rows, left: Math.round((width - cols * CARD_W) / 2), top: Math.round((height - rows * CARD_H) / 2) };
};
/**
 * How long the wave takes to sweep from the first diagonal to the last, the same on any screen size (25 ms a
 * diagonal on the 640x360 one), and how long one card takes to flip.
 */
const SWEEP_MS = (grid(WIDTH, HEIGHT).cols + grid(WIDTH, HEIGHT).rows - 2) * 25, FLIP_MS = 120;
/** Covered for this long before the next scene starts. */
const HOLD_MS = 150;

/**
 * Screen transition between scenes: a wave of card backs flips in from the top-left until they cover the screen, the
 * next scene starts underneath, then the wave flips them away again. Always drawn above every other scene. The
 * overworld's view and the duel's differ in size (src/ui/view.ts): the grid is laid out again for the new size while
 * the screen is covered.
 */
export class Transition extends Phaser.Scene {
  /** Covering, covered or uncovering: the scene underneath should ignore input. */
  active = false;
  private cards: Phaser.GameObjects.Image[] = [];
  /** Black under the cards once they cover the screen (the card backs' rounded corners). */
  private backdrop!: Phaser.GameObjects.Rectangle;
  /** Takes every click while a transition plays, so none reach the scene underneath. */
  private blocker!: Phaser.GameObjects.Zone;
  /** Cards are flipping: the grid waits for the wave to end before it's laid out again. */
  private flipping = false;
  /** The screen size the grid was laid out for. */
  private laidOut = { width: 0, height: 0 };
  private stepMs = 0;

  constructor() {
    super("Transition");
  }

  create() {
    this.backdrop = this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x000000).setOrigin(0).setVisible(false);
    this.blocker = this.add.zone(0, 0, WIDTH, HEIGHT).setOrigin(0);
    this.layout();
    onViewResize(this, () => {
      if (!this.flipping) this.layout();
    });
  }

  /** The grid for the current screen size, every card shown as covering (or not) as before. */
  private layout() {
    const { width, height } = this.scale;
    if (width === this.laidOut.width && height === this.laidOut.height) return;
    this.laidOut = { width, height };
    const covered = this.cards[0]?.visible ?? false;
    for (const card of this.cards) card.destroy();
    this.cards = [];
    const { cols, rows, left, top } = grid(width, height);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const card = this.add.image(left + col * CARD_W + CARD_W / 2, top + row * CARD_H + CARD_H / 2, CARD_BACK)
          .setScale(covered ? 1 : 0, 1).setVisible(covered);
        card.setData("wave", col + row);
        this.cards.push(card);
      }
    }
    this.stepMs = SWEEP_MS / Math.max(1, cols + rows - 2);
    this.backdrop.setSize(width, height);
    this.blocker.setSize(width, height); // its hit area too
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

  private async wave(from: number, to: number) {
    // A window resized mid-wave: the grid catches up here.
    this.layout();
    this.flipping = true;
    await Promise.all(this.cards.map((card) => new Promise<void>((resolve) => {
      card.setScale(from, 1).setVisible(true);
      this.tweens.add({
        targets: card, scaleX: to, duration: FLIP_MS, delay: (card.getData("wave") as number) * this.stepMs,
        ease: to ? "Quad.Out" : "Quad.In", onComplete: () => resolve(),
      });
    })));
    this.flipping = false;
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
