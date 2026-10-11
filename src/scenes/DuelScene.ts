import Phaser from "phaser";
import {
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
  type OcgCardLoc,
  type OcgMessage,
  type OcgResponse,
  type SelectFieldPlace,
} from "ocgcore-wasm";
import { loadEngine, type Engine } from "../duel/loadEngine.ts";
import { DuelSession, type CardView, type FieldSnapshot, type Deck } from "../duel/DuelSession.ts";
import { AI, DuelController, HUMAN, type HumanPrompt } from "../duel/DuelController.ts";
import { autoRespond, freePlaces } from "../duel/autoBot.ts";
import { ATTRIBUTE_INDEX, ATTRIBUTE_SHEET, CardSprite, type CardHighlight } from "../ui/duel/CardSprite.ts";
import { Modal, type PickerCard } from "../ui/duel/Modal.ts";
import { describeMessage } from "../ui/duel/duelLog.ts";
import { DuelAnimator } from "../ui/duel/DuelAnimator.ts";
import { CardMenu } from "../ui/duel/CardMenu.ts";
import { CARD, FIELD, FIELD_CENTER, INFO, PHASE_COL, handXY, pileCenters, slotXY, zoneCenters, type Slot } from "../ui/duel/layout.ts";
import { INK, INK_SOFT, PAPER, WHITE, border, text } from "../ui/pixel.ts";
import { makeButton, makeWoodButton, type WoodButton } from "../ui/widgets.ts";
import { installAnimPreview } from "./animPreview.ts";
import { LPBar, LP_BAR } from "../ui/duel/LPBar.ts";
import { PANEL } from "../ui/duel/panelStyles.ts";
import { PHASE_LOOK, TURN_TEXT, type PhaseState } from "../ui/duel/phaseThemes.ts";

export interface DuelSceneData {
  playerDeck?: Deck;
  opponentDeck?: Deck;
  opponentName?: string;
  startingLP?: number;
  /** Fixed duel seed (replays the exact same duel); random when omitted. */
  seed?: number;
  /** Scene to return to when the duel ends. */
  returnScene?: string;
}

interface CardAction {
  label: string;
  response: OcgResponse;
}

const key = (controller: number, location: number, sequence: number) => `${controller}:${location}:${sequence}`;
const locKey = (c: OcgCardLoc) => key(c.controller, c.location, c.sequence);
const DEFENSE = OcgPosition.FACEUP_DEFENSE | OcgPosition.FACEDOWN_DEFENSE;

/** Phase column boxes, top to bottom, with the engine phase bits each one covers. */
const PHASES = [
  { label: "DRAW", bits: 0x1 },
  { label: "STANDBY", bits: 0x2 },
  { label: "MAIN 1", bits: 0x4 },
  { label: "BATTLE", bits: 0x8 | 0x10 | 0x20 | 0x40 | 0x80 },
  { label: "MAIN 2", bits: 0x100 },
  { label: "END", bits: 0x200 },
] as const;
type PhaseAction = "bp" | "m2" | "ep";
const PHASE_ACTION: Partial<Record<number, PhaseAction>> = { 3: "bp", 4: "m2", 5: "ep" };

