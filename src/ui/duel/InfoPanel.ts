// The info panel left of the field: the two LP bars, and between them either the details of a card (art, stats,
// types, counters, text) or the duel log. Card mode (default) keeps the last hovered card; log mode shows the log
// and previews cards only while hovered. Everything is drawn above dialogs' shade (INFO_DEPTH), so it stays bright
// and still shows cards hovered in a dialog.
import Phaser from "phaser";
import type { CounterView, FieldSnapshot } from "../../duel/DuelSession.ts";
import type { Engine } from "../../duel/loadEngine.ts";
import { text } from "../pixel.ts";
import { THEME, ui } from "../theme.ts";
import { CardInfo, paperInset } from "./CardInfo.ts";
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
  private readonly card: CardInfo;

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
    this.card = new CardInfo(scene, engine, { x: L.x, w: L.w, top: L.top, bottom: L.bottom });
    this.card.container.setDepth(INFO_DEPTH);
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
    if (!this.engine.cards.records.has(code)) return;
    this.shownCode = code;
    this.logText.setVisible(false);
    this.content.removeAll(true);
    this.card.show(code, counters);
  }

  /** Nothing to show yet (before the opening hand is drawn): just the panel's frame. */
  private showEmpty() {
    this.shownCode = 0;
    this.card.clear();
    this.content.removeAll(true);
    this.logText.setVisible(false);
  }

  private showLog() {
    this.shownCode = 0;
    this.card.clear();
    this.content.removeAll(true);
    const L = LAYOUT;
    this.logText.setVisible(true);
    this.content.add(text(this.scene, L.x + 1, L.top, "DUEL LOG", { color: THEME.panel.inkSoft }));
    this.content.add(paperInset(this.scene, L.x, LOG_Y - INSET.paper - 1, L.w, L.bottom - LOG_Y + INSET.paper + 1));
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
