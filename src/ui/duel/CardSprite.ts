// One 38x56 card: the type frame (public/assets/cards/frames), 32x32 art from the art atlas,
// and name / attribute / level / ATK-DEF drawn on top in pixel fonts. Or the card back.
import Phaser from "phaser";
import type { CardRecord } from "../../duel/cardData.ts";
import { FONT_CARD, FONT_UI, INK, INK_SOFT, border, fit, text } from "../pixel.ts";
import { THEME } from "../theme.ts";
import { CARD } from "./layout.ts";

export const CARD_BACK = "card-back";
export const ART_ATLAS = "art32";
export const ATTRIBUTE_SHEET = "attributes";
export const SPELL_SHEET = "spells";

const TYPE_MONSTER = 0x1, TYPE_SPELL = 0x2, TYPE_TRAP = 0x4, TYPE_EFFECT = 0x20, TYPE_FUSION = 0x40, TYPE_RITUAL = 0x80;
const TYPE_TOKEN = 0x4000;

export const FRAMES = ["normal_monster", "effect_monster", "fusion_monster", "ritual_monster", "token", "spell", "trap"] as const;
export const frameKey = (name: (typeof FRAMES)[number]) => `frame-${name}`;

export function frameFor(type: number): (typeof FRAMES)[number] {
  if (type & TYPE_SPELL) return "spell";
  if (type & TYPE_TRAP) return "trap";
  if (type & TYPE_FUSION) return "fusion_monster";
  if (type & TYPE_RITUAL) return "ritual_monster";
  if (type & TYPE_TOKEN) return "token";
  if (type & TYPE_EFFECT) return "effect_monster";
  return "normal_monster";
}

/**
 * Spell/Trap kind icons, index in spells.png (16x16 each): COUNTER QUICK-PLAY EQUIP RITUAL FIELD NORMAL
 * (plain circle) CONTINUOUS. Checked in this order, NORMAL when no kind bit is set.
 */
export const SPELL_KIND_ICON: [number, number][] = [
  [0x100000, 0], [0x10000, 1], [0x40000, 2], [0x80, 3], [0x80000, 4], [0x20000, 6],
];
export const SPELL_NORMAL_ICON = 5;
export const SPELL_EQUIP_ICON = 2;
/** Opacity of the equip icon shown over a card's art while its equip partner is hovered. */
const EQUIP_MARK_ALPHA = 0.5;

/** Attribute bit -> index in attributes.png (DARK EARTH FIRE LIGHT WATER WIND DIVINE, then SPELL TRAP). */
export const ATTRIBUTE_INDEX: Record<number, number> = { 0x20: 0, 0x01: 1, 0x04: 2, 0x10: 3, 0x02: 4, 0x08: 5, 0x40: 6 };
/** The Spell and Trap "attribute" icons in attributes.png. */
export const SPELL_ATTRIBUTE = 7, TRAP_ATTRIBUTE = 8;
/** Small 3x3 attribute swatch colours for the card's name bar (sampled from attributes.png). */
const ATTRIBUTE_COLOR: Record<number, number> = { 0x20: 0x7d1f9e, 0x01: 0x2f4a19, 0x04: 0x7a1a14, 0x10: 0x9c8d55, 0x02: 0x1d2f7a, 0x08: 0x4c7a2a, 0x40: 0xc9b400 };


/** Field targeting: "choice" = can be picked (yellow, 1px), "selected" = picked (orange, 2px). */
export type CardHighlight = "none" | "action" | "choice" | "selected" | "target" | "attacker" | "attacked";
const highlightColor = (kind: CardHighlight): number => ({
  none: 0, action: 0xffd400, choice: THEME.pick.choice, selected: THEME.pick.selected, target: 0xff4136, attacker: 0xff4136, attacked: 0xff4136,
} satisfies Record<CardHighlight, number>)[kind];
/** Attack declarations and pickable cards use a thin 1px outline; other highlights 2px. */
const HIGHLIGHT_WIDTH: Partial<Record<CardHighlight, number>> = { choice: 1, attacker: 1, attacked: 1 };

const LEFT = -CARD.w / 2, TOP = -CARD.h / 2;

export interface ShowOptions {
  back?: boolean;
  /** Own face-down cards: show the face, faded. */
  dim?: boolean;
  /** Current (modified) ATK/DEF on the field; defaults to the printed values. */
  atk?: number;
  def?: number;
}

