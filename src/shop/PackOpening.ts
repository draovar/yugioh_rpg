// Opening booster packs (the shop's BUY), over the shop: on the left, over a dark shade, the pack comes in, wiggles,
// loses its top along a jagged line, the cards rise out of it and are dealt face down in two rows. Clicking (tapping) a
// card flips it; Enter / Space / X flip the next one, REVEAL ALL (Esc) the rest. Each makes the show of its rarity
// (revealFx.ts, shared with the deck unboxing) and gets its rarity chip under it once it's up.
// On the right, where the shop's checklist is, the duel's card info panel shows each card as it turns over, then
// whichever face-up card is hovered or tapped (OpeningPanel, shared with the deck unboxing).
// Several packs bought at once open one after another (the title counts them): NEXT PACK clears the cards away and
// tears the next one open; after the last, DONE (Esc) closes. The pulled cards aren't kept yet (no collection).
import Phaser from "phaser";
import type { Engine } from "../duel/engine/loadEngine.ts";
import { CardInfo } from "../duel-screen/CardInfo.ts";
import { CardSprite } from "../duel-screen/CardSprite.ts";
import { CARD, INFO, INSET } from "../duel-screen/layout.ts";
import { pause, playTween } from "../duel-screen/tweens.ts";
import { text } from "../ui/pixel.ts";
import { THEME, ui } from "../ui/theme.ts";
import { makeButton, type Button } from "../ui/widgets.ts";
import { rarityLook, type Pull } from "./boosters.ts";
import { glow, revealShow, shake, stopLoops, type FxCard, type FxHost, type FxLoop } from "./revealFx.ts";

/** The pack while it's opened, drawn at 1x (public/boosters/large/, `npm run build-boosters`). */
export const LARGE_PACK = { w: 100, h: 172 };
/** The tear runs this far under the pack's top (below the crimp), give or take JAG. */
const TEAR_Y = 16;
const JAG = [0, 1, 2, 1, 2, 0, -1, 0, 1, -1, 0, 2, 1, -1];
/** The card info panel on the right (the duel's info panel: board, then the details inside its rim). */
const SPLIT = 640 - INFO.w;
const DETAILS = { x: SPLIT + INSET.board + 2, w: INFO.w - 2 * (INSET.board + 2), top: INSET.board + 2, bottom: 360 - INSET.board - 2 };
/** Cards at 2x in two rows left of the panel, each one's rarity chip under it. */
const SCALE = 2, CARD_W = CARD.w * SCALE, CARD_H = CARD.h * SCALE, GAP = 6;
const ROW_TOPS = [28, 160];
const CHIP = { w: 17, h: 7 };
const CENTER = { x: SPLIT / 2, y: 184 };
/** The overlay; the panel above it (sparkles fly under it). */
const DEPTH = 100;
const T = {
  shade: 150, enter: 200, wiggle: 50, tear: 350, bits: 450, rise: 300, deal: 140, dealStagger: 70,
  flip: 70, revealAllStagger: 150, close: 150,
};

interface Dealt extends FxCard {
  pull: Pull;
  sprite: CardSprite;
  zone: Phaser.GameObjects.Zone;
  /** Turning over (or done). */
  revealed: boolean;
  /** Its face shows: its details may too. */
  faceUp: boolean;
  /** Its reveal has played out. */
  settled: boolean;
}

export interface PackOpeningOptions {
  /** The pack picture to tear open; null: the cards are dealt straight away. */
  packKey: string | null;
  title: string;
  /** One list of cards per pack bought, opened in this order. */
  packs: Pull[][];
  engine: Engine;
  onClose: () => void;
}

/**
 * An opening's card info panel on the right: the duel's (the UI theme's board), above the overlay, `hint` in it until a
 * card shows. It starts transparent, for the opening to fade in with the overlay.
 */
export class OpeningPanel {
  readonly root: Phaser.GameObjects.Container;
  private readonly info: CardInfo;
  private readonly hint: Phaser.GameObjects.BitmapText;

  constructor(scene: Phaser.Scene, engine: Engine, hint: string) {
    this.info = new CardInfo(scene, engine, DETAILS);
    this.hint = text(scene, DETAILS.x + DETAILS.w / 2, 176, hint, { color: THEME.panel.inkSoft, originX: 0.5 });
    this.root = scene.add.container(0, 0, [
      scene.add.nineslice(SPLIT, 0, ui("info-frame"), undefined, INFO.w, 360, ...THEME.panel.infoSlice).setOrigin(0),
      this.info.container, this.hint,
    ]).setDepth(DEPTH + 1).setAlpha(0);
  }