const ZONE_CENTER = 0xa29e9e, ZONE_ARM = 0xb7b5b5;
/** Info panel geometry: everything sits inside the frame's rim. */
const LAYOUT = (() => {
  const r = PANEL.rim;
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
/** Level stars in the info panel: 7x7 sprite, 3px apart. */
const STAR_SIZE = 7, STAR_GAP = 3;
/** How long an LP change ("-1500") stays inside the LP bar. */
const LP_DELTA_MS = 1200;
/** Info-panel art: 128px art inside a 3px wooden frame. */
const ART_FRAME = 128 + 6;
/** The duel log text starts below its "DUEL LOG" header, inside the paper. */
const LOG_Y = LAYOUT.top + 13;

export class DuelScene extends Phaser.Scene {
  private engine!: Engine;
  private controller!: DuelController;
  private modal!: Modal;
  private sceneData: DuelSceneData = {};

  private board!: Phaser.GameObjects.Container;
  private sprites = new Map<string, CardSprite>();
  private actions = new Map<string, CardAction[]>();
  private phaseActions = new Map<PhaseAction, OcgResponse>();
  private menu: CardMenu | null = null;
  private placeTargets: Phaser.GameObjects.GameObject[] = [];
  private snapshot: FieldSnapshot | null = null;
  private animator!: DuelAnimator;
  private handCount: [number, number] = [0, 0];
  private lpValue: [number, number] = [8000, 8000];
  private startLP = 8000;
  private turnPlayer = 0;
  private phase = 0;

  private infoPanel!: Phaser.GameObjects.Container;
  private infoCode = 0;
  /** Last card shown in the info panel (the LOG/CARD toggle returns to it). */
  private lastCode = 0;
  private panelToggle!: WoodButton;
  /** "card": the panel keeps the last hovered card. "log": shows the log, cards only while hovered. */
  private panelMode: "card" | "log" = "card";
  private hoverTimer: Phaser.Time.TimerEvent | null = null;
  /** Declared attack (sprite keys), outlined until the hit or until the attack ends. */
  private attackMarks: [string | null, string | null] = [null, null];
  private attackArrow: Phaser.GameObjects.Image | null = null;
  private nameScroll: { tween: Phaser.Tweens.Tween; mask: Phaser.GameObjects.Graphics } | null = null;
  private logText!: Phaser.GameObjects.BitmapText;
  private logLines: string[] = [];
  private lpBars!: [LPBar, LPBar];
  private phaseGfx!: Phaser.GameObjects.Container;
  private promptBand!: Phaser.GameObjects.Container;

  constructor() {
    super("Duel");
  }

  init(data: DuelSceneData) {
    this.sceneData = data ?? {};
    this.sprites.clear();
    this.actions.clear();
    this.phaseActions.clear();
    this.logLines = [];
    this.menu = null;
    this.placeTargets = [];
    this.handCount = [0, 0];
    this.startLP = data?.startingLP ?? 8000;
    this.lpValue = [this.startLP, this.startLP];
    this.snapshot = null;
    this.phase = 0;
    this.infoCode = 0;
    this.lastCode = 0;
    this.panelMode = "card";
    this.attackMarks = [null, null];
  }

  async create() {
    this.engine = await loadEngine();
    const { core, cards, readScript } = this.engine;
    this.modal = new Modal(this, cards);

    this.drawStaticBoard();
    this.board = this.add.container(0, 0);
    this.animator = new DuelAnimator({
      scene: this,
      cards,
      sprites: this.sprites,
      board: this.board,
      handCount: this.handCount,
      setPhase: (phase) => { this.phase = phase; this.drawPhaseColumn(); },
      changeLP: (player, lp, delta) => this.changeLP(player, lp, delta),
      lp: (player) => this.lpValue[player === HUMAN ? 0 : 1],
      markAttack: (attacker, target) => {
        this.attackMarks = [attacker, target];
        this.applyHighlights();
      },
    });
    try {
      const saved = Number(localStorage.getItem("duel.animSpeed"));
      if ([1, 2, 4].includes(saved)) this.animator.speed = saved;
    } catch { /* storage unavailable */ }
    this.createInfoPanel();
    this.phaseGfx = this.add.container(0, 0);
    this.drawPhaseColumn();
    this.createPromptBand();
    this.input.on("pointerdown", (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (this.menu && !over.some((o) => this.menu!.exists(o))) this.closeMenu(true);
    });

    const fallback = (): Deck => {
      const pool = [...cards.records.keys()];
      return { main: [...pool, ...pool].slice(0, 40) };
    };
    const session = new DuelSession({
      core, cards, readScript,
      startingLP: this.sceneData.startingLP,
      seed: this.sceneData.seed !== undefined ? ([BigInt(this.sceneData.seed), 0n, 0n, 0n] as [bigint, bigint, bigint, bigint]) : undefined,
      decks: [this.sceneData.playerDeck ?? fallback(), this.sceneData.opponentDeck ?? fallback()],
    });
    this.controller = new DuelController({
      session,
      schedule: (ms, fn) => this.time.delayedCall(ms, fn),
      events: {
        onUpdate: (messages, snapshot) => this.onUpdate(messages, snapshot),
        onPrompt: (prompt, hint) => this.onPrompt(prompt, hint),
        onEnd: (winner) => this.onEnd(winner),
      },
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.controller.stop();
      session.destroy();
    });
    // Debug handle for the browser console (dev builds only).
    if (import.meta.env.DEV) (window as unknown as { duelScene: DuelScene }).duelScene = this;
    this.controller.start();
    // Dev: `&anims` adds a dropdown to replay single animations (see animPreview.ts).
    if (import.meta.env.DEV && new URLSearchParams(location.search).has("anims")) {
      installAnimPreview({ scene: this, animator: this.animator, snapshot: () => this.snapshot, renderBoard: (snap) => this.renderBoard(snap) });
    }
  }

  // ---------------------------------------------------------------- static layout

  private drawStaticBoard() {
    const g = this.add.graphics();
    g.fillStyle(PAPER).fillRect(0, 0, 640, 360);
    for (const side of [0, 1] as const) {
      for (const { x, y } of zoneCenters(side)) {
        // A cross: room for an upright card and a sideways (defense) card.
        g.fillStyle(ZONE_CENTER).fillRect(x - 19, y - 19, 38, 38);
        g.fillStyle(ZONE_ARM).fillRect(x - 19, y - 28, 38, 9).fillRect(x - 19, y + 19, 38, 9);
        g.fillRect(x - 28, y - 19, 9, 38).fillRect(x + 19, y - 19, 9, 38);
      }
      for (const { x, y } of pileCenters(side)) g.fillStyle(ZONE_CENTER).fillRect(x - 19, y - 28, CARD.w, CARD.h);
    }
  }

  private drawPhaseColumn() {
    this.phaseGfx.removeAll(true);
    PHASES.forEach((p, i) => {
      const x = PHASE_COL.x, y = PHASE_COL.top + i * PHASE_COL.pitch;
      const action = PHASE_ACTION[i];
      const clickable = !!action && this.phaseActions.has(action);
      const state: PhaseState = (this.phase & p.bits) !== 0 ? "current" : clickable ? "clickable" : "idle";
      const look = PHASE_LOOK[state];
      const box = this.add.nineslice(x, y, `ui-phase-${state}`, undefined, PHASE_COL.w, PHASE_COL.h, ...look.slice).setOrigin(0);
      this.phaseGfx.add(box);
      // Letters stacked vertically, centred on the button face.
      const color = state === "current" ? (this.turnPlayer === HUMAN ? TURN_TEXT.mine : TURN_TEXT.theirs) : look.text;
      const letters = [...p.label];
      const top = y + Math.floor((PHASE_COL.h - letters.length * 6 + 1) / 2) + look.textDy;
      const glyphs = letters.flatMap((ch, j) => (ch === " " ? [] : [text(this, x + PHASE_COL.w / 2, top + j * 6, ch, { color, originX: 0.5 })]));
      this.phaseGfx.add(glyphs);
      if (clickable) {
        // Press feedback: swap to the pressed frame while the pointer is down.
        const pressed = PHASE_LOOK.idle;
        const hit = this.add.zone(x, y, PHASE_COL.w, PHASE_COL.h).setOrigin(0).setInteractive({ useHandCursor: true });
        hit.on("pointerdown", () => {
          box.setTexture("ui-phase-idle").setSlices(PHASE_COL.w, PHASE_COL.h, ...pressed.slice);
          for (const g of glyphs) g.y += pressed.textDy - look.textDy;
        });
        hit.on("pointerout", () => this.drawPhaseColumn());
        hit.on("pointerup", () => { const r = this.phaseActions.get(action!); if (r) this.answer(r); });
        this.phaseGfx.add(hit);
      }
    });
  }

  private createPromptBand() {
    this.promptBand = this.add.container(0, 0).setDepth(800).setVisible(false);
  }

  private setPrompt(label: string | null) {
    this.promptBand.removeAll(true).setVisible(!!label);
    if (!label) return;
    const t = text(this, FIELD_CENTER.x, FIELD_CENTER.y - 3, label.toUpperCase(), { color: WHITE, originX: 0.5 });
    const bg = this.add.rectangle(FIELD.left, FIELD_CENTER.y - 6, FIELD.right - FIELD.left, 11, INK, 0.85).setOrigin(0);
    this.promptBand.add([bg, t]);
  }

  // ---------------------------------------------------------------- info panel, log, LP

  private createInfoPanel() {
    const L = LAYOUT;
    this.add.nineslice(0, 0, PANEL.frame, undefined, INFO.w, 360, PANEL.rim, PANEL.rim, PANEL.rim, PANEL.rim).setOrigin(0);
    this.lpBars = [
      new LPBar(this, L.bar.x, L.lp.mine, L.bar.w, "You", this.startLP).set(this.startLP),
      new LPBar(this, L.bar.x, L.lp.opp, L.bar.w, this.sceneData.opponentName ?? "Opponent", this.startLP).set(this.startLP),
    ];
    this.infoPanel = this.add.container(0, 0);
    this.logText = text(this, L.x + PANEL.paperRim, LOG_Y, "", { color: PANEL.paperInk, maxWidth: L.w - PANEL.paperRim * 2 }).setDepth(1);
    this.createCornerButtons();
    this.showEmpty();
  }

  /**
   * Top-right corner of the field: animation speed (1x/2x/4x), with the info panel's LOG/CARD toggle
   * below it. Right edges line up with the right pile column (card centre 614).
   */
  private createCornerButtons() {
    const y = 4, speedW = 24, toggleW = speedW;
    const speedX = 614 + CARD.w / 2 - speedW;
    const speeds = [1, 2, 4];
    const speed = makeWoodButton(this, speedX, y, speedW, `${this.animator.speed}X`, () => {
      this.animator.speed = speeds[(speeds.indexOf(this.animator.speed) + 1) % speeds.length];
      speed.setLabel(`${this.animator.speed}X`);
      try { localStorage.setItem("duel.animSpeed", String(this.animator.speed)); } catch { /* storage unavailable */ }
    });
    // Below it, right-aligned: switch the info panel between card mode and log mode.
    this.panelToggle = makeWoodButton(this, speedX + speedW - toggleW, y + 18 + 2, toggleW, "LOG", () => {
      this.panelMode = this.panelMode === "card" ? "log" : "card";
      this.panelToggle.setLabel(this.panelMode === "card" ? "LOG" : "CARD");
      if (this.panelMode === "card" && this.lastCode) this.showCard(this.lastCode);
      else this.showLog();
    });
  }

  /** Cream paper inset whose outer edge is the box (x, y, w, h); text goes inside, padded by its rim. */
  private paper(x: number, y: number, w: number, h: number) {
    const r = PANEL.paperRim;
    this.infoPanel.add(this.add.nineslice(x, y, PANEL.paper, undefined, w, h, r, r, r, r).setOrigin(0));
  }

  /**
   * Pointer entered a card. Card mode: show it and keep it (until another card is hovered).
   * Log mode: show it only while hovered (`hoverEnd` returns to the log).
   */
  private showInfo(code: number) {
    if (!code || !this.engine.cards.records.has(code)) return;
    this.hoverTimer?.remove();
    this.lastCode = code;
    this.showCard(code);
  }

  /** Pointer left a card: in log mode, go back to the log (slightly delayed so moving between cards doesn't flicker). */
  private hoverEnd() {
    if (this.panelMode !== "log") return;
    this.hoverTimer?.remove();
    this.hoverTimer = this.time.delayedCall(120, () => this.showLog());
  }

  /** Renders a card's details in the info panel. */
  private showCard(code: number) {
    const r = this.engine.cards.records.get(code);
    if (!r) return;
    this.infoCode = code;
    this.logText.setVisible(false);
    this.stopNameScroll();
    const p = this.infoPanel.removeAll(true);
    const L = LAYOUT, ink = PANEL.ink;
    const monster = (r.type & 0x1) !== 0;

    // Name at 2x; names wider than the space before the attribute icon scroll (see scrollName).
    const nameW = L.w - 20;
    const name = text(this, L.x, L.top, r.name.toUpperCase(), { scale: 2, color: ink });
    p.add(name);
    if (name.width > nameW) this.scrollName(name, nameW);
    const attr = ATTRIBUTE_INDEX[r.attribute];
    if (monster && attr !== undefined) p.add(this.add.image(L.x + L.w - 16, L.top - 1, ATTRIBUTE_SHEET, attr).setOrigin(0));
    if (monster) for (let i = 0; i < (r.level & 0xff); i++) p.add(this.add.image(L.x + i * (STAR_SIZE + STAR_GAP), L.top + 14, "ui-star").setOrigin(0));
    // 128x128 art in a wooden frame (the LP bar's frame, nine-sliced), loaded on first view.
    const artY = L.top + 24;
    const artKey = `art128-${code}`;
    p.add(this.add.nineslice(L.x, artY, "ui-lp-frame", undefined, ART_FRAME, ART_FRAME, 3, 3, 3, 3).setOrigin(0));
    const placeArt = () => { if (this.infoCode === code && p.active) p.add(this.add.image(L.x + 3, artY + 3, artKey).setOrigin(0)); };
    if (this.textures.exists(artKey)) placeArt();
    else {
      this.load.image(artKey, `cards/art128/${code}.png`);
      this.load.once(`filecomplete-image-${artKey}`, placeArt);
      this.load.start();
    }
    const stats = monster
      ? [`ATK ${r.atk < 0 ? "?" : r.atk}`, `DEF ${r.def < 0 ? "?" : r.def}`, `LV ${r.level & 0xff}`, raceName(BigInt(r.race))]
      : [r.type & 0x2 ? "SPELL" : "TRAP", spellTrapKind(r.type)];
    const statX = L.x + ART_FRAME + 4;
    stats.forEach((s, i) => p.add(text(this, statX, artY + 4 + i * 16, s, { scale: s.length * 8 > L.x + L.w - statX ? 1 : 2, color: ink })));
    const descY = artY + ART_FRAME + 5;
    this.paper(L.x, descY, L.w, L.bottom - descY);
    const pad = PANEL.paperRim + 1;
    p.add(text(this, L.x + pad, descY + pad, r.desc, { maxWidth: L.w - pad * 2, color: PANEL.paperInk }));
  }

  /**
   * Marquee for long card names: wait, scroll left until the end is visible, pause, jump back to the
   * start, pause, repeat. The name is clipped to `width` by a geometry mask.
   */
  private scrollName(name: Phaser.GameObjects.BitmapText, width: number) {
    const mask = this.make.graphics({}, false);
    mask.fillStyle(0xffffff).fillRect(name.x, name.y - 1, width, name.height + 2);
    name.setMask(mask.createGeometryMask());
    const overflow = name.width - width;
    this.nameScroll = {
      mask,
      tween: this.tweens.add({
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
    this.infoCode = 0;
    this.stopNameScroll();
    this.infoPanel.removeAll(true);
    this.logText.setVisible(false);
  }

  /** Renders the duel log in the info panel. */
  private showLog() {
    this.infoCode = 0;
    this.stopNameScroll();
    this.infoPanel.removeAll(true);
    const L = LAYOUT;
    this.logText.setVisible(true);
    this.infoPanel.add(text(this, L.x + 1, L.top, "DUEL LOG", { color: PANEL.inkSoft }));
    this.paper(L.x, LOG_Y - PANEL.paperRim - 1, L.w, L.bottom - LOG_Y + PANEL.paperRim + 1);
    this.renderLog();
  }

  private log(line: string) {
    this.logLines.push(line.toUpperCase());
    while (this.logLines.length > 200) this.logLines.shift();
    this.renderLog();
  }

  private renderLog() {
    // Show as many recent lines as fit above the speed button.
    const room = LAYOUT.bottom - PANEL.paperRim - this.logText.y;
    for (let n = Math.min(this.logLines.length, 45); n >= 0; n--) {
      this.logText.setText(this.logLines.slice(this.logLines.length - n).join("\n"));
      if (this.logText.height <= room) break;
    }
  }

  // ---------------------------------------------------------------- engine events

  private async onUpdate(messages: OcgMessage[], snapshot: FieldSnapshot): Promise<void> {
    if (!this.snapshot) {
      // First update: show full decks and empty hands so the opening draw has something to animate from.
      this.renderBoard({
        players: snapshot.players.map((p) => ({ ...p, hand: [], deckCount: p.deckCount + p.hand.length })) as unknown as FieldSnapshot["players"],
      });
    }
    await this.animator.play(messages, (m) => {
      if (m.type === OcgMessageType.NEW_TURN) this.turnPlayer = m.player;
      // Card mode starts empty; the first card you draw fills it.
      if (m.type === OcgMessageType.DRAW && m.player === HUMAN && !this.lastCode && m.drawn[0]?.code) {
        this.lastCode = m.drawn[0].code;
        if (this.panelMode === "card") this.showCard(this.lastCode);
      }
      const line = describeMessage(m, this.engine.text);
      if (line) this.log(line);
    });
    this.snapshot = snapshot;
    this.renderBoard(snapshot);
  }

  /** Counts the LP bar to `lp`, with a floating +/- label. */
  private changeLP(player: number, lp: number, delta: number): Promise<void> {
    const i = (player === HUMAN ? 0 : 1) as 0 | 1;
    const from = this.lpValue[i];
    const to = Math.max(0, lp);
    this.lpValue[i] = to;
    if (delta) this.lpBars[i].showDelta(delta, LP_DELTA_MS / this.animator.speed);
    return new Promise((resolve) => {
      this.tweens.addCounter({
        from, to, duration: 450 / this.animator.speed,
        onUpdate: (t) => this.lpBars[i].set(t.getValue() ?? to),
        onComplete: () => resolve(),
      });
    });
  }

  private onEnd(winner: number | null) {
    this.clearInteraction();
    const won = winner === HUMAN;
    this.modal.dialog(won ? "YOU WIN THE DUEL!" : winner === AI ? "YOU LOST THE DUEL..." : "THE DUEL ENDED IN A DRAW.", [
      { label: "CONTINUE", onClick: () => this.scene.start(this.sceneData.returnScene ?? "Overworld", { duelResult: { won } }) },
    ]);
  }

  // ---------------------------------------------------------------- board rendering

  private renderBoard(snap: FieldSnapshot) {
    this.board.removeAll(true);
    this.sprites.clear();
    snap.players.forEach((p, side) => {
      const s = side as 0 | 1;
      this.handCount[s] = p.hand.length;
      this.lpValue[s] = p.lp;
      this.lpBars[s].set(p.lp);
      p.monsters.forEach((c, seq) => c && this.placeCard(c, slotXY(s, { kind: "mzone", seq })));
      p.spells.forEach((c, seq) => c && this.placeCard(c, slotXY(s, { kind: "szone", seq })));
      this.drawPile(s, { kind: "deck" }, p.deckCount, null);
      this.drawPile(s, { kind: "extra" }, p.extraCount, null);
      this.drawPile(s, { kind: "grave" }, p.grave.length, p.grave.at(-1) ?? null, [...p.grave].reverse(), p.banished);
      this.drawHand(s, p.hand);
    });
    this.applyHighlights();
  }

  private placeCard(c: CardView, at: { x: number; y: number }) {
    const sp = this.cardSprite(c, at.x, at.y);
    if (c.location === OcgLocation.MZONE && c.position & DEFENSE) sp.setAngle(90);
  }

  private drawPile(side: 0 | 1, slot: Slot, count: number, top: CardView | null, contents?: CardView[], banished: CardView[] = []) {
    const { x, y } = slotXY(side, slot);
    if (count) {
      const sp = new CardSprite(this, x, y).show(top?.code ?? 0, this.engine.cards.records.get(top?.code ?? 0), { back: !top });
      sp.setInteractive({ useHandCursor: !!contents });
      if (top) {
        sp.on("pointerover", () => this.showInfo(top.code));
        sp.on("pointerout", () => this.hoverEnd());
      }
      if (contents) sp.on("pointerup", () => this.browsePile(contents, banished));
      this.board.add([sp, this.badge(x + 19, y - 28, String(count), 1)]);
    }
    // Banished cards have no zone in this layout: a badge under the Graveyard, listed when browsing it.
    if (banished.length) this.board.add(this.badge(x + 19, y + 28, `B${banished.length}`, 1, 1));
  }

  /** Small white-on-black number, anchored by its (originX, originY) corner at (x, y). */
  private badge(x: number, y: number, label: string, originX: number, originY = 0): Phaser.GameObjects.Container {
    const t = text(this, 0, 0, label, { color: WHITE });
    const w = t.width + 4, h = 7;
    const left = Math.round(x - w * originX), top = Math.round(y - h * originY);
    t.setPosition(left + 2, top + 1);
    return this.add.container(0, 0, [this.add.rectangle(left, top, w, h, INK).setOrigin(0), t]);
  }

  private drawHand(side: 0 | 1, hand: CardView[]) {
    hand.forEach((c, i) => {
      const { x, y } = handXY(side, i, hand.length);
      const sp = this.cardSprite(c, x, y);
      if (side === HUMAN) {
        // Hover lift. Skipped while animating, and for a sprite that has since left the hand (an
        // animation may be flying it to the field), so it never fights an animation.
        const k = key(c.controller, c.location, c.sequence);
        const lift = (dy: number) => {
          if (this.animator.busy || this.sprites.get(k) !== sp) return;
          this.tweens.add({ targets: sp, y: y - dy, duration: 80 });
        };
        sp.on("pointerover", () => lift(6));
        sp.on("pointerout", () => lift(0));
      }
    });
  }

  private cardSprite(c: CardView, x: number, y: number): CardSprite {
    const onField = c.location === OcgLocation.MZONE;
    const sp = new CardSprite(this, x, y).show(c.code, this.engine.cards.records.get(c.code), {
      // Face-down cards show the back, yours too; hovering your own still shows it in the info panel.
      back: c.code === 0 || c.faceDown,
      atk: onField ? c.attack : undefined, def: onField ? c.defense : undefined,
    });
    sp.setInteractive({ useHandCursor: true });
    const k = key(c.controller, c.location, c.sequence);
    sp.on("pointerover", () => c.code && this.showInfo(c.code));
    sp.on("pointerout", () => this.hoverEnd());
    sp.on("pointerup", () => this.onCardClick(k));
    this.sprites.set(k, sp);
    this.board.add(sp);
    return sp;
  }

  private browsePile(contents: CardView[], banished: CardView[]) {
    if (this.modal.isOpen || !contents.length && !banished.length) return;
    const pending = this.controller.waitingForHuman;
    this.modal.picker({
      title: banished.length ? "Graveyard (newest first), then banished" : "Graveyard (newest first)",
      cards: [...contents, ...[...banished].reverse()].map((c) => ({ code: c.code, locked: true })),
      mode: "single",
      onConfirm: () => {},
      buttons: [{ label: "Close", onClick: () => pending && this.onPrompt(pending, null, true) }],
      onHover: (code) => this.showInfo(code),
      onHoverEnd: () => this.hoverEnd(),
    });
  }

  // ---------------------------------------------------------------- prompts

  private answer(response: OcgResponse) {
    if (!this.controller.waitingForHuman) return;
    this.clearInteraction();
    this.controller.answer(response);
  }

  private clearInteraction() {
    this.setPrompt(null);
    this.actions.clear();
    this.phaseActions.clear();
    this.closeMenu();
    for (const o of this.placeTargets) o.destroy();
    this.placeTargets = [];
    this.drawPhaseColumn();
    this.applyHighlights();
  }

  /**
   * Red Runewood arrow (8x6) on the declared attacker's edge facing the opponent, pointing toward it:
   * up on your monster's top edge, down on the opponent's bottom edge. It straddles the edge because the
   * gap between the two monster rows (6px) can't fit it.
   */
  private drawAttackArrow(sp: CardSprite | undefined) {
    this.attackArrow?.destroy();
    this.attackArrow = null;
    if (!sp) return;
    const mine = sp.y > FIELD_CENTER.y;
    const y = (mine ? sp.y - CARD.h / 2 : sp.y + CARD.h / 2) - 3;
    this.attackArrow = this.add.image(sp.x - 4, y, mine ? "ui-attack-up" : "ui-attack-down").setOrigin(0).setDepth(50);
    this.board.add(this.attackArrow);
  }

  /**
   * Playable cards aren't outlined; only the cursor tells them apart (hand cursor on cards with an
   * action, plain arrow elsewhere). `extra` can still mark cards explicitly.
   */
  private applyHighlights(extra?: Map<string, CardHighlight>) {
    const [attacker, target] = this.attackMarks;
    this.drawAttackArrow(attacker ? this.sprites.get(attacker) : undefined);
    for (const [k, sp] of this.sprites) {
      sp.setHighlight(extra?.get(k) ?? (k === attacker ? "attacker" : k === target ? "attacked" : "none"));
      if (sp.input) sp.input.cursor = this.actions.has(k) ? "pointer" : "default";
    }
  }

  private onPrompt(m: HumanPrompt, hint: bigint | null, reopen = false) {
    const t = this.engine.text;
    const title = (fallback: string) => (hint ? t.describe(hint) : fallback);
    const name = (code: number) => t.name(code);
    if (!reopen) this.clearInteraction();

    switch (m.type) {
      case OcgMessageType.SELECT_IDLECMD: {
        const add = (cards: OcgCardLoc[], label: string, action: SelectIdleCMDAction) =>
          cards.forEach((c, index) => this.addAction(c, label, { type: OcgResponseType.SELECT_IDLECMD, action, index }));
        add(m.summons, "Summon", SelectIdleCMDAction.SELECT_SUMMON);
        add(m.special_summons, "Sp.Sum", SelectIdleCMDAction.SELECT_SPECIAL_SUMMON);
        add(m.monster_sets, "Set", SelectIdleCMDAction.SELECT_MONSTER_SET);
        m.pos_changes.forEach((c, index) => this.addAction(c, this.positionLabel(c), {
          type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_POS_CHANGE, index,
        }));
        m.activates.forEach((c, index) => this.addAction(c, "Use", {
          type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index,
        }));
        // Last, so a Spell/Trap in hand lists USE before SET.
        add(m.spell_sets, "Set", SelectIdleCMDAction.SELECT_SPELL_SET);
        if (m.to_bp) this.phaseActions.set("bp", { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null });
        if (m.to_ep) this.phaseActions.set("ep", { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null });
        this.drawPhaseColumn();
        this.applyHighlights();
        return;
      }
      case OcgMessageType.SELECT_BATTLECMD: {
        m.attacks.forEach((c, index) => this.addAction(c, "Attack", { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index }));
        m.chains.forEach((c, index) => this.addAction(c, "Use", {
          type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_CHAIN, index,
        }));
        if (m.to_m2) this.phaseActions.set("m2", { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_M2, index: null });
        if (m.to_ep) this.phaseActions.set("ep", { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_EP, index: null });
        this.drawPhaseColumn();
        this.applyHighlights();
        return;
      }
      case OcgMessageType.SELECT_CHAIN:
        this.modal.picker({
          title: m.forced ? "You must activate an effect" : "Chain an effect?",
          cards: m.selects.map((c) => ({ code: c.code, caption: this.activateLabel(c.code, c.description) })),
          mode: "single",
          onConfirm: ([i]) => this.answer({ type: OcgResponseType.SELECT_CHAIN, index: i }),
          buttons: m.forced ? [] : [{ label: "Don't chain", onClick: () => this.answer({ type: OcgResponseType.SELECT_CHAIN, index: null }) }],
          onHover: (code) => this.showInfo(code),
          onHoverEnd: () => this.hoverEnd(),
        });
        return;
      case OcgMessageType.SELECT_EFFECTYN: {
        const msg = m.description ? t.describe(m.description, name(m.code)) : t.describe(95, name(m.code));
        this.yesNo(msg || `Activate the effect of "${name(m.code)}"?`, (yes) => ({ type: OcgResponseType.SELECT_EFFECTYN, yes }), m.code);
        return;
      }
      case OcgMessageType.SELECT_YESNO:
        this.yesNo(t.describe(m.description), (yes) => ({ type: OcgResponseType.SELECT_YESNO, yes }));
        return;
      case OcgMessageType.SELECT_OPTION:
        this.modal.dialog(title("Choose an option").toUpperCase(), m.options.map((o, index) => ({
          label: t.describe(o).toUpperCase(), onClick: () => this.answer({ type: OcgResponseType.SELECT_OPTION, index }),
        })));
        return;
      case OcgMessageType.SELECT_POSITION: {
        const choices: [OcgPosition, string][] = [
          [OcgPosition.FACEUP_ATTACK, "ATTACK"], [OcgPosition.FACEDOWN_ATTACK, "FD ATTACK"],
          [OcgPosition.FACEUP_DEFENSE, "DEFENSE"], [OcgPosition.FACEDOWN_DEFENSE, "FD DEFENSE"],
        ];
        this.modal.dialog(`BATTLE POSITION FOR "${name(m.code).toUpperCase()}"`, choices.filter(([p]) => m.positions & p).map(([position, label]) => ({
          label, onClick: () => this.answer({ type: OcgResponseType.SELECT_POSITION, position }),
        })), m.code);
        return;
      }
      case OcgMessageType.SELECT_CARD:
        this.modal.picker({
          title: title(`Select ${range(m.min, m.max)} card(s)`),
          cards: m.selects.map((c) => ({ code: c.code, caption: locationName(c.location, c.controller) })),
          mode: m.min === 1 && m.max === 1 ? "single" : "multi",
          isValid: (sel) => sel.length >= m.min && sel.length <= m.max,
          onConfirm: (sel) => this.answer({ type: OcgResponseType.SELECT_CARD, indicies: sel }),
          buttons: m.can_cancel ? [{ label: "Cancel", onClick: () => this.answer({ type: OcgResponseType.SELECT_CARD, indicies: null }) }] : [],
          onHover: (code) => this.showInfo(code),
          onHoverEnd: () => this.hoverEnd(),
        });
        return;
      case OcgMessageType.SELECT_TRIBUTE:
        this.modal.picker({
          title: title("Select monster(s) to Tribute"),
          cards: m.selects.map((c) => ({ code: c.code, caption: locationName(c.location, c.controller) })),
          mode: "multi",
          // release_param: how many tributes this card counts as (Double Tribute monsters count 2).
          isValid: (sel) => {
            const worth = sel.reduce((n, i) => n + (m.selects[i].release_param || 1), 0);
            return worth >= m.min && sel.length <= m.max && sel.length > 0;
          },
          onConfirm: (sel) => this.answer({ type: OcgResponseType.SELECT_TRIBUTE, indicies: sel }),
          buttons: m.can_cancel ? [{ label: "Cancel", onClick: () => this.answer({ type: OcgResponseType.SELECT_TRIBUTE, indicies: null }) }] : [],
          onHover: (code) => this.showInfo(code),
          onHoverEnd: () => this.hoverEnd(),
        });
        return;
      case OcgMessageType.SELECT_UNSELECT_CARD: {
        const cards: PickerCard[] = [
          ...m.select_cards.map((c) => ({ code: c.code, caption: locationName(c.location, c.controller) })),
          ...m.unselect_cards.map((c) => ({ code: c.code, caption: "CHOSEN", selected: true })),
        ];
        const buttons = [];
        if (m.can_finish) buttons.push({ label: "Finish", onClick: () => this.answer({ type: OcgResponseType.SELECT_UNSELECT_CARD, index: null }) });
        else if (m.can_cancel) buttons.push({ label: "Cancel", onClick: () => this.answer({ type: OcgResponseType.SELECT_UNSELECT_CARD, index: null }) });
        this.modal.picker({
          title: title(`Select ${range(m.min, m.max)} card(s)`), cards, mode: "single", buttons,
          onConfirm: ([i]) => this.answer({ type: OcgResponseType.SELECT_UNSELECT_CARD, index: i }),
          onHover: (code) => this.showInfo(code),
          onHoverEnd: () => this.hoverEnd(),
        });
        return;
      }
      case OcgMessageType.SELECT_SUM: {
        const must = m.selects_must.map((c) => c.amount);
        this.modal.picker({
          title: title(`Select cards with a total of ${m.amount}`),
          cards: [
            ...m.selects_must.map((c) => ({ code: c.code, locked: true })),
            ...m.selects.map((c) => ({ code: c.code, caption: `VALUE ${c.amount & 0xffff}` })),
          ],
          mode: "multi",
          isValid: (sel) => {
            const chosen = sel.filter((i) => i >= must.length).map((i) => m.selects[i - must.length].amount);
            return chosen.length >= m.min && chosen.length <= m.max && sumMatches([...must, ...chosen], m.amount, m.select_max !== 0);
          },
          onConfirm: (sel) => this.answer({ type: OcgResponseType.SELECT_SUM, indicies: sel.filter((i) => i >= must.length).map((i) => i - must.length) }),
          onHover: (code) => this.showInfo(code),
          onHoverEnd: () => this.hoverEnd(),
        });
        return;
      }
      case OcgMessageType.SELECT_PLACE:
      case OcgMessageType.SELECT_DISFIELD:
        // For zone prompts the hint is the passcode of the card being placed, not a string id.
        this.pickPlaces(m.type, m.player, m.field_mask, m.count, hint && this.engine.cards.records.has(Number(hint))
          ? t.describe(569, name(Number(hint)))
          : t.describe(m.type === OcgMessageType.SELECT_PLACE ? 560 : 570));
        return;
      default:
        // Rare in the GOAT pool (announce, counters, sorting, RPS): let the bot answer for now.
        this.log(`(auto-answered ${OcgMessageType[m.type] ?? m.type})`);
        this.answer(autoRespond(m));
    }
  }

  private yesNo(msg: string, make: (yes: boolean) => OcgResponse, code?: number) {
    this.modal.dialog(msg.toUpperCase(), [
      { label: "YES", onClick: () => this.answer(make(true)) },
      { label: "NO", onClick: () => this.answer(make(false)) },
    ], code);
  }

  private activateLabel(code: number, desc: bigint): string {
    const d = this.engine.text.describe(desc, this.engine.text.name(code));
    return d && !d.startsWith("#") ? d : "Activate";
  }

  /** Card menu labels fit 6 letters: a set monster can be flipped, a face-up one switched. */
  private positionLabel(c: OcgCardLoc): string {
    const pos = this.snapshot?.players[c.controller].monsters[c.sequence]?.position ?? 0;
    if (pos & (OcgPosition.FACEDOWN_ATTACK | OcgPosition.FACEDOWN_DEFENSE)) return "Flip";
    return pos & OcgPosition.FACEUP_DEFENSE ? "To Atk" : "To Def";
  }

  private addAction(c: OcgCardLoc, label: string, response: OcgResponse) {
    const k = locKey(c);
    const list = this.actions.get(k) ?? [];
    list.push({ label, response });
    this.actions.set(k, list);
  }

  private onCardClick(k: string) {
    if (this.modal.isOpen) return;
    const list = this.actions.get(k);
    const sp = this.sprites.get(k);
    if (!list || !sp) return;
    this.closeMenu(true);
    this.menu = new CardMenu(this, sp, list.map((a) => ({ label: a.label, onClick: () => this.answer(a.response) })));
  }

  /** `animate`: the card flips back face-up (dismissed); otherwise it reappears at once (action chosen). */
  private closeMenu(animate = false) {
    this.menu?.close(animate);
    this.menu = null;
  }

  /** Highlights free zones on the field; collects `count` clicks, then responds. */
  private pickPlaces(type: OcgMessageType, player: number, fieldMask: number, count: number, label: string) {
    const free = freePlaces(player, fieldMask, 32);
    const chosen: SelectFieldPlace[] = [];
    this.setPrompt(label);
    for (const place of free) {
      if (place.location === OcgLocation.MZONE && place.sequence > 4) continue; // no Extra Monster Zones in GOAT
      const side = (place.player === HUMAN ? 0 : 1) as 0 | 1;
      const slot: Slot = place.location === OcgLocation.MZONE ? { kind: "mzone", seq: place.sequence } : { kind: "szone", seq: place.sequence };
      const { x, y } = slotXY(side, slot);
      const g = this.add.graphics().setDepth(790);
      g.fillStyle(0xffd400, 0.3).fillRect(x - 19, y - 28, CARD.w, CARD.h);
      border(g, x - 19, y - 28, CARD.w, CARD.h, 0xffd400);
      const hit = this.add.zone(x, y, CARD.w, CARD.h).setInteractive({ useHandCursor: true }).setDepth(791);
      hit.on("pointerup", () => {
        chosen.push(place);
        g.destroy();
        hit.destroy();
        if (chosen.length >= count) {
          this.answer(type === OcgMessageType.SELECT_PLACE
            ? { type: OcgResponseType.SELECT_PLACE, places: chosen }
            : { type: OcgResponseType.SELECT_DISFIELD, places: chosen });
        }
      });
      this.placeTargets.push(g, hit);
    }
  }
}

function range(min: number, max: number) {
  return min === max ? String(min) : `${min}-${max}`;
}

function locationName(location: number, controller: number): string {
  const owner = controller === HUMAN ? "" : "OPP ";
  const names: Record<number, string> = {
    [OcgLocation.DECK]: "DECK", [OcgLocation.HAND]: "HAND", [OcgLocation.MZONE]: "FIELD",
    [OcgLocation.SZONE]: "S/T", [OcgLocation.GRAVE]: "GY", [OcgLocation.REMOVED]: "BANISHED", [OcgLocation.EXTRA]: "EXTRA",
  };
  return `${owner}${names[location] ?? "?"}`;
}

const RACES: [bigint, string][] = [
  [0x1n, "WARRIOR"], [0x2n, "SPELLCASTER"], [0x4n, "FAIRY"], [0x8n, "FIEND"], [0x10n, "ZOMBIE"], [0x20n, "MACHINE"],
  [0x40n, "AQUA"], [0x80n, "PYRO"], [0x100n, "ROCK"], [0x200n, "WINGED BEAST"], [0x400n, "PLANT"], [0x800n, "INSECT"],
  [0x1000n, "THUNDER"], [0x2000n, "DRAGON"], [0x4000n, "BEAST"], [0x8000n, "BEAST-WARRIOR"], [0x10000n, "DINOSAUR"],
  [0x20000n, "FISH"], [0x40000n, "SEA SERPENT"], [0x80000n, "REPTILE"], [0x100000n, "PSYCHIC"], [0x200000n, "DIVINE-BEAST"],
];
function raceName(race: bigint): string {
  return RACES.find(([bit]) => race & bit)?.[1] ?? "";
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

/**
 * SELECT_SUM check. Each amount packs two alternative values (low/high 16 bits, e.g. level
 * modifiers). `atLeast` = the sum may exceed the target, but no chosen card may be unnecessary.
 */
function sumMatches(amounts: number[], target: number, atLeast: boolean): boolean {
  const options = amounts.map((a) => [a & 0xffff, a >>> 16].filter((v, i) => i === 0 || v > 0));
  const sums = new Set<number>([0]);
  for (const opt of options) {
    const next = new Set<number>();
    for (const s of sums) for (const v of opt) next.add(s + v);
    sums.clear();
    for (const s of next) sums.add(s);
  }
  if (!atLeast) return sums.has(target);
  const min = Math.min(...amounts.map((a) => a & 0xffff));
  return [...sums].some((s) => s >= target && s - min < target);
}
