import Phaser from "phaser";
import {
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgResponseType,
  type OcgCardLoc,
  type OcgMessage,
  type OcgResponse,
} from "ocgcore-wasm";
import { loadEngine, type Engine } from "../duel/loadEngine.ts";
import { DuelSession, counterTotal, type CardView, type FieldSnapshot, type Deck, type DuelSeed } from "../duel/DuelSession.ts";
import { DuelController, type HumanPrompt } from "../duel/DuelController.ts";
import { DECKS } from "../duel/decks.ts";
import { aiRpsOpponent } from "../duel/rps.ts";
import { ANIM_SPEEDS, CHAIN_MODES, animSpeed, chainMode, setAnimSpeed, setChainMode } from "../ui/prefs.ts";
import type { NetDuel } from "../net/p2p.ts";
import { CardSprite } from "../ui/duel/CardSprite.ts";
import { Modal } from "../ui/duel/Modal.ts";
import { InfoPanel } from "../ui/duel/InfoPanel.ts";
import { describeMessage } from "../ui/duel/duelLog.ts";
import { DuelAnimator } from "../ui/duel/DuelAnimator.ts";
import { RpsIntro } from "../ui/duel/RpsIntro.ts";
import { CardMenu } from "../ui/duel/CardMenu.ts";
import { BoardPick, type PromptButton } from "../ui/duel/BoardPick.ts";
import { drawField } from "../ui/duel/field.ts";
import { CARD, FIELD, FIELD_CENTER, INSET, PHASE_COL, cardKey, handXY, slotXY, type Slot } from "../ui/duel/layout.ts";
import { INK, WHITE, text } from "../ui/pixel.ts";
import { LIST_BUTTON_H, makeListButton, makeWoodButton, type ListButton } from "../ui/widgets.ts";
import { installAnimPreview } from "./animPreview.ts";
import { installDialogPreview } from "./dialogPreview.ts";
import { showPrompt, type PhaseAction, type PromptHost } from "./duelPrompts.ts";
import { withDevSetup } from "./devSetups.ts";
import { THEME, ui, type PhaseState } from "../ui/theme.ts";

export interface DuelSceneData {
  /** Default: the Yugi deck. */
  playerDeck?: Deck;
  /** Default: the Kaiba deck. */
  opponentDeck?: Deck;
  opponentName?: string;
  startingLP?: number;
  /** Fixed duel seed (replays the exact same duel); random when omitted. */
  seed?: number;
  /** Scene to return to when the duel ends. */
  returnScene?: string;
  /** Dev: name of a test board from devSetups.ts (`&setup=tribute`), placed before the duel starts (you go first). */
  setup?: string;
  /** Skips rock-paper-scissors: whether you go first (dev URLs, replays). */
  goFirst?: boolean;
  /** Peer-to-peer duel against a player on another machine (decks come from the handshake). */
  net?: NetDuel;
}

interface CardAction {
  label: string;
  response: OcgResponse;
}

/** Button plate on the Extra Deck slot: as wide as fits left of the Spell/Trap zones; light counter text. */
const BUTTON_PLATE_W = 56;
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
const PHASE_ACTION: Partial<Record<number, PhaseAction>> = { 3: "bp", 4: "m2", 5: "ep" };

/** How long an LP change ("-1500") stays inside the LP bar. */
const LP_DELTA_MS = 1200;

export class DuelScene extends Phaser.Scene {
  private engine!: Engine;
  private controller!: DuelController;
  private modal!: Modal;
  private sceneData: DuelSceneData = {};
  /** Seat of the player on this machine; their side is drawn at the bottom. */
  private me: 0 | 1 = 0;
  private ended = false;

