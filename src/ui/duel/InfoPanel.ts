// The info panel left of the field: the two LP bars, and between them either the details of a card (art, stats,
// types, counters, text) or the duel log. Card mode (default) keeps the last hovered card; log mode shows the log
// and previews cards only while hovered. Everything is drawn above dialogs' shade (INFO_DEPTH), so it stays bright
// and still shows cards hovered in a dialog.
import Phaser from "phaser";
import type { CounterView, FieldSnapshot } from "../../duel/DuelSession.ts";
import type { Engine } from "../../duel/loadEngine.ts";
import { raceNames } from "../../duel/text.ts";
import { text } from "../pixel.ts";
import { THEME, ui } from "../theme.ts";
import { ATTRIBUTE_INDEX, ATTRIBUTE_SHEET, SPELL_ATTRIBUTE, SPELL_KIND_ICON, SPELL_NORMAL_ICON, SPELL_SHEET, TRAP_ATTRIBUTE } from "./CardSprite.ts";
import { INFO, INSET, cardKey } from "./layout.ts";
import { LPBar, LP_BAR } from "./LPBar.ts";
import { INFO_DEPTH } from "./Modal.ts";

/** Panel geometry: everything sits inside the frame's rim. */
const LAYOUT = (() => {
  const r = INSET.board;
  const x = r + 2, w = INFO.w - 2 * (r + 2);
  const lpOpp = r, lpMine = 360 - r - LP_BAR.h;
  return {
    x, w,
    bar: { x: r + 1, w: INFO.w - 2 * (r + 1) },
    lp: { opp: lpOpp, mine: lpMine },
    /** Content area between the two LP bars. */
    top: lpOpp + LP_BAR.h + 5,
    bottom: lpMine - 4,
  };
})();
/** Level stars: 7x7 sprite, 3px apart. */
const STAR_SIZE = 7, STAR_GAP = 3;
/** ATK / DEF plates: height (label: plate.inkSoft, value: plate.ink at 2x). */
const STAT_PLATE_H = 26;

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

/** Card art: 128px art inside the LP bar's frame (theme rim). */
const ART_FRAME = 128 + 2 * INSET.lpTrack;
/** The duel log text starts below its "DUEL LOG" header, inside the paper. */
const LOG_Y = LAYOUT.top + 13;

export type PanelMode = "card" | "log";

export class InfoPanel {
  /** Index 0 = you (bottom), 1 = the opponent (top). */
  readonly lpBars: [LPBar, LPBar];
  private readonly scene: Phaser.Scene;
  private readonly engine: Engine;
  private readonly content: Phaser.GameObjects.Container;
  private readonly logText: Phaser.GameObjects.BitmapText;
  private logLines: string[] = [];
  private mode: PanelMode = "card";
  /** Card shown right now (0: the log or nothing). */
  private shownCode = 0;
  /** Last card shown (the LOG/CARD toggle returns to it). */
  private lastCode = 0;
  /** Counters on the last card shown, and its sprite key when it's on the field (redraws refresh them). */
  private lastCounters: CounterView[] = [];
  private lastKey: string | null = null;
  private hoverTimer: Phaser.Time.TimerEvent | null = null;
  private nameScroll: { tween: Phaser.Tweens.Tween; mask: Phaser.GameObjects.Graphics } | null = null;

  constructor(scene: Phaser.Scene, engine: Engine, opts: { startLP: number; opponentName: string }) {
    this.scene = scene;
    this.engine = engine;
    const L = LAYOUT, lp = opts.startLP;
    scene.add.nineslice(0, 0, ui("info-frame"), undefined, INFO.w, 360, ...THEME.panel.infoSlice).setOrigin(0).setDepth(INFO_DEPTH);
    this.lpBars = [
      new LPBar(scene, L.bar.x, L.lp.mine, L.bar.w, "You", lp).set(lp).setDepth(INFO_DEPTH),
      new LPBar(scene, L.bar.x, L.lp.opp, L.bar.w, opts.opponentName, lp).set(lp).setDepth(INFO_DEPTH),
    ];
    this.content = scene.add.container(0, 0).setDepth(INFO_DEPTH);
    this.logText = text(scene, L.x + INSET.paper, LOG_Y, "", { color: THEME.panel.paperInk, maxWidth: L.w - INSET.paper * 2 }).setDepth(INFO_DEPTH + 1);
    this.showEmpty();
  }