  /** A face-up card in the panel. */
  show(code: number) {
    this.hint.setVisible(false);
    if (this.info.code !== code) this.info.show(code);
  }

  /** Empty again, the hint back. */
  clear() {
    this.info.clear();
    this.hint.setVisible(true);
  }

  destroy() {
    this.info.clear();
    this.root.destroy();
  }
}

export class PackOpening {
  private readonly scene: Phaser.Scene;
  private readonly opts: PackOpeningOptions;
  private readonly root: Phaser.GameObjects.Container;
  private readonly panel: OpeningPanel;
  private title: Phaser.GameObjects.BitmapText | null = null;
  /** The pack being opened: its pieces, cards and their effects (cleared for the next pack). */
  private layer: Phaser.GameObjects.Container | null = null;
  private pack = 0;
  private cards: Dealt[] = [];
  private button: Button | null = null;
  /** Effects that run until the pack is put away. */
  private readonly loops: FxLoop[] = [];
  private dealt = false;
  private closed = false;

  constructor(scene: Phaser.Scene, opts: PackOpeningOptions) {
    this.scene = scene;
    this.opts = opts;
    this.root = scene.add.container(0, 0).setDepth(DEPTH);
    // Takes every click, so the shop under it doesn't react.
    this.root.add(scene.add.zone(0, 0, 640, 360).setOrigin(0).setInteractive());
    this.panel = new OpeningPanel(scene, opts.engine, "TURN A CARD OVER");
    void this.run();
  }

  /** Enter / Space / X: the next face-down card, else the button; Esc: the button (REVEAL ALL / NEXT PACK / DONE). */
  handleKey(code: string) {
    if (!this.dealt) return;
    if (code === "Escape") this.pressButton();
    else if (code === "Enter" || code === "Space" || code === "KeyX") {
      const next = this.cards.find((c) => !c.revealed);
      if (next) void this.reveal(next);
      else this.pressButton();
    }
  }

  private async run() {
    const sc = this.scene;
    const shade = sc.add.rectangle(0, 0, 640, 360, 0x000000, 0.88).setOrigin(0).setAlpha(0);
    this.title = text(sc, CENTER.x, 8, "", { color: 0xffffff, scale: 2 });
    this.root.add([shade, this.title]);
    await this.tween({ targets: [shade, this.panel.root], alpha: 1, duration: T.shade });
    await this.openPack();
  }

  /** Tears the current pack open and deals its cards. */
  private async openPack() {
    const sc = this.scene, n = this.opts.packs.length;
    const title = this.opts.title.toUpperCase() + (n > 1 ? `  ${this.pack + 1}/${n}` : "");
    this.title!.setText(title).setX(Math.round(CENTER.x - this.title!.width / 2));
    // Under the button (made after the first pack is dealt).
    this.layer = sc.add.container(0, 0);
    if (this.button) this.root.addAt(this.layer, this.root.getIndex(this.button));
    else this.root.add(this.layer);

    // The cards wait in a stack behind the pack, face down (hidden while the pack fades in over them).
    const pulls = this.opts.packs[this.pack];
    this.cards = pulls.map((pull, i) => {
      const sprite = new CardSprite(sc, CENTER.x, CENTER.y).show(0, undefined, { back: true }).setScale(SCALE).setVisible(false);
      this.layer!.add(sprite);
      const { x, y } = this.slot(i, pulls.length);
      const zone = sc.add.zone(x - CARD_W / 2, y - CARD_H / 2, CARD_W, CARD_H).setOrigin(0);
      return { pull, sprite, x, y, w: CARD_W, h: CARD_H, zone, revealed: false, faceUp: false, settled: false };
    });
    if (this.opts.packKey) await this.tearOpen(this.opts.packKey);
    else {
      for (const c of this.cards) c.sprite.setVisible(true);
      await this.tween({ targets: this.cards.map((c) => c.sprite), y: CENTER.y - 70, duration: T.rise });
    }
    if (this.closed) return;
    await this.deal();
    if (this.closed) return;

    for (const c of this.cards) {
      this.layer.add(c.zone);
      c.zone.setInteractive({ useHandCursor: true });
      // Face down: hovering lifts it, a click turns it over. Face up: hovering or tapping shows its details.
      c.zone.on("pointerover", () => {
        if (c.faceUp) this.showDetails(c);
        else if (!c.revealed) c.sprite.y = c.y - 3;
      });
      c.zone.on("pointerout", () => { if (!c.revealed) c.sprite.y = c.y; });
      c.zone.on("pointerup", () => {
        if (c.faceUp) this.showDetails(c);
        else void this.reveal(c);
      });
    }
    if (!this.button) {
      this.button = makeButton(sc, CENTER.x, 316, 80, 16, "", () => this.pressButton(), 0x5a3a24);
      this.root.add(this.button);
    }
    this.button.setLabel("REVEAL ALL").setVisible(true);
    this.dealt = true;
  }