  private board!: Phaser.GameObjects.Container;
  private sprites = new Map<string, CardSprite>();
  /** Counter badges on field cards; hidden while animating (they don't follow moving cards), redrawn after. */
  private counterBadges = new Map<string, Phaser.GameObjects.Container>();
  private actions = new Map<string, CardAction[]>();
  private phaseActions = new Map<PhaseAction, OcgResponse>();
  private menu: CardMenu | null = null;
  private snapshot: FieldSnapshot | null = null;
  /** Hint that came with the pending prompt, to set it up again after a dev preview. */
  private lastHint: bigint | null = null;
  /** A dev preview prompt is showing: its answer must not reach the engine. */
  private previewing = false;
  /** Dev preview: answers the preview prompt itself (e.g. asks again, like the engine); false = done. */
  private previewAnswer: ((response: OcgResponse) => boolean) | null = null;
  private animator!: DuelAnimator;
  private handCount: [number, number] = [0, 0];
  private lpValue: [number, number] = [8000, 8000];
  private startLP = 8000;
  private turnPlayer = 0;
  private phase = 0;

  private panel!: InfoPanel;
  /** Declared attack (sprite keys), outlined until the hit or until the attack ends. */
  private attackMarks: [string | null, string | null] = [null, null];
  private attackArrow: Phaser.GameObjects.Image | null = null;
  private phaseGfx!: Phaser.GameObjects.Container;
  private promptBand!: Phaser.GameObjects.Container;
  /** Choosing cards, counters or zones on the board. */
  private boardPick!: BoardPick;
  /** What duelPrompts.ts uses to set up each prompt's UI. */
  private prompts!: PromptHost;

  constructor() {
    super("Duel");
  }

  init(data: DuelSceneData) {
    this.sceneData = data ?? {};
    this.me = 0; // until rock-paper-scissors decides
    this.ended = false;
    this.sprites.clear();
    this.counterBadges.clear();
    this.actions.clear();
    this.phaseActions.clear();
    this.menu = null;
    this.handCount = [0, 0];
    this.startLP = data?.startingLP ?? 8000;
    this.lpValue = [this.startLP, this.startLP];
    this.snapshot = null;
    this.lastHint = null;
    this.previewing = false;
    this.previewAnswer = null;
    this.turnPlayer = 0;
    this.phase = 0;
    this.attackArrow = null;
    this.attackMarks = [null, null];
  }

