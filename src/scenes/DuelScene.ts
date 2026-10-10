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
import { CARD, DIVIDER, FIELD, FIELD_CENTER, INFO, PHASE_COL, handXY, pileCenters, slotXY, zoneCenters, type Slot } from "../ui/duel/layout.ts";
import { INK, INK_SOFT, PAPER, WHITE, border, text } from "../ui/pixel.ts";
import { makeButton } from "../ui/widgets.ts";

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
  { label: "DRAW P.", bits: 0x1 },
  { label: "STAND", bits: 0x2 },
  { label: "MAIN 1", bits: 0x4 },
  { label: "BATTLE", bits: 0x8 | 0x10 | 0x20 | 0x40 | 0x80 },
  { label: "MAIN 2", bits: 0x100 },
  { label: "END P.", bits: 0x200 },
] as const;
type PhaseAction = "bp" | "m2" | "ep";
const PHASE_ACTION: Partial<Record<number, PhaseAction>> = { 3: "bp", 4: "m2", 5: "ep" };

const PHASE_BOX = 0xd3a64a, PHASE_MINE = 0x1d6da0, PHASE_THEIRS = 0xa02020;
const ZONE_CENTER = 0xa29e9e, ZONE_ARM = 0xb7b5b5;
const LP_BORDER = 0x11068c, LP_FILL = 0x1d6da0;

export class DuelScene extends Phaser.Scene {
  private engine!: Engine;
  private controller!: DuelController;
  private modal!: Modal;
  private sceneData: DuelSceneData = {};