  /** Centre of card i of n: the first row takes the larger half. */
  private slot(i: number, n: number) {
    const top = Math.ceil(n / 2);
    const row = i < top ? 0 : 1, k = row ? i - top : i, inRow = row ? n - top : top;
    const left = CENTER.x - (inRow * CARD_W + (inRow - 1) * GAP) / 2;
    return { x: Math.round(left + k * (CARD_W + GAP) + CARD_W / 2), y: ROW_TOPS[row] + CARD_H / 2 };
  }

  /** NEXT PACK: the turned cards fade away, the panel empties, the next pack comes in. */
  private async nextPack() {
    this.dealt = false;
    this.button?.setVisible(false);
    stopLoops(this.loops);
    const old = this.layer!;
    await this.tween({ targets: old, alpha: 0, duration: T.close });
    this.scene.tweens.killTweensOf(old.list);
    old.destroy();
    this.panel.clear();
    this.pack++;
    await this.openPack();
  }

  // --- The pack ---------------------------------------------------------------------------------------------------

  /** The pack comes in, wiggles, loses its top; the cards rise out of it while it drops away. */
  private async tearOpen(key: string) {
    const sc = this.scene, layer = this.layer!;
    const [lidKey, bodyKey] = this.tornPieces(key);
    const { width: w, height: h } = sc.textures.getFrame(key);
    const left = CENTER.x - Math.floor(w / 2), top = CENTER.y - Math.floor(h / 2);
    const body = sc.add.image(left, top + 12, bodyKey).setOrigin(0).setAlpha(0);
    // The torn-off top turns around the tear's right end.
    const pivot = { x: 0.9, y: TEAR_Y / h };
    const lid = sc.add.image(left + pivot.x * w, top + TEAR_Y + 12, lidKey).setOrigin(pivot.x, pivot.y).setAlpha(0);
    layer.add([body, lid]);
    await this.tween({ targets: [body, lid], y: "-=12", alpha: 1, duration: T.enter });
    for (const c of this.cards) c.sprite.setVisible(true);
    await this.wait(150);
    for (const dx of [1, -1, 1, -1, 0]) {
      body.x = left + dx;
      lid.x = left + pivot.x * w + dx;
      await this.wait(T.wiggle);
    }

    // Tear: the top flies off up and to the right, a few bits of foil fall from the tear.
    for (let i = 0; i < 6; i++) {
      const bit = sc.add.rectangle(left + 10 + i * 16, top + TEAR_Y, 2, 1, 0xd8d8d8).setOrigin(0);
      layer.add(bit);
      void this.tween({
        targets: bit, y: `+=${20 + (i % 3) * 10}`, x: `+=${(i % 2 ? 1 : -1) * (4 + i)}`, alpha: 0, duration: T.bits,
        onComplete: () => bit.destroy(),
      });
    }
    await this.tween({ targets: lid, x: "+=30", y: "-=26", angle: 28, alpha: 0, duration: T.tear, ease: "Quad.Out" });
    lid.destroy();
    await this.wait(100);
    await Promise.all([
      this.tween({ targets: this.cards.map((c) => c.sprite), y: CENTER.y - 70, duration: T.rise, ease: "Quad.Out" }),
      this.tween({ targets: body, y: "+=50", alpha: 0, duration: T.rise, ease: "Quad.In" }),
    ]);
    body.destroy();
  }

  /** The pack picture's two pieces, torn along a jagged line (made once per picture). */
  private tornPieces(key: string): [string, string] {
    const lidKey = `${key}-torn-lid`, bodyKey = `${key}-torn-body`;
    const textures = this.scene.textures;
    if (textures.exists(lidKey)) return [lidKey, bodyKey];
    const src = textures.get(key).getSourceImage() as HTMLImageElement;
    const { width: w, height: h } = src;
    const tear = (x: number) => TEAR_Y + JAG[Math.floor(x / 3) % JAG.length];
    for (const [name, keep] of [[lidKey, (y: number, t: number) => y < t], [bodyKey, (y: number, t: number) => y >= t]] as const) {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(src, 0, 0);
      const img = ctx.getImageData(0, 0, w, h);
      for (let x = 0; x < w; x++) {
        const t = tear(x);
        for (let y = 0; y < h; y++) if (!keep(y, t)) img.data[(y * w + x) * 4 + 3] = 0;
      }
      ctx.putImageData(img, 0, 0);
      textures.addCanvas(name, canvas);
    }
    return [lidKey, bodyKey];
  }