  async create() {
    this.engine = await loadEngine();
    const { core, cards, readScript } = this.engine;
    this.modal = new Modal(this, cards);
    this.boardPick = new BoardPick({
      scene: this,
      sprites: this.sprites,
      snapshot: () => this.snapshot,
      side: (player) => this.side(player),
      setPrompt: (label, buttons, counter) => this.setPrompt(label, buttons, counter),
      counterBadge: (k, count) => this.counterBadge(k, count),
      applyHighlights: () => this.applyHighlights(),
    });

    this.drawStaticBoard();
    this.board = this.add.container(0, 0);
    const scene = this;
    this.animator = new DuelAnimator({
      scene: this,
      cards,
      get me() { return scene.me; },
      sprites: this.sprites,
      board: this.board,
      handCount: this.handCount,
      setPhase: (phase) => { this.phase = phase; this.drawPhaseColumn(); },
      changeLP: (player, lp, delta) => this.changeLP(player, lp, delta),
      lp: (player) => this.lpValue[this.side(player)],
      markAttack: (attacker, target) => {
        this.attackMarks = [attacker, target];
        this.applyHighlights();
      },
      notice: (message) => new Promise((resolve) => {
        this.modal.dialog(message.toUpperCase(), [{ label: "OK", onClick: resolve }]);
      }),
    });
    this.animator.speed = animSpeed();
    this.panel = new InfoPanel(this, this.engine, { startLP: this.startLP, opponentName: this.sceneData.opponentName ?? "Opponent" });
    this.createCornerButtons();
    this.prompts = {
      engine: this.engine,
      get me() { return scene.me; },
      modal: this.modal,
      boardPick: this.boardPick,
      snapshot: () => this.snapshot,
      answer: (response) => this.answer(response),
      addAction: (card, label, response) => this.addAction(card, label, response),
      setPhaseAction: (action, response) => this.phaseActions.set(action, response),
      showInfo: (code) => this.panel.showInfo(code),
      hoverEnd: () => this.panel.hoverEnd(),
      log: (line) => this.panel.log(line),
    };
    this.phaseGfx = this.add.container(0, 0);
    this.drawPhaseColumn();
    this.createPromptBand();
    this.input.on("pointerdown", (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (this.menu && !over.some((o) => this.menu!.exists(o))) this.closeMenu(true);
    });

    const net = this.sceneData.net;
    let session: DuelSession | null = null;
    net?.onClose(() => this.stopDuel("Your opponent left the duel."));
    net?.onSurrender(() => this.stopDuel("Your opponent forfeited. You win the duel!", true));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (session) {
        this.controller.stop();
        session.destroy();
      }
      net?.close();
    });
    // Debug handle for the browser console (dev builds only).
    if (import.meta.env.DEV) (window as unknown as { duelScene: DuelScene }).duelScene = this;

    // Seat 0 goes first: rock-paper-scissors decides who takes it.
    this.me = (await this.decideFirst()) ? 0 : 1;
    if (this.ended) return;
    const mine = net ? net.deck : this.sceneData.playerDeck ?? DECKS.yugi.deck;
    const theirs = net ? net.opponentDeck : this.sceneData.opponentDeck ?? DECKS.kaiba.deck;
    const bySeat: [Deck, Deck] = this.me === 0 ? [mine, theirs] : [theirs, mine];
    const decks = net ? bySeat : withDevSetup(bySeat, this.sceneData.setup);
    const seed = net ? net.seed
      : this.sceneData.seed !== undefined ? ([BigInt(this.sceneData.seed), 0n, 0n, 0n] as DuelSeed) : undefined;
    session = new DuelSession({ core, cards, readScript, startingLP: this.sceneData.startingLP, seed, decks });
    this.controller = new DuelController({
      session,
      me: this.me,
      remote: net?.remote,
      chainMode,
      schedule: (ms, fn) => this.time.delayedCall(ms, fn),
      events: {
        onUpdate: (messages, snapshot) => this.onUpdate(messages, snapshot),
        onPrompt: (prompt, hint) => {
          this.previewing = false; // a real prompt replaces any dev preview
          this.lastHint = hint;
          this.onPrompt(prompt, hint);
        },
        onEnd: (winner) => this.onEnd(winner),
        onError: (message) => this.stopDuel(`${message} The duel can't continue.`),
      },
    });
    this.controller.start();
    // Dev: `&anims` adds a dropdown to replay single animations (see animPreview.ts).
    if (import.meta.env.DEV && new URLSearchParams(location.search).has("anims")) {
      installAnimPreview({
        scene: this, animator: this.animator, me: () => this.me, snapshot: () => this.snapshot, renderBoard: (snap) => this.renderBoard(snap),
      });
    }
    // Dev: `&dialogs` adds a dropdown to open every prompt UI with sample cards (see dialogPreview.ts).
    if (import.meta.env.DEV && new URLSearchParams(location.search).has("dialogs")) {
      installDialogPreview({
        scene: this,
        me: () => this.me,
        snapshot: () => this.snapshot,
        prompt: (prompt, hint, onAnswer) => this.previewPrompt(() => this.onPrompt(prompt, hint), onAnswer),
        end: (winner) => this.previewPrompt(() => this.endDialog(winner, () => this.answer({ type: OcgResponseType.SELECT_YESNO, yes: true }))),
        graveyard: (side, codes, banished) => this.previewPrompt(() => this.browsePile(side, codes.map((code) => ({ code }) as CardView), banished.map((code) => ({ code }) as CardView))),
      });
    }
  }

  /**
   * Whether you go first: rock-paper-scissors on the board (vs the AI or the other player), unless the scene data
   * fixes it (`goFirst`; a dev setup board is always yours to start).
   */
  private async decideFirst(): Promise<boolean> {
    const d = this.sceneData;
    if (d.setup && !d.net) return true;
    if (d.goFirst !== undefined && !d.net) return d.goFirst;
    const rps = new RpsIntro({
      scene: this,
      opponent: d.net?.rps ?? aiRpsOpponent((ms, fn) => this.time.delayedCall(ms, fn)),
      speed: () => this.animator.speed,
      prompt: (label) => void this.setPrompt(label),
      ask: (message, buttons) => new Promise((resolve) => {
        this.modal.dialog(message, buttons.map((label, i) => ({ label, onClick: () => resolve(i) })));
      }),
      log: (line) => this.panel.log(line),
      active: () => !this.ended,
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => rps.destroy());
    return rps.run();
  }

  // ---------------------------------------------------------------- static layout

  /** Table, playmat and zones (field.ts). */
  private drawStaticBoard() {
    drawField(this, this.add.container(0, 0));
  }

  private drawPhaseColumn() {
    this.phaseGfx.removeAll(true);
    PHASES.forEach((p, i) => {
      const x = PHASE_COL.x, y = PHASE_COL.top + i * PHASE_COL.pitch;
      const action = PHASE_ACTION[i];
      const clickable = !!action && this.phaseActions.has(action);
      const state: PhaseState = (this.phase & p.bits) !== 0 ? "current" : clickable ? "clickable" : "idle";
      const look = THEME.phase[state];
      const box = this.add.nineslice(x, y, ui(`phase-${state}`), undefined, PHASE_COL.w, PHASE_COL.h, ...look.slice).setOrigin(0);
      this.phaseGfx.add(box);
      // Letters stacked vertically, centred on the button face.
      const color = state === "current" ? (this.turnPlayer === this.me ? THEME.turnText.mine : THEME.turnText.theirs) : look.text;
      const letters = [...p.label];
      const top = y + Math.floor((PHASE_COL.h - letters.length * 6 + 1) / 2) + look.textDy;
      const glyphs = letters.flatMap((ch, j) => (ch === " " ? [] : [text(this, x + PHASE_COL.w / 2, top + j * 6, ch, { color, originX: 0.5 })]));
      this.phaseGfx.add(glyphs);
      if (clickable) {
        // Press feedback: swap to the pressed frame while the pointer is down.
        const pressed = THEME.phase.idle;
        const hit = this.add.zone(x, y, PHASE_COL.w, PHASE_COL.h).setOrigin(0).setInteractive({ useHandCursor: true });
        hit.on("pointerdown", () => {
          box.setTexture(ui("phase-idle")).setSlices(PHASE_COL.w, PHASE_COL.h, ...pressed.slice);
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

  /**
   * The strip across the middle of the field with the prompt text, centred. Buttons (e.g. CONFIRM / CANCEL
   * while choosing on the board) go on a small dark plate over your Extra Deck slot, stacked, under an
   * optional counter line (e.g. "1/2"); both are returned (buttons in order), e.g. to update CONFIRM.
   */
  private setPrompt(label: string | null, buttons: PromptButton[] = [], withCounter = false): { buttons: ListButton[]; counter: Phaser.GameObjects.BitmapText | null } {
    this.promptBand.removeAll(true).setVisible(!!label);
    const none = { buttons: [], counter: null };
    if (!label) return none;
    const top = FIELD_CENTER.y - 6;
    this.promptBand.add(this.add.rectangle(FIELD.left, top, FIELD.right - FIELD.left, LIST_BUTTON_H, THEME.prompt.strip, THEME.prompt.stripAlpha).setOrigin(0));
    this.promptBand.add(text(this, FIELD_CENTER.x, top + 3, label.toUpperCase(), { color: THEME.prompt.text, originX: 0.5 }));
    if (!buttons.length) return none;
    // Plate: Frame01a (3px rim) + 2px padding around the buttons, 1px between them.
    const { x: cx, y: cy } = slotXY(0, { kind: "extra" });
    const rim = INSET.plate, pad = 2, ps = THEME.plate.slice;
    const w = BUTTON_PLATE_W, btnW = w - 2 * (rim + pad);
    const counterH = withCounter ? 8 : 0; // 5px text + gap
    const h = 2 * (rim + pad) + counterH + buttons.length * (LIST_BUTTON_H + 1) - 1;
    const left = Math.round(cx - w / 2), plateTop = Math.round(cy - h / 2);
    this.promptBand.add(this.add.nineslice(left, plateTop, ui("menu-back"), undefined, w, h, ps, ps, ps, ps).setOrigin(0));
    const counter = withCounter ? text(this, cx, plateTop + rim + pad + 1, "", { color: THEME.plate.ink, originX: 0.5 }) : null;
    if (counter) this.promptBand.add(counter);
    const buttonsTop = plateTop + rim + pad + counterH;
    return {
      counter,
      buttons: buttons.map((b, i) => {
        const btn = makeListButton(this, left + rim + pad, buttonsTop + i * (LIST_BUTTON_H + 1), btnW, b.label, b.onClick);
        if (b.enabled === false) btn.setEnabled(false);
        this.promptBand.add(btn);
        return btn;
      }),
    };
  }

  // ---------------------------------------------------------------- info panel, log, LP

  /**
   * Top-right corner of the field, stacked in the space above the mat (top 59): animation speed
   * (1x/2x/4x), the info panel's LOG/CARD toggle and the chain mode (AUTO/ALL/OFF: when you're asked to
   * chain). All the same width; right edges line up with the right pile column (card centre 614).
   */
  private createCornerButtons() {
    const top = 1, pitch = 18 + 1, w = 24;
    const x = 614 + CARD.w / 2 - w;
    const speed = makeWoodButton(this, x, top, w, `${this.animator.speed}X`, () => {
      this.animator.speed = ANIM_SPEEDS[(ANIM_SPEEDS.indexOf(this.animator.speed) + 1) % ANIM_SPEEDS.length];
      speed.setLabel(`${this.animator.speed}X`);
      setAnimSpeed(this.animator.speed);
    });
    // Switch the info panel between card mode and log mode.
    const panelToggle = makeWoodButton(this, x, top + pitch, w, "LOG", () => {
      panelToggle.setLabel(this.panel.toggleMode() === "card" ? "LOG" : "CARD");
    });
    const chainLabel = () => chainMode().toUpperCase();
    const chain = makeWoodButton(this, x, top + 2 * pitch, w, chainLabel(), () => {
      setChainMode(CHAIN_MODES[(CHAIN_MODES.indexOf(chainMode()) + 1) % CHAIN_MODES.length]);
      chain.setLabel(chainLabel());
      this.panel.log({
        auto: "Chain prompts: only when a card fits the moment",
        all: "Chain prompts: whenever a card can be used",
        off: "Chain prompts: off (forced effects still ask)",
      }[chainMode()]);
    });
  }

  // ---------------------------------------------------------------- engine events

  private async onUpdate(messages: OcgMessage[], snapshot: FieldSnapshot): Promise<void> {
    if (!this.snapshot) {
      // First update: show full decks and empty hands so the opening draw has something to animate from.
      this.renderBoard({
        players: snapshot.players.map((p) => ({ ...p, hand: [], deckCount: p.deckCount + p.hand.length })) as unknown as FieldSnapshot["players"],
      });
    }
    if (messages.length) for (const b of this.counterBadges.values()) b.setVisible(false);
    await this.animator.play(messages, (m) => {
      if (m.type === OcgMessageType.NEW_TURN) this.turnPlayer = m.player;
      if (m.type === OcgMessageType.DRAW && m.player === this.me) this.panel.drew(m.drawn[0]?.code ?? 0);
      const line = describeMessage(m, this.engine.text, this.me);
      if (line) this.panel.log(line);
    });
    this.snapshot = snapshot;
    this.renderBoard(snapshot);
  }

  /** Counts the LP bar to `lp`, with a floating +/- label. */
  private changeLP(player: number, lp: number, delta: number): Promise<void> {
    const i = this.side(player);
    const from = this.lpValue[i];
    const to = Math.max(0, lp);
    this.lpValue[i] = to;
    if (delta) this.panel.lpBars[i].showDelta(delta, LP_DELTA_MS / this.animator.speed);
    return new Promise((resolve) => {
      this.tweens.addCounter({
        from, to, duration: 450 / this.animator.speed,
        onUpdate: (t) => this.panel.lpBars[i].set(t.getValue() ?? to),
        onComplete: () => resolve(),
      });
    });
  }

  private onEnd(winner: number | null) {
    this.ended = true;
    this.clearInteraction();
    this.endDialog(winner, () => this.scene.start(this.sceneData.returnScene ?? "Overworld", { duelResult: { won: winner === this.me } }));
  }

  /**
   * The duel stopped outside the engine: a forfeit (`won` = who it counts for), or in a peer-to-peer duel the
   * opponent left or the duels went out of sync (`won` undefined: no result).
   */
  private stopDuel(message: string, won?: boolean) {
    if (this.ended) return;
    this.ended = true;
    this.controller?.stop(); // none yet during rock-paper-scissors
    this.modal.close();
    this.clearInteraction();
    const duelResult = won === undefined ? undefined : { won };
    this.modal.dialog(message.toUpperCase(), [
      { label: "CONTINUE", onClick: () => this.scene.start(this.sceneData.returnScene ?? "Overworld", duelResult && { duelResult }) },
    ]);
  }

  /** Your Deck's menu: FORFEIT ends the duel as a loss (and tells the other player in a peer-to-peer duel). */
  private openDeckMenu(sp: CardSprite) {
    if (this.ended || this.modal.isOpen || this.boardPick.active) return;
    this.closeMenu(true);
    this.menu = new CardMenu(this, sp, [{
      label: "Forfeit",
      onClick: () => {
        this.closeMenu();
        this.sceneData.net?.surrender();
        this.stopDuel("You forfeited the duel.", false);
      },
    }]);
  }

  /** Screen side of a player: 0 = you (bottom), 1 = opponent (top). */
  private side(player: number): 0 | 1 {
    return player === this.me ? 0 : 1;
  }

  private endDialog(winner: number | null, onContinue: () => void) {
    const lost = winner === 1 - this.me;
    this.modal.dialog(winner === this.me ? "YOU WIN THE DUEL!" : lost ? "YOU LOST THE DUEL..." : "THE DUEL ENDED IN A DRAW.", [
      { label: "CONTINUE", onClick: onContinue },
    ]);
  }

  // ---------------------------------------------------------------- board rendering

  private renderBoard(snap: FieldSnapshot) {
    this.board.removeAll(true);
    this.sprites.clear();
    this.counterBadges.clear();
    snap.players.forEach((p, player) => {
      const s = this.side(player);
      this.handCount[s] = p.hand.length;
      this.lpValue[s] = p.lp;
      this.panel.lpBars[s].set(p.lp);
      p.monsters.forEach((c, seq) => c && this.placeCard(c, slotXY(s, { kind: "mzone", seq })));
      p.spells.forEach((c, seq) => c && this.placeCard(c, slotXY(s, { kind: "szone", seq })));
      this.drawPile(s, { kind: "deck" }, p.deckCount, null);
      // Only your own Extra Deck can be browsed (the opponent's cards are hidden anyway).
      this.drawPile(s, { kind: "extra" }, p.extraCount, null, s === 0 ? p.extra : undefined);
      this.drawPile(s, { kind: "grave" }, p.grave.length, p.grave.at(-1) ?? null, [...p.grave].reverse(), p.banished);
      this.drawHand(s, p.hand);
    });
    this.linkEquips(snap);
    this.applyHighlights();
    this.panel.refreshCounters(snap);
  }

  private placeCard(c: CardView, at: { x: number; y: number }) {
    const sp = this.cardSprite(c, at.x, at.y);
    const sideways = c.location === OcgLocation.MZONE && (c.position & DEFENSE) !== 0;
    if (sideways) sp.setAngle(90);
    const total = counterTotal(c.counters);
    if (total) this.counterBadge(cardKey(c), total);
  }

  /**
   * Counters: a number badge on the card's top-right corner, like the pile counts. Redrawn with the count
   * left on the card while you pick counters to remove.
   */
  private counterBadge(k: string, count: number) {
    const sp = this.sprites.get(k);
    if (!sp) return;
    this.counterBadges.get(k)?.destroy();
    const sideways = sp.angle !== 0;
    const badge = this.badge(sp.x + (sideways ? CARD.h : CARD.w) / 2, sp.y - (sideways ? CARD.w : CARD.h) / 2, String(count), 1);
    this.counterBadges.set(k, badge);
    this.board.add(badge);
  }

  /**
   * Hovering an equip card marks the monster it's equipped to with the Equip Spell icon, and hovering an
   * equipped monster marks its equip cards.
   */
  private linkEquips(snap: FieldSnapshot) {
    const partners = new Map<CardSprite, CardSprite[]>();
    const link = (a: CardSprite, b: CardSprite) => partners.set(a, [...(partners.get(a) ?? []), b]);
    for (const p of snap.players) {
      for (const c of [...p.monsters, ...p.spells]) {
        if (!c?.equipTarget) continue;
        const t = c.equipTarget;
        const equip = this.sprites.get(cardKey(c));
        const target = this.sprites.get(cardKey(t));
        if (!equip || !target) continue;
        link(equip, target);
        link(target, equip);
      }
    }
    for (const [sp, others] of partners) {
      sp.on("pointerover", () => !this.animator.busy && others.forEach((o) => o.setEquipMark(true)));
      sp.on("pointerout", () => others.forEach((o) => o.setEquipMark(false)));
    }
  }

  private drawPile(side: 0 | 1, slot: Slot, count: number, top: CardView | null, contents?: CardView[], banished: CardView[] = []) {
    const { x, y } = slotXY(side, slot);
    if (count) {
      const sp = new CardSprite(this, x, y).show(top?.code ?? 0, this.engine.cards.records.get(top?.code ?? 0), { back: !top });
      // Your own Deck opens a menu with FORFEIT.
      const ownDeck = side === 0 && slot.kind === "deck";
      sp.setInteractive({ useHandCursor: !!contents || ownDeck });
      if (ownDeck) sp.on("pointerup", () => this.openDeckMenu(sp));
      if (top) {
        sp.on("pointerover", () => this.panel.showInfo(top.code));
        sp.on("pointerout", () => this.panel.hoverEnd());
      }
      if (contents) sp.on("pointerup", () => this.browsePile(side, contents, banished, slot.kind === "extra" ? "extra" : "grave"));
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
      if (side === 0) {
        // Hover lift. Skipped while animating, and for a sprite that has since left the hand (an
        // animation may be flying it to the field), so it never fights an animation.
        const k = cardKey(c);
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
    const k = cardKey(c);
    // A hidden card revealed to you (e.g. by Confiscation) stays face-up until the animator flips it back.
    const revealed = this.animator.revealed.get(k);
    const code = revealed ?? c.code;
    const sp = new CardSprite(this, x, y).show(code, this.engine.cards.records.get(code), {
      // Face-down cards show the back, yours too; hovering your own still shows it in the info panel.
      back: !revealed && (c.code === 0 || c.faceDown),
      atk: onField ? c.attack : undefined, def: onField ? c.defense : undefined,
    });
    sp.setInteractive({ useHandCursor: true });
    // Field cards: the info panel lists their counters and keeps them current (see InfoPanel.refreshCounters).
    const fieldKey = c.location === OcgLocation.HAND ? null : k;
    sp.on("pointerover", () => code && this.panel.showInfo(code, c.counters, fieldKey));
    sp.on("pointerout", () => this.panel.hoverEnd());
    sp.on("pointerup", () => this.onCardClick(k));
    this.sprites.set(k, sp);
    this.board.add(sp);
    return sp;
  }

  /** Lists a pile's cards in a picker dialog: a Graveyard (newest first, then banished cards) or your Extra Deck. */
  private browsePile(side: 0 | 1, contents: CardView[], banished: CardView[], pile: "grave" | "extra" = "grave") {
    if (this.modal.isOpen || !contents.length && !banished.length) return;
    const pending = this.controller.waitingForHuman;
    const owner = side === 0 ? "Your" : "Opponent's";
    this.modal.picker({
      title: pile === "extra" ? `${owner} Extra Deck` : `${owner} Graveyard (newest first)${banished.length ? ", then banished" : ""}`,
      // No names (they're on the cards); only banished cards get a caption, to tell them apart.
      cards: [
        ...contents.map((c) => ({ code: c.code, locked: true, caption: "" })),
        ...[...banished].reverse().map((c) => ({ code: c.code, locked: true, caption: "BANISHED" })),
      ],
      mode: "single",
      onConfirm: () => {},
      // Browsing leaves the board as it was (e.g. cards already picked for a tribute). Only a dev preview of this
      // browser cleared it: closing that one sets the pending prompt up again.
      buttons: [{ label: "Close", onClick: () => {
        if (!this.previewing) return;
        this.previewing = false;
        if (pending) this.onPrompt(pending, this.lastHint);
      } }],
      onHover: (code) => this.panel.showInfo(code),
      onHoverEnd: () => this.panel.hoverEnd(),
    });
  }

  // ---------------------------------------------------------------- prompts

  /**
   * Dev (`&dialogs`): shows a prompt UI with sample data. Its answer is logged instead of sent to the
   * engine (see `answer`), then handed to `onAnswer` if given (which may show a follow-up preview and
   * return true); otherwise, or when it returns false, the real pending prompt is set up again.
   */
  private previewPrompt(show: () => void, onAnswer?: (response: OcgResponse) => boolean) {
    this.modal.close();
    this.clearInteraction();
    this.previewing = true;
    this.previewAnswer = onAnswer ?? null;
    show();
  }

  private answer(response: OcgResponse) {
    if (this.previewing) {
      this.previewing = false;
      this.panel.log(`(preview) answer: ${JSON.stringify(response, (_k, v) => (typeof v === "bigint" ? String(v) : v))}`);
      this.clearInteraction();
      const next = this.previewAnswer;
      this.previewAnswer = null;
      if (next?.(response)) return;
      const pending = this.controller.waitingForHuman;
      if (pending) this.onPrompt(pending, this.lastHint);
      return;
    }
    if (!this.controller.waitingForHuman) return;
    this.clearInteraction();
    this.controller.answer(response);
  }

  private clearInteraction() {
    // Also puts counter badges back to the counts on the cards (the next redraw would too, but a preview has none).
    this.boardPick.clear();
    this.setPrompt(null);
    this.actions.clear();
    this.phaseActions.clear();
    this.closeMenu();
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
    this.attackArrow = this.add.image(sp.x - 4, y, ui(mine ? "attack-up" : "attack-down")).setOrigin(0).setDepth(50);
    this.board.add(this.attackArrow);
  }

  /**
   * Playable cards aren't outlined; only the cursor tells them apart (hand cursor on cards with an
   * action, plain arrow elsewhere). While choosing on the board, candidates get a yellow 1px outline and
   * picked ones an orange 2px one (BoardPick); a declared attack outlines attacker and target in red.
   */
  private applyHighlights() {
    const [attacker, target] = this.attackMarks;
    this.drawAttackArrow(attacker ? this.sprites.get(attacker) : undefined);
    for (const [k, sp] of this.sprites) {
      const pick = this.boardPick.highlight(k);
      sp.setHighlight(pick.look ?? (k === attacker ? "attacker" : k === target ? "attacked" : "none"));
      if (sp.input) sp.input.cursor = this.actions.has(k) || pick.clickable ? "pointer" : "default";
    }
  }

  /** Sets up the UI for a prompt you have to answer (duelPrompts.ts). */
  private onPrompt(m: HumanPrompt, hint: bigint | null) {
    this.clearInteraction();
    showPrompt(this.prompts, m, hint);
    // Card actions and phase boxes (idle / battle prompts) only take effect once drawn.
    this.drawPhaseColumn();
    this.applyHighlights();
  }

  private addAction(c: OcgCardLoc, label: string, response: OcgResponse) {
    const k = cardKey(c);
    const list = this.actions.get(k) ?? [];
    list.push({ label, response });
    this.actions.set(k, list);
  }

  private onCardClick(k: string) {
    if (this.modal.isOpen) return;
    if (this.boardPick.click(k)) return;
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

}