  /** Switches between card mode and log mode; returns the new mode. */
  toggleMode(): PanelMode {
    this.mode = this.mode === "card" ? "log" : "card";
    if (this.mode === "card" && this.lastCode) this.showCard(this.lastCode, this.lastCounters);
    else this.showLog();
    return this.mode;
  }

  /**
   * Pointer entered a card (`fieldKey`: its sprite key when it's on the field, so its counters stay current).
   * Card mode: show it and keep it (until another card is hovered). Log mode: show it only while hovered
   * (`hoverEnd` returns to the log).
   */
  showInfo(code: number, counters: CounterView[] = [], fieldKey: string | null = null) {
    if (!code || !this.engine.cards.records.has(code)) return;
    this.hoverTimer?.remove();
    this.lastCode = code;
    this.lastCounters = counters;
    this.lastKey = fieldKey;
    this.showCard(code, counters);
  }

  /** Pointer left a card: in log mode, go back to the log (slightly delayed so moving between cards doesn't flicker). */
  hoverEnd() {
    if (this.mode !== "log") return;
    this.hoverTimer?.remove();
    this.hoverTimer = this.scene.time.delayedCall(120, () => { if (this.mode === "log") this.showLog(); });
  }

  /** You drew a card: card mode starts empty, and the first card you draw fills it. */
  drew(code: number) {
    if (this.lastCode || !code) return;
    this.lastCode = code;
    if (this.mode === "card") this.showCard(code);
  }

  /** After a redraw: if the panel shows a field card whose counters changed since, show the new ones. */
  refreshCounters(snap: FieldSnapshot) {
    if (!this.lastKey) return;
    const c = snap.players.flatMap((p) => [...p.monsters, ...p.spells]).find((v) => v && cardKey(v) === this.lastKey);
    if (!c || c.code !== this.lastCode) { this.lastKey = null; return; }
    if (JSON.stringify(c.counters) === JSON.stringify(this.lastCounters)) return;
    this.lastCounters = c.counters;
    if (this.shownCode === c.code) this.showCard(c.code, c.counters);
  }

  log(line: string) {
    this.logLines.push(line.toUpperCase());
    while (this.logLines.length > 200) this.logLines.shift();
    this.renderLog();
  }