  /** Each card from the stack to its place, the top one first. */
  private async deal() {
    await Promise.all([...this.cards].reverse().map((c, i) => this.tween({
      targets: c.sprite, x: c.x, y: c.y, duration: T.deal, delay: i * T.dealStagger, ease: "Quad.Out",
    })));
  }

  // --- Revealing --------------------------------------------------------------------------------------------------

  /**
   * REVEAL ALL: the face-down cards turn over one after another; once they're all up and done (not while a card still
   * turns), NEXT PACK or DONE.
   */
  private pressButton() {
    if (!this.dealt) return;
    const hidden = this.cards.filter((c) => !c.revealed);
    if (hidden.length) {
      void this.revealAll(hidden);
      return;
    }
    if (!this.cards.every((c) => c.settled)) return;
    if (this.pack < this.opts.packs.length - 1) void this.nextPack();
    else this.close();
  }

  /** Turns `hidden` over one after another, quietly (only the rare takes the info panel). */
  private async revealAll(hidden: Dealt[]) {
    for (const c of hidden) {
      void this.reveal(c, true);
      await this.wait(T.revealAllStagger);
    }
  }

  /**
   * Turns a card over and shows it in the info panel; `quiet` (REVEAL ALL): commons leave the panel as it is, so it
   * switches only to the pack's one Rare-or-better card instead of flickering through all of them.
   */
  private async reveal(c: Dealt, quiet = false) {
    if (c.revealed || this.closed) return;
    c.revealed = true;
    c.sprite.y = c.y;
    this.layer!.bringToTop(c.sprite);
    const look = rarityLook(c.pull.rarity), host = this.fxHost();
    if (look.tier >= 2) {
      glow(host, c, look.color, look.tier >= 4);
      await shake(host, c);
    }
    await this.tween({ targets: c.sprite, scaleX: 0, duration: T.flip });
    if (this.closed || !c.sprite.active) return;
    c.sprite.show(c.pull.code, this.opts.engine.cards.records.get(c.pull.code));
    c.faceUp = true;
    if (!quiet || look.tier >= 1) this.showDetails(c);
    await this.tween({ targets: c.sprite, scaleX: SCALE, duration: T.flip });
    if (this.closed || !c.sprite.active) return;
    revealShow(host, c, look);
    this.chip(c, look);
    c.settled = true;
    if (this.cards.every((d) => d.settled)) this.button?.setLabel(this.pack < this.opts.packs.length - 1 ? "NEXT PACK" : "DONE");
  }

  /** A face-up card in the info panel. */
  private showDetails(c: Dealt) {
    if (!this.closed) this.panel.show(c.pull.code);
  }

  /** The rarity chip under a turned card. */
  private chip(c: Dealt, look: { label: string; color: number }) {
    const x = c.x - Math.floor(CHIP.w / 2), y = c.y + CARD_H / 2 + 3;
    const g = this.scene.add.graphics().fillStyle(look.color).fillRect(x, y, CHIP.w, CHIP.h).setAlpha(0);
    const t = text(this.scene, x + CHIP.w / 2, y + 1, look.label, { color: 0xffffff, originX: 0.5 }).setAlpha(0);
    this.layer!.add([g, t]);
    void this.tween({ targets: [g, t], alpha: 1, duration: 150 });
  }

  /** Where the reveal effects draw: this pack's layer; their running effects in `loops`. */
  private fxHost(): FxHost {
    return { scene: this.scene, layer: this.layer!, loops: this.loops, closed: () => this.closed };
  }

  private close() {
    if (this.closed) return;
    this.closed = true;
    stopLoops(this.loops);
    void this.tween({
      targets: [this.root, this.panel.root], alpha: 0, duration: T.close,
      onComplete: () => {
        if (this.layer) this.scene.tweens.killTweensOf(this.layer.list);
        this.scene.tweens.killTweensOf(this.root.list);
        this.root.destroy();
        this.panel.destroy();
        this.opts.onClose();
      },
    });
  }

  private tween(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return playTween(this.scene, config, 1);
  }

  private wait(ms: number): Promise<void> {
    return pause(this.scene, ms, 1);
  }
}
