// A card's details as the info panel shows them: name (2x, scrolls when long), attribute and level, 128px art,
// ATK / DEF plates (or the Spell/Trap icons), the type plate with counters, and the card text on paper.
// Drawn into a box of the caller's (the duel's info panel, the deck editor's preview).
import Phaser from "phaser";
import { TYPE } from "../duel/engine/cardData.ts";
import type { CounterView } from "../duel/engine/DuelSession.ts";
import type { Engine } from "../duel/engine/loadEngine.ts";
import { raceNames } from "../duel/engine/text.ts";
import { text } from "../ui/pixel.ts";
import { THEME, ui } from "../ui/theme.ts";
import { ATTRIBUTE_INDEX, ATTRIBUTE_SHEET, SPELL_ATTRIBUTE, SPELL_KIND_ICON, SPELL_NORMAL_ICON, SPELL_SHEET, TRAP_ATTRIBUTE } from "./CardSprite.ts";
import { INSET } from "./layout.ts";

/** Where the details go (screen pixels): content `x`..`x + w`, from `top` down to `bottom`. */
export interface CardInfoBox {
  x: number;
  w: number;
  top: number;
  bottom: number;
}

/** Level stars: 7x7 sprite, 3px apart. */
const STAR_SIZE = 7, STAR_GAP = 3;
/** ATK / DEF plates: height (label: plate.inkSoft, value: plate.ink at 2x). */
const STAT_PLATE_H = 26;
/** Card art: 128px art inside the LP bar's frame (theme rim). */
const ART_FRAME = 128 + 2 * INSET.lpTrack;

/** Tiny pixel icons: one string per row, each character a colour key ("." = empty). */
interface PixelIcon { rows: string[]; colors: Record<string, number> }
const STAT_ICON: Record<"sword" | "shield", PixelIcon> = {
  // Upright sword: steel blade with a light edge, gold guard, brown grip and pommel.
  sword: {
    rows: ["...b...", "..bw...", "..bw...", "..bw...", "..bw...", "..bw...", "..bw...", "ggggggg", "...h...", "...h...", "..ggg.."],
    colors: { b: 0x9aa6b4, w: 0xe6edf3, g: 0xe0a040, h: 0x7a4a2c },
  },
  // Heater shield: blue face with a light left edge and a gold rim.
  shield: {
    rows: ["ggggggg", "gwbbbbg", "gwbbbbg", "gwbbbbg", "gwbbbbg", "gwbbbbg", ".gwbbg.", ".gwbbg.", "..gbg..", "...g..."],
    colors: { g: 0xe0a040, w: 0x8fb0e8, b: 0x3d5e9e },
  },
};

/** Paper inset ("panel-paper") whose outer edge is the box (x, y, w, h); text goes inside, padded by its rim. */
export function paperInset(scene: Phaser.Scene, x: number, y: number, w: number, h: number): Phaser.GameObjects.NineSlice {
  const r = THEME.panel.paperSlice;
  return scene.add.nineslice(x, y, ui("panel-paper"), undefined, w, h, r, r, r, r).setOrigin(0);
}

export class CardInfo {
  /** Everything drawn; the caller sets its depth / visibility. */
  readonly container: Phaser.GameObjects.Container;
  private readonly scene: Phaser.Scene;
  private readonly engine: Engine;
  private readonly box: CardInfoBox;
  /** Card shown right now, 0 for none. */
  code = 0;
  private nameScroll: { tween: Phaser.Tweens.Tween; mask: Phaser.GameObjects.Graphics } | null = null;

  constructor(scene: Phaser.Scene, engine: Engine, box: CardInfoBox) {
    this.scene = scene;
    this.engine = engine;
    this.box = box;
    this.container = scene.add.container(0, 0);
  }

