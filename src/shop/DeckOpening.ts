// Opening a bought deck (the deck shop's BUY), over the shop: on the left the deck editor's table, top bar and mat
// (deck-editor/deckMat.ts), on the right the duel's card info panel. The deck's box comes in on the mat, wiggles
// and bursts open: its cards rise out of it face down and are dealt to the places the deck editor gives them (Main
// Deck rows, Extra Deck row), then turn over in a wave; the foils (Rares and up) turn last, one by one, with the pack
// opening's rarity effects (revealFx.ts), each shown in the info panel, and keep their glow. Hovering or tapping a
// face-up card shows it there. A click, Esc, Enter, Space or X hurries it all along. Then the bar offers SAVE AS DECK
// (`onSave`: one of the custom deck slots) and DONE (Esc).
import Phaser from "phaser";
import type { Engine } from "../duel/engine/loadEngine.ts";
import { CardInfo } from "../duel-screen/CardInfo.ts";
import { CardSprite } from "../duel-screen/CardSprite.ts";
import { CARD, INFO, INSET, LIST_BUTTON } from "../duel-screen/layout.ts";
import { pause, playTween } from "../duel-screen/tweens.ts";
import { deckPlaces, deckSlots, drawDeckTable } from "../deck-editor/deckMat.ts";
import { BAR, FELT } from "../deck-editor/layout.ts";
import { fit, FONT_UI, measure, text } from "../ui/pixel.ts";
import { THEME, ui } from "../ui/theme.ts";
import { makeListButton, type ListButton } from "../ui/widgets.ts";
import { rarityLook } from "./boosters.ts";
import { DETAILS } from "./PackOpening.ts";
import { glow, revealShow, shake, type FxCard, type FxHost } from "./revealFx.ts";

export interface DeckOpeningOptions {
  /** The box picture and how big it's drawn (the large one at 1x, else the pegboard's at 2x); null: the cards are dealt
   * straight away. */
  box: { key: string; scale: number } | null;
  title: string;
  /** The deck: a passcode per copy. */
  main: number[];
  extra: number[];
  /** Each card's rarity in the deck. */
  rarity: Map<number, string>;
  engine: Engine;
  /** Saves the deck as a custom deck slot: whether it was, and the line the bar shows. */
  onSave: () => { saved: boolean; message: string };
  onClose: () => void;
}

interface Laid extends FxCard {
  code: number;
  sprite: CardSprite;
  faceUp: boolean;
}

const SPLIT = 640 - INFO.w;
/** The box comes in the middle of the mat. */
const CENTER = { x: SPLIT / 2, y: FELT.y + Math.round(FELT.h / 2) };
/** The overlay; the info panel above it. */
const DEPTH = 100;
const T = {
  shade: 150, enter: 200, wiggle: 50, burst: 120, rise: 300, deal: 160, dealStagger: 25, flip: 70, waveStagger: 18,
  foilGap: 300, close: 150,
};
/** Hurried (a click or a key): everything still to come plays this much faster. */
const HURRY = 12;
/** The bar's buttons: SAVE AS DECK, DONE, at its right end. */
const SAVE_W = 60, DONE_W = 32, GAP = 3;

export class DeckOpening {
  private readonly scene: Phaser.Scene;
  private readonly opts: DeckOpeningOptions;
  private readonly root: Phaser.GameObjects.Container;
  private readonly layer: Phaser.GameObjects.Container;
  private readonly panel: Phaser.GameObjects.Container;
  private readonly info: CardInfo;
  private readonly hint: Phaser.GameObjects.BitmapText;
  private readonly status: Phaser.GameObjects.BitmapText;
  private cards: Laid[] = [];
  /** Glows and shines on the foils, until the deck is put away. */
  private readonly loops: (Phaser.Time.TimerEvent | Phaser.Tweens.Tween)[] = [];
  private save: ListButton | null = null;
  private speed = 1;
  private finished = false;
  private closed = false;

