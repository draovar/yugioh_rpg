import Phaser from "phaser";
import type { CardRecord } from "../../duel/cardData.ts";
import { FONT } from "../widgets.ts";

export const CARD_BACK = "card-back";
export const cardTexture = (code: number) => `card-${code}`;

const TYPE_SPELL = 0x2, TYPE_TRAP = 0x4, TYPE_EFFECT = 0x20, TYPE_FUSION = 0x40, TYPE_RITUAL = 0x80;

function frameColor(type: number): number {
  if (type & TYPE_SPELL) return 0x1d9e74;
  if (type & TYPE_TRAP) return 0xbc5a84;
  if (type & TYPE_FUSION) return 0x8a5bb8;
  if (type & TYPE_RITUAL) return 0x5b7fc4;
  if (type & TYPE_EFFECT) return 0xc76b29;
  return 0xc9a35a;
}

export type CardHighlight = "none" | "action" | "selected" | "target";
const HIGHLIGHT_COLOR: Record<CardHighlight, number> = { none: 0, action: 0xffe14d, selected: 0x4dff88, target: 0xff5555 };

/**
 * One card face (or back). Uses the downloaded card image when available and
 * falls back to a coloured frame with the card name.
 */
export class CardSprite extends Phaser.GameObjects.Container {
  readonly w: number;
  readonly h: number;
  private face: Phaser.GameObjects.GameObject[] = [];
  private outline: Phaser.GameObjects.Graphics;
  /** Passcode currently shown face-up, 0 while showing the back. */
  code = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number) {
    super(scene, x, y);
    this.w = w;
    this.h = h;
    this.outline = scene.add.graphics();
    this.add(this.outline);
    this.setSize(w, h);
    scene.add.existing(this);
  }

  /** `record` null = show the card back. */
  show(code: number, record: CardRecord | undefined, opts: { back?: boolean; dim?: boolean } = {}): this {
    for (const o of this.face) o.destroy();
    this.face = [];
    this.code = opts.back ? 0 : code;
    const { w, h } = this;
    const sc = this.scene;
    if (opts.back || !code) {
      this.face.push(sc.add.image(0, 0, CARD_BACK).setDisplaySize(w, h));
    } else if (sc.textures.exists(cardTexture(code))) {
      this.face.push(sc.add.image(0, 0, cardTexture(code)).setDisplaySize(w, h));
    } else {
      const g = sc.add.graphics();
      g.fillStyle(frameColor(record?.type ?? 0)).fillRoundedRect(-w / 2, -h / 2, w, h, 4);
      g.fillStyle(0x000000, 0.25).fillRect(-w / 2 + 4, -h / 2 + h * 0.2, w - 8, h * 0.45);
      const t = sc.add.text(0, -h / 2 + 4, record?.name ?? `#${code}`, {
        fontFamily: FONT, fontSize: `${Math.max(8, Math.round(w / 8))}px`, color: "#111111",
        wordWrap: { width: w - 6 }, align: "center",
      }).setOrigin(0.5, 0);
      this.face.push(g, t);
    }
    if (opts.dim) for (const o of this.face) (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(0.6);
    this.addAt(this.face, 0);
    return this;
  }

  setHighlight(kind: CardHighlight): this {
    this.outline.clear();
    if (kind !== "none") {
      this.outline.lineStyle(3, HIGHLIGHT_COLOR[kind]).strokeRoundedRect(-this.w / 2 - 3, -this.h / 2 - 3, this.w + 6, this.h + 6, 5);
    }
    return this;
  }
}