export class CardSprite extends Phaser.GameObjects.Container {
  readonly w = CARD.w;
  readonly h = CARD.h;
  /** Passcode currently shown face-up, 0 while showing the back. */
  code = 0;
  private parts: Phaser.GameObjects.GameObject[] = [];
  private outline: Phaser.GameObjects.Graphics;
  private equipMark: Phaser.GameObjects.Image | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y);
    this.outline = scene.add.graphics();
    this.add(this.outline);
    this.setSize(CARD.w, CARD.h);
    scene.add.existing(this);
  }

  show(code: number, record: CardRecord | undefined, opts: ShowOptions = {}): this {
    for (const p of this.parts) p.destroy();
    this.parts = [];
    const back = opts.back || !code || !record;
    this.code = back ? 0 : code;
    const sc = this.scene;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);

    if (back) {
      add(sc.add.image(0, 0, CARD_BACK));
    } else {
      add(sc.add.image(0, 0, frameKey(frameFor(record.type))));
      if (sc.textures.get(ART_ATLAS).has(String(code))) {
        add(sc.add.image(LEFT + 3, TOP + 12, ART_ATLAS, String(code)).setOrigin(0));
      } else {
        add(sc.add.rectangle(LEFT + 3, TOP + 12, 32, 32, INK_SOFT).setOrigin(0));
      }
      this.drawText(record, opts, add);
    }
    if (opts.dim) for (const p of this.parts) (p as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(0.55);
    this.addAt(this.parts, 0);
    return this;
  }

  /** A card that isn't in the card database (e.g. rock-paper-scissors): a frame, 32x32 art and a name. */
  showPlain(frame: (typeof FRAMES)[number], art: { key: string; frame: number }, name: string): this {
    for (const p of this.parts) p.destroy();
    this.code = 0;
    const sc = this.scene;
    this.parts = [
      sc.add.image(0, 0, frameKey(frame)),
      sc.add.image(LEFT + 3, TOP + 12, art.key, art.frame).setOrigin(0),
      text(sc, LEFT + 3, TOP + 3, fit(sc, FONT_CARD, name.toUpperCase(), 32), { font: FONT_CARD }),
    ];
    this.addAt(this.parts, 0);
    return this;
  }

  private drawText(r: CardRecord, opts: ShowOptions, add: <T extends Phaser.GameObjects.GameObject>(o: T) => T) {
    const sc = this.scene;
    const monster = (r.type & TYPE_MONSTER) !== 0;
    // Name bar: x 2..35, y 2..6, 1px padding inside. 3x3 glyphs at y 3; the attribute swatch takes x 32..34,
    // so a monster name may use x 3..30 (1px gap before the swatch), other names x 3..34.
    const nameWidth = monster ? 28 : 32;
    add(text(sc, LEFT + 3, TOP + 3, fit(sc, FONT_CARD, r.name.toUpperCase(), nameWidth), { font: FONT_CARD }));
    const g = add(sc.add.graphics());
    if (monster) {
      const attr = ATTRIBUTE_COLOR[r.attribute];
      if (attr !== undefined) g.fillStyle(attr).fillRect(LEFT + 32, TOP + 3, 3, 3);
      // Level stars, right-aligned in the y 7..10 band: 2x2 red with a yellow glint.
      const level = r.level & 0xff;
      for (let i = 0; i < Math.min(level, 11); i++) {
        const sx = LEFT + 33 - i * 3, sy = TOP + 8;
        g.fillStyle(0xd62020).fillRect(sx, sy, 2, 2);
        g.fillStyle(0xffd23f).fillRect(sx + 1, sy + 1, 1, 1);
      }
      // ATK (black) and DEF (grey) in the bottom bar, y 46..53, 1px padding each side (x 3 .. x 34).
      // Right-aligning on x 36: BitmapText width includes the font's 1px trailing spacing.
      const stat = (v: number) => (v < 0 ? "?" : String(v));
      add(text(sc, LEFT + 3, TOP + 48, stat(opts.atk ?? r.atk), { font: FONT_UI, color: INK }));
      add(text(sc, LEFT + 36, TOP + 48, stat(opts.def ?? r.def), { font: FONT_UI, color: INK_SOFT, originX: 1 }));
    } else {
      add(text(sc, 0, TOP + 48, r.type & TYPE_SPELL ? "SPELL" : "TRAP", { font: FONT_UI, color: INK, originX: 0.5 }));
    }
  }

  /** Shows/hides the Equip Spell icon at 2x (32x32), covering the art window (the card's centre). */
  setEquipMark(on: boolean): this {
    if (on && !this.equipMark) {
      this.equipMark = this.scene.add.image(0, 0, SPELL_SHEET, SPELL_EQUIP_ICON).setScale(2).setAlpha(EQUIP_MARK_ALPHA);
      this.add(this.equipMark);
    } else if (!on && this.equipMark) {
      this.equipMark.destroy();
      this.equipMark = null;
    }
    return this;
  }

  setHighlight(kind: CardHighlight): this {
    this.outline.clear();
    const t = HIGHLIGHT_WIDTH[kind] ?? 2;
    if (kind !== "none") border(this.outline, LEFT - t, TOP - t, CARD.w + 2 * t, CARD.h + 2 * t, highlightColor(kind), t);
    return this;
  }
}