  constructor(scene: Phaser.Scene, opts: DeckOpeningOptions) {
    this.scene = scene;
    this.opts = opts;
    this.root = scene.add.container(0, 0).setDepth(DEPTH).setAlpha(0);
    // Takes every click, so the shop under it doesn't react; a click hurries the opening along.
    const blocker = scene.add.zone(0, 0, 640, 360).setOrigin(0).setInteractive();
    blocker.on("pointerup", () => this.hurry());
    const table = scene.add.container(0, 0);
    drawDeckTable(scene, table);
    const textY = BAR.y + INSET.plate + LIST_BUTTON.textY;
    const ink = THEME.plate.ink;
    const title = text(scene, BAR.x + INSET.plate + 2, textY, fit(scene, FONT_UI, opts.title.toUpperCase(), 180), { color: ink });
    this.status = text(scene, 0, textY, "", { color: ink });
    this.layer = scene.add.container(0, 0);
    this.root.add([blocker, table, title, this.status, this.layer]);

    // The info panel: a hint until a card shows.
    this.info = new CardInfo(scene, opts.engine, DETAILS);
    this.hint = text(scene, DETAILS.x + DETAILS.w / 2, 176, "OPENING THE DECK", { color: THEME.panel.inkSoft, originX: 0.5 });
    this.panel = scene.add.container(0, 0, [
      scene.add.nineslice(SPLIT, 0, ui("info-frame"), undefined, INFO.w, 360, ...THEME.panel.infoSlice).setOrigin(0),
      this.info.container, this.hint,
    ]).setDepth(DEPTH + 1).setAlpha(0);
    void this.run();
  }

  /** Esc: DONE once it's laid out, else hurry; Enter / Space / X: hurry. */
  handleKey(code: string) {
    if (code === "Escape" && this.finished) this.close();
    else if (code === "Escape" || code === "Enter" || code === "Space" || code === "KeyX") this.hurry();
  }

  private hurry() {
    if (!this.finished) this.speed = HURRY;
  }

  private async run() {
    const sc = this.scene, cards = this.opts.engine.cards;
    await this.tween({ targets: [this.root, this.panel], alpha: 1, duration: T.shade });
    deckSlots(sc, this.layer, this.opts.main, this.opts.extra, cards);

    // The cards wait face down in a stack in the box (hidden until it opens), each with its place on the mat.
    this.cards = deckPlaces(this.opts.main, this.opts.extra, cards).map((p) => {
      const sprite = new CardSprite(sc, CENTER.x, CENTER.y).show(0, undefined, { back: true }).setVisible(false);
      this.layer.add(sprite);
      return { code: p.code, sprite, x: p.x + CARD.w / 2, y: p.y + CARD.h / 2, w: CARD.w, h: CARD.h, tight: true, faceUp: false };
    });
    if (this.opts.box) await this.burstOpen(this.opts.box.key, this.opts.box.scale);
    else {
      for (const c of this.cards) c.sprite.setVisible(true);
      await this.tween({ targets: this.cards.map((c) => c.sprite), y: CENTER.y - 60, duration: T.rise });
    }
    if (this.closed) return;
    await this.deal();
    if (this.closed) return;
    for (const c of this.cards) {
      const zone = this.scene.add.zone(c.x - CARD.w / 2, c.y - CARD.h / 2, CARD.w, CARD.h).setOrigin(0).setInteractive();
      zone.on("pointerover", () => { if (c.faceUp) this.showDetails(c); });
      zone.on("pointerup", () => { if (c.faceUp) this.showDetails(c); else this.hurry(); });
      this.layer.add(zone);
    }

    // The commons turn over in a wave, then each foil on its own.
    const foils = this.cards.filter((c) => rarityLook(this.rarityOf(c)).tier >= 1);
    await this.oneByOne(this.cards.filter((c) => !foils.includes(c)), T.waveStagger, (c) => this.turn(c));
    for (const c of foils) {
      if (this.closed) return;
      await this.revealFoil(c);
      await this.wait(T.foilGap);
    }
    if (this.closed) return;
    this.finish();
  }