  private board!: Phaser.GameObjects.Container;
  private sprites = new Map<string, CardSprite>();
  private actions = new Map<string, CardAction[]>();
  private phaseActions = new Map<PhaseAction, OcgResponse>();
  private menu: Phaser.GameObjects.Container | null = null;
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
  private infoTimer: Phaser.Time.TimerEvent | null = null;
  private logText!: Phaser.GameObjects.BitmapText;
  private logLines: string[] = [];
  private lpBars!: [Phaser.GameObjects.Container, Phaser.GameObjects.Container];
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
      if (this.menu && !over.some((o) => this.menu!.exists(o))) this.closeMenu();
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
  }

  // ---------------------------------------------------------------- static layout

  private drawStaticBoard() {
    const g = this.add.graphics();
    g.fillStyle(PAPER).fillRect(0, 0, 640, 360);
    g.fillStyle(INK).fillRect(DIVIDER.x, 0, DIVIDER.w, 360);
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
      const current = (this.phase & p.bits) !== 0;
      const action = PHASE_ACTION[i];
      const clickable = !!action && this.phaseActions.has(action);
      const g = this.add.graphics();
      g.fillStyle(current ? (this.turnPlayer === HUMAN ? PHASE_MINE : PHASE_THEIRS) : PHASE_BOX).fillRect(x, y, PHASE_COL.w, PHASE_COL.h);
      if (clickable) border(g, x - 1, y - 1, PHASE_COL.w + 2, PHASE_COL.h + 2, 0xffd400, 2);
      this.phaseGfx.add(g);
      // Letters stacked vertically, centred in the box.
      const letters = [...p.label];
      const top = y + Math.floor((PHASE_COL.h - letters.length * 6 + 1) / 2);
      letters.forEach((ch, j) => {
        if (ch !== " ") this.phaseGfx.add(text(this, x + PHASE_COL.w / 2, top + j * 6, ch, { color: current ? WHITE : INK, originX: 0.5 }));
      });
      if (clickable) {
        const hit = this.add.zone(x, y, PHASE_COL.w, PHASE_COL.h).setOrigin(0).setInteractive({ useHandCursor: true });
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
    this.lpBars = [this.add.container(8, 347), this.add.container(8, 4)];
    this.drawLPBar(0, this.startLP);
    this.drawLPBar(1, this.startLP);
    this.infoPanel = this.add.container(0, 0);
    this.logText = text(this, 8, 26, "", { color: INK, maxWidth: INFO.w - 14 });
    const speeds = [1, 2, 4];
    const toggle = makeButton(this, 196, 337, 40, 9, `ANIM ${this.animator.speed}X`, () => {
      this.animator.speed = speeds[(speeds.indexOf(this.animator.speed) + 1) % speeds.length];
      toggle.setLabel(`ANIM ${this.animator.speed}X`);
      try { localStorage.setItem("duel.animSpeed", String(this.animator.speed)); } catch { /* storage unavailable */ }
    }, 0x55607a);
    this.showLog();
  }

  /** Shows a card's details (hover) — replaces the log until the pointer leaves the card. */
  private showInfo(code: number) {
    const r = this.engine.cards.records.get(code);
    if (!code || !r) return;
    this.infoTimer?.remove();
    this.infoCode = code;
    this.logText.setVisible(false);
    const p = this.infoPanel.removeAll(true);
    const monster = (r.type & 0x1) !== 0;

    const title = r.name.toUpperCase();
    const big = text(this, 8, 30, title, { scale: 2 });
    if (big.width > 156) { big.destroy(); p.add(text(this, 8, 30, title, { maxWidth: 156 })); } else p.add(big);
    const attr = ATTRIBUTE_INDEX[r.attribute];
    if (monster && attr !== undefined) p.add(this.add.image(168, 30, ATTRIBUTE_SHEET, attr).setOrigin(0));
    if (monster) {
      const g = this.add.graphics();
      for (let i = 0; i < (r.level & 0xff); i++) {
        g.fillStyle(0xd62020).fillRect(8 + i * 7, 46, 5, 5);
        g.fillStyle(0xffd23f).fillRect(10 + i * 7, 48, 1, 1);
      }
      p.add(g);
    }
    // 128x128 art, loaded on first view.
    const artKey = `art128-${code}`;
    const frame = this.add.rectangle(8, 56, 128, 128, INK_SOFT).setOrigin(0);
    p.add(frame);
    const placeArt = () => { if (this.infoCode === code && p.active) p.add(this.add.image(8, 56, artKey).setOrigin(0)); };
    if (this.textures.exists(artKey)) placeArt();
    else {
      this.load.image(artKey, `cards/art128/${code}.png`);
      this.load.once(`filecomplete-image-${artKey}`, placeArt);
      this.load.start();
    }
    const stats = monster
      ? [`ATK ${r.atk < 0 ? "?" : r.atk}`, `DEF ${r.def < 0 ? "?" : r.def}`, `LV ${r.level & 0xff}`, raceName(BigInt(r.race))]
      : [r.type & 0x2 ? "SPELL" : "TRAP", spellTrapKind(r.type)];
    stats.forEach((s, i) => p.add(text(this, 142, 60 + i * 16, s, { scale: s.length > 9 ? 1 : 2 })));
    p.add(text(this, 8, 192, r.desc, { maxWidth: INFO.w - 14 }));
  }

  /** Back to the log shortly after the pointer leaves a card (so moving across cards doesn't flicker). */
  private hideInfoSoon() {
    this.infoTimer?.remove();
    this.infoTimer = this.time.delayedCall(150, () => this.showLog());
  }

  private showLog() {
    this.infoCode = 0;
    this.infoPanel.removeAll(true);
    this.logText.setVisible(true);
    this.infoPanel.add(text(this, 8, 17, "DUEL LOG", { color: INK_SOFT }));
    this.renderLog();
  }

  private log(line: string) {
    this.logLines.push(line.toUpperCase());
    while (this.logLines.length > 200) this.logLines.shift();
    this.renderLog();
  }

  private renderLog() {
    // Show as many recent lines as fit above the speed button.
    for (let n = Math.min(this.logLines.length, 45); n >= 0; n--) {
      this.logText.setText(this.logLines.slice(this.logLines.length - n).join("\n"));
      if (this.logText.height <= 304) break;
    }
  }

  private drawLPBar(i: 0 | 1, lp: number) {
    const c = this.lpBars[i].removeAll(true);
    const g = this.add.graphics();
    border(g, 0, 0, 208, 9, LP_BORDER);
    g.fillStyle(0xffffff).fillRect(1, 1, 206, 7);
    g.fillStyle(LP_FILL).fillRect(1, 1, Math.round(206 * Math.min(1, Math.max(0, lp) / this.startLP)), 7);
    const name = i === 0 ? "YOU" : (this.sceneData.opponentName ?? "OPPONENT").toUpperCase();
    c.add([g, text(this, 3, 2, String(Math.round(lp)), { color: INK }), text(this, 205, 2, name, { color: INK, originX: 1 })]);
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
    if (delta) this.floatLP(i, delta > 0 ? `+${delta}` : `${delta}`, delta > 0 ? 0x2ecc40 : 0xd62020);
    return new Promise((resolve) => {
      this.tweens.addCounter({
        from, to, duration: 450 / this.animator.speed,
        onUpdate: (t) => this.drawLPBar(i, t.getValue() ?? to),
        onComplete: () => resolve(),
      });
    });
  }

  private floatLP(i: 0 | 1, label: string, color: number) {
    const y = i === 0 ? 334 : 16;
    const f = text(this, 110, y, label, { color, scale: 2, originX: 0.5 }).setDepth(500);
    this.tweens.add({ targets: f, y: y + (i === 0 ? -24 : 24), alpha: 0, duration: 1200, onComplete: () => f.destroy() });
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
      this.drawLPBar(s, p.lp);
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
        sp.on("pointerout", () => this.hideInfoSoon());
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
        sp.on("pointerover", () => this.tweens.add({ targets: sp, y: y - 6, duration: 80 }));
        sp.on("pointerout", () => this.tweens.add({ targets: sp, y, duration: 80 }));
      }
    });
  }

  private cardSprite(c: CardView, x: number, y: number): CardSprite {
    const own = c.controller === HUMAN;
    const onField = c.location === OcgLocation.MZONE;
    const sp = new CardSprite(this, x, y).show(c.code, this.engine.cards.records.get(c.code), {
      back: c.code === 0, dim: own && c.faceDown,
      atk: onField ? c.attack : undefined, def: onField ? c.defense : undefined,
    });
    sp.setInteractive({ useHandCursor: true });
    const k = key(c.controller, c.location, c.sequence);
    sp.on("pointerover", () => c.code && this.showInfo(c.code));
    sp.on("pointerout", () => this.hideInfoSoon());
    sp.on("pointerup", (p: Phaser.Input.Pointer) => this.onCardClick(k, p));
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

  private applyHighlights(extra?: Map<string, CardHighlight>) {
    for (const [k, sp] of this.sprites) sp.setHighlight(extra?.get(k) ?? (this.actions.has(k) ? "action" : "none"));
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
        add(m.special_summons, "Sp. Summon", SelectIdleCMDAction.SELECT_SPECIAL_SUMMON);
        add(m.monster_sets, "Set", SelectIdleCMDAction.SELECT_MONSTER_SET);
        add(m.spell_sets, "Set", SelectIdleCMDAction.SELECT_SPELL_SET);
        add(m.pos_changes, "Position", SelectIdleCMDAction.SELECT_POS_CHANGE);
        m.activates.forEach((c, index) => this.addAction(c, "Activate", {
          type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index,
        }));
        if (m.to_bp) this.phaseActions.set("bp", { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null });
        if (m.to_ep) this.phaseActions.set("ep", { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null });
        this.drawPhaseColumn();
        this.applyHighlights();
        return;
      }
      case OcgMessageType.SELECT_BATTLECMD: {
        m.attacks.forEach((c, index) => this.addAction(c, "Attack", { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index }));
        m.chains.forEach((c, index) => this.addAction(c, "Activate", {
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

  private addAction(c: OcgCardLoc, label: string, response: OcgResponse) {
    const k = locKey(c);
    const list = this.actions.get(k) ?? [];
    list.push({ label, response });
    this.actions.set(k, list);
  }

  private onCardClick(k: string, p: Phaser.Input.Pointer) {
    if (this.modal.isOpen) return;
    const list = this.actions.get(k);
    if (!list) return;
    this.closeMenu();
    const w = 58, h = 11;
    const x = Phaser.Math.Clamp(Math.round(p.x), FIELD.left + w / 2, FIELD.right - w / 2 - 1);
    const top = Math.max(h, Math.round(p.y) - 8 - list.length * (h + 1));
    this.menu = this.add.container(0, 0).setDepth(900);
    list.forEach((a, i) => this.menu!.add(makeButton(this, x, top + i * (h + 1), w, h, a.label.toUpperCase(), () => this.answer(a.response), 0x3a3f8f)));
  }

  private closeMenu() {
    this.menu?.destroy();
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