  /** Renders a card's details, with the counters on it (a field card's). */
  private showCard(code: number, counters: CounterView[] = []) {
    const r = this.engine.cards.records.get(code);
    if (!r) return;
    const s = this.scene;
    this.shownCode = code;
    this.logText.setVisible(false);
    this.stopNameScroll();
    const p = this.content.removeAll(true);
    const L = LAYOUT;
    const monster = (r.type & 0x1) !== 0;

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
    // 128x128 art in a wooden frame (the LP bar's frame, nine-sliced), loaded on first view.
    const artY = L.top + 24;
    const artKey = `art128-${code}`;
    const lpRim = INSET.lpTrack, fs = THEME.lpBar.slice;
    p.add(s.add.nineslice(L.x, artY, ui("lp-frame"), undefined, ART_FRAME, ART_FRAME, fs, fs, fs, fs).setOrigin(0));
    const placeArt = () => { if (this.shownCode === code && p.active) p.add(s.add.image(L.x + lpRim, artY + lpRim, artKey).setOrigin(0)); };
    if (s.textures.exists(artKey)) placeArt();
    else {
      s.load.image(artKey, `cards/art128/${code}.png`);
      s.load.once(`filecomplete-image-${artKey}`, placeArt);
      s.load.start();
    }
    // Column right of the art: monsters get ATK and DEF plates (dark wood); Spells/Traps their SPELL / TRAP
    // and kind icons in that space. Under them, down to the bottom of the art, the type plate:
    // race + monster types, or SPELL / TRAP + kind, one per line.
    const statX = L.x + ART_FRAME + 4, statW = L.x + L.w - statX;
    const typesY = artY + 2 * (STAT_PLATE_H + 4);
    let types: string[];
    if (monster) {
      const stat = (v: number) => (v < 0 ? "?" : String(v));
      this.statPlate(p, statX, artY, statW, "ATK", stat(r.atk), STAT_ICON.sword);
      this.statPlate(p, statX, artY + STAT_PLATE_H + 4, statW, "DEF", stat(r.def), STAT_ICON.shield);
      types = [raceNames(BigInt(r.race)), ...monsterTypes(r.type)];
    } else {
      // SPELL / TRAP icon and the kind icon side by side, 1x, centred where monsters have ATK / DEF.
      const plateH = 2 * STAT_PLATE_H + 4;
      const kind = SPELL_KIND_ICON.find(([bit]) => r.type & bit)?.[1] ?? SPELL_NORMAL_ICON;
      const iconsX = statX + (statW - (16 + 4 + 16)) / 2, iconsY = artY + (plateH - 16) / 2;
      p.add(s.add.image(iconsX, iconsY, ATTRIBUTE_SHEET, r.type & 0x2 ? SPELL_ATTRIBUTE : TRAP_ATTRIBUTE).setOrigin(0));
      p.add(s.add.image(iconsX + 20, iconsY, SPELL_SHEET, kind).setOrigin(0));
      types = [r.type & 0x2 ? "SPELL" : "TRAP", spellTrapKind(r.type)];
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
    this.paper(L.x, descY, L.w, L.bottom - descY);
    const pad = INSET.paper + 1;
    p.add(text(s, L.x + pad, descY + pad, r.desc, { maxWidth: L.w - pad * 2, color: THEME.panel.paperInk }));
  }

  /**
   * One stat: a dark wood plate (Frame01a, as the card menu) with a pixel icon on the left, a small label ("ATK")
   * over the value in 2x light text.
   */
  private statPlate(p: Phaser.GameObjects.Container, x: number, y: number, w: number, label: string, value: string, icon: PixelIcon) {
    const s = this.scene, pr = THEME.plate.slice;
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

  /** Cream paper inset whose outer edge is the box (x, y, w, h); text goes inside, padded by its rim. */
  private paper(x: number, y: number, w: number, h: number) {
    const r = THEME.panel.paperSlice;
    this.content.add(this.scene.add.nineslice(x, y, ui("panel-paper"), undefined, w, h, r, r, r, r).setOrigin(0));
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

  /** Nothing to show yet (before the opening hand is drawn): just the wooden board. */
  private showEmpty() {
    this.shownCode = 0;
    this.stopNameScroll();
    this.content.removeAll(true);
    this.logText.setVisible(false);
  }

  private showLog() {
    this.shownCode = 0;
    this.stopNameScroll();
    this.content.removeAll(true);
    const L = LAYOUT;
    this.logText.setVisible(true);
    this.content.add(text(this.scene, L.x + 1, L.top, "DUEL LOG", { color: THEME.panel.inkSoft }));
    this.paper(L.x, LOG_Y - INSET.paper - 1, L.w, L.bottom - LOG_Y + INSET.paper + 1);
    this.renderLog();
  }

  /** As many of the latest lines as fit above the bottom LP bar. */
  private renderLog() {
    const room = LAYOUT.bottom - INSET.paper - this.logText.y;
    for (let n = Math.min(this.logLines.length, 45); n >= 0; n--) {
      this.logText.setText(this.logLines.slice(this.logLines.length - n).join("\n"));
      if (this.logText.height <= room) break;
    }
  }
}

/**
 * A monster's types in card type-line order (after the race): special kinds, Flip, then Effect or Normal.
 * Man-Eater Bug: FLIP, EFFECT.
 */
function monsterTypes(type: number): string[] {
  const kinds: [number, string][] = [
    [0x40, "FUSION"], [0x80, "RITUAL"], [0x2000, "SYNCHRO"], [0x200, "SPIRIT"], [0x400, "UNION"],
    [0x800, "GEMINI"], [0x400000, "TOON"], [0x1000, "TUNER"], [0x200000, "FLIP"],
  ];
  const out = kinds.filter(([bit]) => type & bit).map(([, name]) => name);
  if (type & 0x4000) out.push("TOKEN");
  else if (type & 0x20) out.push("EFFECT");
  else if (type & 0x10) out.push("NORMAL");
  return out;
}

function spellTrapKind(type: number): string {
  if (type & 0x10000) return "QUICK-PLAY";
  if (type & 0x20000) return "CONTINUOUS";
  if (type & 0x40000) return "EQUIP";
  if (type & 0x80000) return "FIELD";
  if (type & 0x100000) return "COUNTER";
  if (type & 0x80) return "RITUAL";
  return "NORMAL";
}