  /** Renders a card's details, with the counters on it (a field card's). */
  show(code: number, counters: CounterView[] = []) {
    const r = this.engine.cards.records.get(code);
    if (!r) return;
    const s = this.scene;
    this.code = code;
    this.stopNameScroll();
    const p = this.container.removeAll(true);
    const L = this.box;
    const monster = (r.type & TYPE.MONSTER) !== 0;

    // Name at 2x, light with a 1px dark drop shadow, left-aligned; names wider than their space scroll (see
    // scrollName). Monsters stop before the attribute icon; Spells/Traps (icons sit by the art) get the full width.
    const nameW = monster ? L.w - 20 : L.w;
    const nameStr = r.name.toUpperCase();
    const nameText = text(s, 0, 0, nameStr, { scale: 2, color: THEME.cardName.ink });
    const name = s.add.container(L.x, L.top, [text(s, 1, 1, nameStr, { scale: 2, color: THEME.cardName.shadow }), nameText]);
    p.add(name);
    if (nameText.width > nameW) this.scrollName(name, nameText.width, nameW);
    const attr = ATTRIBUTE_INDEX[r.attribute];
    if (monster && attr !== undefined) p.add(s.add.image(L.x + L.w - 16, L.top - 1, ATTRIBUTE_SHEET, attr).setOrigin(0));
    if (monster) for (let i = 0; i < (r.level & 0xff); i++) p.add(s.add.image(L.x + i * (STAR_SIZE + STAR_GAP), L.top + 14, ui("star")).setOrigin(0));
    // 128x128 art in the LP bar's frame (nine-sliced), loaded on first view.
    const artY = L.top + 24;
    const artKey = `art128-${code}`;
    const lpRim = INSET.lpTrack, fs = THEME.lpBar.slice;
    p.add(s.add.nineslice(L.x, artY, ui("lp-frame"), undefined, ART_FRAME, ART_FRAME, fs, fs, fs, fs).setOrigin(0));
    const placeArt = () => { if (this.code === code && p.active) p.add(s.add.image(L.x + lpRim, artY + lpRim, artKey).setOrigin(0)); };
    if (s.textures.exists(artKey)) placeArt();
    else {
      s.load.image(artKey, `cards/art128/${code}.png`);
      s.load.once(`filecomplete-image-${artKey}`, placeArt);
      s.load.start();
    }
    // Column right of the art: monsters get ATK and DEF plates; Spells/Traps their SPELL / TRAP
    // and kind icons in that space. Under them, down to the bottom of the art, the type plate:
    // race + monster types, or SPELL / TRAP + kind, one per line.
    const statX = L.x + ART_FRAME + 4, statW = L.x + L.w - statX;
    const typesY = artY + 2 * (STAT_PLATE_H + 4);
    let types: string[];
    if (monster) {
      const stat = (v: number) => (v < 0 ? "?" : String(v));
      this.statPlate(statX, artY, statW, "ATK", stat(r.atk), STAT_ICON.sword);
      this.statPlate(statX, artY + STAT_PLATE_H + 4, statW, "DEF", stat(r.def), STAT_ICON.shield);
      types = [raceNames(BigInt(r.race)), ...monsterTypes(r.type)];
    } else {
      // SPELL / TRAP icon and the kind icon side by side, 1x, centred where monsters have ATK / DEF.
      const plateH = 2 * STAT_PLATE_H + 4;
      const kind = SPELL_KIND_ICON.find(([bit]) => r.type & bit)?.[1] ?? SPELL_NORMAL_ICON;
      const iconsX = statX + (statW - (16 + 4 + 16)) / 2, iconsY = artY + (plateH - 16) / 2;
      p.add(s.add.image(iconsX, iconsY, ATTRIBUTE_SHEET, r.type & TYPE.SPELL ? SPELL_ATTRIBUTE : TRAP_ATTRIBUTE).setOrigin(0));
      p.add(s.add.image(iconsX + 20, iconsY, SPELL_SHEET, kind).setOrigin(0));
      types = [r.type & TYPE.SPELL ? "SPELL" : "TRAP", spellTrapKind(r.type)];
    }
    const pr = THEME.plate.slice;
    p.add(s.add.nineslice(statX, typesY, ui("menu-back"), undefined, statW, artY + ART_FRAME - typesY, pr, pr, pr, pr).setOrigin(0));
    types.forEach((str, i) => p.add(text(s, statX + 5, typesY + 5 + i * 8, str, { color: THEME.plate.ink })));
    // Counters on the card, listed from the plate's bottom up ("SPELL CTR 2": "COUNTER" doesn't fit).
    const plateBottom = artY + ART_FRAME - 5;
    counters.forEach((c, i) => {
      const line = `${this.engine.text.counterName(c.kind).replace(/counter/i, "Ctr").toUpperCase()} ${c.count}`;
      p.add(text(s, statX + 5, plateBottom - 5 - i * 8, line, { color: THEME.plate.ink }));
    });
    const descY = artY + ART_FRAME + 5;
    p.add(paperInset(s, L.x, descY, L.w, L.bottom - descY));
    const pad = INSET.paper + 1;
    p.add(text(s, L.x + pad, descY + pad, r.desc, { maxWidth: L.w - pad * 2, color: THEME.panel.paperInk }));
  }