  /** The box comes in, wiggles and bursts open: the cards jump out of it while it drops away. */
  private async burstOpen(key: string, scale: number) {
    const sc = this.scene;
    const box = sc.add.image(CENTER.x, CENTER.y + 12, key).setScale(scale).setAlpha(0);
    this.layer.add(box);
    await this.tween({ targets: box, y: CENTER.y, alpha: 1, duration: T.enter });
    await this.wait(150);
    for (const dx of [2, -2, 2, -2, 0]) {
      box.x = CENTER.x + dx;
      await this.wait(T.wiggle);
    }
    await this.tween({ targets: box, scaleX: scale * 1.06, scaleY: scale * 0.94, duration: T.burst, yoyo: true });
    const flash = sc.add.rectangle(CENTER.x, CENTER.y, box.displayWidth, box.displayHeight, 0xffffff, 0.7);
    this.layer.add(flash);
    void this.tween({ targets: flash, alpha: 0, duration: 250, onComplete: () => flash.destroy() });
    for (const c of this.cards) c.sprite.setVisible(true);
    await Promise.all([
      this.tween({ targets: this.cards.map((c) => c.sprite), y: CENTER.y - 90, duration: T.rise, ease: "Quad.Out" }),
      this.tween({ targets: box, y: "+=60", alpha: 0, duration: T.rise, ease: "Quad.In" }),
    ]);
    box.destroy();
  }

  /** Each card from the stack to its place, in the deck's order. */
  private async deal() {
    await this.oneByOne(this.cards, T.dealStagger, (c) =>
      this.tween({ targets: c.sprite, x: c.x, y: c.y, duration: T.deal, ease: "Quad.Out" }));
  }

  /** Starts `step` on each card `stagger` ms after the last (a hurry speeds up the rest), then waits for them all. */
  private async oneByOne(cards: Laid[], stagger: number, step: (c: Laid) => Promise<void>) {
    const steps: Promise<void>[] = [];
    for (const c of cards) {
      if (this.closed) break;
      steps.push(step(c));
      await this.wait(stagger);
    }
    await Promise.all(steps);
  }

  /** Turns a card over (squash to its centre line, swap the face). */
  private async turn(c: Laid) {
    await this.tween({ targets: c.sprite, scaleX: 0, duration: T.flip });
    if (this.closed || !c.sprite.active) return;
    c.sprite.show(c.code, this.opts.engine.cards.records.get(c.code));
    c.faceUp = true;
    await this.tween({ targets: c.sprite, scaleX: 1, duration: T.flip });
  }

  /** A foil: Super Rares and up glow and shake first; it turns over, shows in the info panel and makes its show. */
  private async revealFoil(c: Laid) {
    const look = rarityLook(this.rarityOf(c)), host = this.fxHost();
    if (look.tier >= 2) {
      glow(host, c, look.color, look.tier >= 4);
      if (this.speed === 1) await shake(host, c);
    }
    await this.turn(c);
    if (this.closed || !c.sprite.active) return;
    this.showDetails(c);
    revealShow(host, c, look);
  }

  private rarityOf(c: Laid) {
    return this.opts.rarity.get(c.code) ?? "Common";
  }

  /** The deck is laid out: SAVE AS DECK and DONE on the bar. */
  private finish() {
    this.finished = true;
    const y = BAR.y + INSET.plate, right = BAR.x + BAR.w - INSET.plate;
    this.save = makeListButton(this.scene, right - DONE_W - GAP - SAVE_W, y, SAVE_W, "SAVE AS DECK", () => {
      const result = this.opts.onSave();
      // Right-aligned just left of the buttons.
      const end = right - DONE_W - GAP - SAVE_W - GAP - 4;
      this.status.setText(result.message).setX(end - measure(this.scene, FONT_UI, result.message));
      if (result.saved) this.save?.setEnabled(false);
    });
    this.root.add([...this.save, ...makeListButton(this.scene, right - DONE_W, y, DONE_W, "DONE", () => this.close())]);
  }

  /** A face-up card in the info panel. */
  private showDetails(c: Laid) {
    if (this.closed) return;
    this.hint.setVisible(false);
    if (this.info.code !== c.code) this.info.show(c.code);
  }

  private fxHost(): FxHost {
    return { scene: this.scene, layer: this.layer, loops: this.loops, closed: () => this.closed };
  }

  private close() {
    if (this.closed) return;
    this.closed = true;
    for (const l of this.loops) l instanceof Phaser.Time.TimerEvent ? l.remove() : l.stop();
    void this.tween({
      targets: [this.root, this.panel], alpha: 0, duration: T.close,
      onComplete: () => {
        this.scene.tweens.killTweensOf(this.layer.list);
        this.info.clear();
        this.root.destroy();
        this.panel.destroy();
        this.opts.onClose();
      },
    });
  }

  private tween(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return playTween(this.scene, config, this.speed);
  }

  private wait(ms: number): Promise<void> {
    return pause(this.scene, ms, this.speed);
  }
}