  /** Shows nothing. */
  clear() {
    this.code = 0;
    this.stopNameScroll();
    this.container.removeAll(true);
  }

  /**
   * One stat: a plate (the theme's "menu-back", as the button plate) with a pixel icon on the left, a small label ("ATK")
   * over the value in 2x light text.
   */
  private statPlate(x: number, y: number, w: number, label: string, value: string, icon: PixelIcon) {
    const s = this.scene, p = this.container, pr = THEME.plate.slice;
    p.add(s.add.nineslice(x, y, ui("menu-back"), undefined, w, STAT_PLATE_H, pr, pr, pr, pr).setOrigin(0));
    const g = s.add.graphics();
    const iconY = y + Math.floor((STAT_PLATE_H - icon.rows.length) / 2);
    icon.rows.forEach((row, iy) => [...row].forEach((ch, ix) => {
      const color = icon.colors[ch];
      if (color !== undefined) g.fillStyle(color).fillRect(x + 5 + ix, iconY + iy, 1, 1);
    }));
    p.add(g);
    const tx = x + 5 + icon.rows[0].length + 4;
    p.add(text(s, tx, y + 5, label, { color: THEME.plate.inkSoft }));
    p.add(text(s, tx, y + 12, value, { scale: 2, color: THEME.plate.ink }));
  }

  /**
   * Marquee for long card names: wait, scroll left until the end is visible, pause, jump back to the
   * start, pause, repeat. The name (text + shadow, `nameWidth` wide) is clipped to `width` by a Mask filter
   * (Phaser 4; the mask rectangle is in world coordinates, so it stays put while the name scrolls).
   */
  private scrollName(name: Phaser.GameObjects.Container, nameWidth: number, width: number) {
    const mask = this.scene.make.graphics({}, false);
    mask.fillStyle(0xffffff).fillRect(name.x, name.y - 1, width, 2 * 7 + 3);
    name.enableFilters().filters!.internal.addMask(mask);
    const overflow = nameWidth - width;
    this.nameScroll = {
      mask,
      tween: this.scene.tweens.add({
        targets: name, x: name.x - overflow,
        delay: 900, duration: overflow * 40, hold: 1000, repeat: -1, repeatDelay: 900,
      }),
    };
  }

  private stopNameScroll() {
    this.nameScroll?.tween.remove();
    this.nameScroll?.mask.destroy();
    this.nameScroll = null;
  }
}

/**
 * A monster's types in card type-line order (after the race): special kinds, Flip, then Effect or Normal.
 * Man-Eater Bug: FLIP, EFFECT.
 */
export function monsterTypes(type: number): string[] {
  const kinds: [number, string][] = [
    [TYPE.FUSION, "FUSION"], [TYPE.RITUAL, "RITUAL"], [TYPE.SYNCHRO, "SYNCHRO"], [TYPE.SPIRIT, "SPIRIT"], [TYPE.UNION, "UNION"],
    [TYPE.GEMINI, "GEMINI"], [TYPE.TOON, "TOON"], [TYPE.TUNER, "TUNER"], [TYPE.FLIP, "FLIP"],
  ];
  const out = kinds.filter(([bit]) => type & bit).map(([, name]) => name);
  if (type & TYPE.TOKEN) out.push("TOKEN");
  else if (type & TYPE.EFFECT) out.push("EFFECT");
  else if (type & TYPE.NORMAL) out.push("NORMAL");
  return out;
}

export function spellTrapKind(type: number): string {
  if (type & TYPE.QUICKPLAY) return "QUICK-PLAY";
  if (type & TYPE.CONTINUOUS) return "CONTINUOUS";
  if (type & TYPE.EQUIP) return "EQUIP";
  if (type & TYPE.FIELD) return "FIELD";
  if (type & TYPE.COUNTER) return "COUNTER";
  if (type & TYPE.RITUAL) return "RITUAL";
  return "NORMAL";
}
