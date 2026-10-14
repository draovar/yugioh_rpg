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
import { DuelSession, counterTotal, type CardView, type FieldSnapshot, type Deck } from "../duel/DuelSession.ts";
import { DuelController, type HumanPrompt } from "../duel/DuelController.ts";
import { DECKS } from "../duel/decks.ts";
import { aiRpsOpponent } from "../duel/rps.ts";
import { CHAIN_MODES, chainMode, setChainMode } from "../ui/prefs.ts";
import type { NetDuel } from "../net/p2p.ts";
import { autoRespond, declarableCards, freePlaces } from "../duel/autoBot.ts";
import { ATTRIBUTES, COIN_HEADS_STRING, COIN_TAILS_STRING, RACES } from "../duel/text.ts";
import { CardSprite, type CardHighlight } from "../ui/duel/CardSprite.ts";
import { Modal, type PickerOptions } from "../ui/duel/Modal.ts";
import { InfoPanel } from "../ui/duel/InfoPanel.ts";
import { describeMessage } from "../ui/duel/duelLog.ts";
import { DuelAnimator } from "../ui/duel/DuelAnimator.ts";
import { RpsIntro } from "../ui/duel/RpsIntro.ts";
import { CardMenu } from "../ui/duel/CardMenu.ts";
import { drawField } from "../ui/duel/field.ts";
import { CARD, FIELD, FIELD_CENTER, INSET, PHASE_COL, handXY, slotXY, type Slot } from "../ui/duel/layout.ts";
import { INK, WHITE, border, text } from "../ui/pixel.ts";
import { LIST_BUTTON_H, makeListButton, makeWoodButton, type ListButton } from "../ui/widgets.ts";
import { installAnimPreview } from "./animPreview.ts";
import { installDialogPreview } from "./dialogPreview.ts";
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

/**
 * SELECT_COUNTER on the board: `need` counters in all, `available[i]` of this kind on card i, `picked[i]`
 * taken from it so far, `total[i]` = all its counters (what its badge counts).
 */
interface CounterPick { need: number; available: number[]; picked: number[]; total: number[] }

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
  private placeTargets: Phaser.GameObjects.GameObject[] = [];
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
  /** Counter line on the prompt's button plate ("1/2"), set by refreshFieldPick. */
  private promptCounter: Phaser.GameObjects.BitmapText | null = null;
  /**
   * Card choice happening on the board (see `pickCards`): `keys[i]` is the sprite key of `opts.cards[i]`;
   * `confirm` is the strip's CONFIRM button in multi mode.
   */
  private fieldPick: { keys: string[]; selected: Set<number>; opts: PickerOptions; confirm: ListButton | null; counters?: CounterPick } | null = null;

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
    this.placeTargets = [];
    this.fieldPick = null;
    this.promptCounter = null;
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
    try {
      const saved = Number(localStorage.getItem("duel.animSpeed"));
      if ([1, 2, 4].includes(saved)) this.animator.speed = saved;
    } catch { /* storage unavailable */ }
    this.panel = new InfoPanel(this, this.engine, { startLP: this.startLP, opponentName: this.sceneData.opponentName ?? "Opponent" });
    this.createCornerButtons();
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
      : this.sceneData.seed !== undefined ? ([BigInt(this.sceneData.seed), 0n, 0n, 0n] as [bigint, bigint, bigint, bigint]) : undefined;
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
   * optional counter line (`promptCounter`, e.g. "1/2"); they're returned in order, e.g. to update CONFIRM.
   */
  private setPrompt(label: string | null, buttons: { label: string; onClick: () => void; enabled?: boolean }[] = [], counter = false): ListButton[] {
    this.promptBand.removeAll(true).setVisible(!!label);
    this.promptCounter = null;
    if (!label) return [];
    const top = FIELD_CENTER.y - 6;
    this.promptBand.add(this.add.rectangle(FIELD.left, top, FIELD.right - FIELD.left, LIST_BUTTON_H, THEME.prompt.strip, THEME.prompt.stripAlpha).setOrigin(0));
    this.promptBand.add(text(this, FIELD_CENTER.x, top + 3, label.toUpperCase(), { color: THEME.prompt.text, originX: 0.5 }));
    if (!buttons.length) return [];
    // Plate: Frame01a (3px rim) + 2px padding around the buttons, 1px between them.
    const { x: cx, y: cy } = slotXY(0, { kind: "extra" });
    const rim = INSET.plate, pad = 2, ps = THEME.plate.slice;
    const w = BUTTON_PLATE_W, btnW = w - 2 * (rim + pad);
    const counterH = counter ? 8 : 0; // 5px text + gap
    const h = 2 * (rim + pad) + counterH + buttons.length * (LIST_BUTTON_H + 1) - 1;
    const left = Math.round(cx - w / 2), plateTop = Math.round(cy - h / 2);
    this.promptBand.add(this.add.nineslice(left, plateTop, ui("menu-back"), undefined, w, h, ps, ps, ps, ps).setOrigin(0));
    if (counter) {
      this.promptCounter = text(this, cx, plateTop + rim + pad + 1, "", { color: THEME.plate.ink, originX: 0.5 });
      this.promptBand.add(this.promptCounter);
    }
    const buttonsTop = plateTop + rim + pad + counterH;
    return buttons.map((b, i) => {
      const btn = makeListButton(this, left + rim + pad, buttonsTop + i * (LIST_BUTTON_H + 1), btnW, b.label, b.onClick);
      if (b.enabled === false) btn.setEnabled(false);
      this.promptBand.add(btn);
      return btn;
    });
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
    const speeds = [1, 2, 4];
    const speed = makeWoodButton(this, x, top, w, `${this.animator.speed}X`, () => {
      this.animator.speed = speeds[(speeds.indexOf(this.animator.speed) + 1) % speeds.length];
      speed.setLabel(`${this.animator.speed}X`);
      try { localStorage.setItem("duel.animSpeed", String(this.animator.speed)); } catch { /* storage unavailable */ }
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
    if (this.ended || this.modal.isOpen || this.fieldPick) return;
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
    if (total) this.counterBadge(key(c.controller, c.location, c.sequence), total);
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
        const equip = this.sprites.get(key(c.controller, c.location, c.sequence));
        const target = this.sprites.get(key(t.controller, t.location, t.sequence));
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
    const k = key(c.controller, c.location, c.sequence);
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
    // Counter badges back to the counts on the cards (the next redraw would too, but a preview has none).
    const cp = this.fieldPick?.counters;
    if (cp) this.fieldPick!.keys.forEach((k, i) => this.counterBadge(k, cp.total[i]));
    this.fieldPick = null;
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
    this.attackArrow = this.add.image(sp.x - 4, y, ui(mine ? "attack-up" : "attack-down")).setOrigin(0).setDepth(50);
    this.board.add(this.attackArrow);
  }

  /**
   * Playable cards aren't outlined; only the cursor tells them apart (hand cursor on cards with an
   * action, plain arrow elsewhere). During field targeting, candidates get a dark green outline and picked
   * ones a bright green one. `extra` can still mark cards explicitly.
   */
  private applyHighlights(extra?: Map<string, CardHighlight>) {
    const [attacker, target] = this.attackMarks;
    this.drawAttackArrow(attacker ? this.sprites.get(attacker) : undefined);
    const fp = this.fieldPick;
    for (const [k, sp] of this.sprites) {
      const i = fp ? fp.keys.indexOf(k) : -1;
      const locked = i >= 0 && !!fp!.opts.cards[i].locked;
      const pick: CardHighlight | undefined = i < 0 ? undefined : fp!.selected.has(i) || locked ? "selected" : "choice";
      sp.setHighlight(extra?.get(k) ?? pick ?? (k === attacker ? "attacker" : k === target ? "attacked" : "none"));
      if (sp.input) sp.input.cursor = this.actions.has(k) || (i >= 0 && !locked) ? "pointer" : "default";
    }
  }

  /**
   * Lets the player choose cards for a prompt. On the board when every candidate is a card shown there
   * (field or hand): candidates are outlined dark green, clicking picks (single mode: answers at once;
   * multi: toggles, then CONFIRM in the strip), the prompt text and buttons go in the strip across the
   * field. Otherwise (Graveyard, Deck...) in a picker dialog. `locs[i]` is where `opts.cards[i]` is.
   */
  private pickCards(locs: OcgCardLoc[], opts: PickerOptions) {
    const keys = locs.map(locKey);
    const shown = OcgLocation.MZONE | OcgLocation.SZONE | OcgLocation.HAND;
    if (!locs.every((c) => c.location & shown) || !keys.every((k) => this.sprites.has(k))) {
      this.modal.picker(opts);
      return;
    }
    const selected = new Set(opts.cards.flatMap((c, i) => (c.selected || c.locked ? [i] : [])));
    const fp = (this.fieldPick = { keys, selected, opts, confirm: null as ListButton | null });
    const count = opts.counter ?? (opts.max ? { value: (sel: number[]) => sel.length, of: opts.max } : null);
    const buttons = [...(opts.buttons ?? [])];
    // CONFIRM first; its counter ("1/2") is a line above the buttons, kept up to date by refreshFieldPick.
    if (opts.mode === "multi") buttons.unshift({ label: "Confirm", onClick: () => opts.onConfirm([...selected].sort((a, b) => a - b)) });
    const made = this.setPrompt(opts.title, buttons, !!count && opts.mode === "multi");
    if (opts.mode === "multi") fp.confirm = made[0];
    this.refreshFieldPick();
  }

  private refreshFieldPick() {
    const fp = this.fieldPick;
    if (!fp) return;
    const sel = [...fp.selected].sort((a, b) => a - b);
    const count = fp.opts.counter ?? (fp.opts.max ? { value: (s: number[]) => s.length, of: fp.opts.max } : null);
    const cp = fp.counters;
    if (cp) fp.keys.forEach((k, i) => this.counterBadge(k, cp.total[i] - cp.picked[i]));
    fp.confirm?.setEnabled(fp.opts.isValid ? fp.opts.isValid(sel) : true);
    const counter = this.promptCounter;
    if (count && counter) {
      counter.setText(`${count.value(sel)}/${count.of}`);
      counter.setX(Math.round(slotXY(0, { kind: "extra" }).x - counter.width / 2)); // centred on the plate
    }
    this.applyHighlights();
  }

  /** A card clicked during field targeting (same rules as the picker dialog). */
  private fieldPickClick(k: string) {
    const fp = this.fieldPick!;
    const i = fp.keys.indexOf(k);
    if (i < 0 || fp.opts.cards[i].locked) return;
    if (fp.counters) {
      this.counterPickClick(i);
      return;
    }
    if (fp.opts.mode === "single") {
      fp.opts.onConfirm([i]);
      return;
    }
    const max = fp.opts.max;
    if (fp.selected.has(i)) fp.selected.delete(i);
    else if (!max || fp.selected.size < max) fp.selected.add(i);
    else if (max === 1) { fp.selected.clear(); fp.selected.add(i); } // swap the one pick
    else return; // full: unpick one first
    this.refreshFieldPick();
  }

  /**
   * A card clicked while removing counters: takes one more of its counters; once it has given all it can
   * (or enough are taken), the next click puts its counters back.
   */
  private counterPickClick(i: number) {
    const fp = this.fieldPick!, cp = fp.counters!;
    const sum = cp.picked.reduce((a, b) => a + b, 0);
    if (sum < cp.need && cp.picked[i] < cp.available[i]) cp.picked[i]++;
    else if (cp.picked[i]) cp.picked[i] = 0;
    else if (cp.need === 1) { cp.picked.fill(0); cp.picked[i] = 1; } // swap the one pick
    else return; // full: unpick one first
    fp.selected = new Set(cp.picked.flatMap((n, j) => (n ? [j] : [])));
    this.refreshFieldPick();
  }

  private onPrompt(m: HumanPrompt, hint: bigint | null) {
    const t = this.engine.text;
    const title = (fallback: string) => (hint ? t.describe(hint) : fallback);
    const name = (code: number) => t.name(code);
    this.clearInteraction();

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
          // Caption: the effect's own name when it has one, else where the card is (FIELD, HAND, GY...),
          // except set Spells/Traps: S/T says nothing new. Never the generic "ACTIVATE".
          cards: m.selects.map((c) => {
            const effect = this.activateLabel(c.code, c.description);
            if (effect !== "Activate") return { code: c.code, caption: effect };
            return { code: c.code, caption: c.location === OcgLocation.SZONE ? "" : locationName(c.location, c.controller, this.me) };
          }),
          mode: "single",
          onConfirm: ([i]) => this.answer({ type: OcgResponseType.SELECT_CHAIN, index: i }),
          buttons: m.forced ? [] : [{ label: "Don't chain", onClick: () => this.answer({ type: OcgResponseType.SELECT_CHAIN, index: null }) }],
          onHover: (code) => this.panel.showInfo(code),
          onHoverEnd: () => this.panel.hoverEnd(),
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
      case OcgMessageType.SELECT_OPTION: {
        // Calling a coin toss (Duel.AnnounceCoin) is an option prompt between system strings 60 / 61.
        const heads = m.options.findIndex((o) => Number(o) === COIN_HEADS_STRING);
        const tails = m.options.findIndex((o) => Number(o) === COIN_TAILS_STRING);
        if (m.options.length === 2 && heads >= 0 && tails >= 0) {
          this.modal.coinCall(title("Call the coin toss"), (h) => this.answer({ type: OcgResponseType.SELECT_OPTION, index: h ? heads : tails }));
          return;
        }
        this.modal.dialog(title("Choose an option").toUpperCase(), m.options.map((o, index) => ({
          label: t.describe(o).toUpperCase(), onClick: () => this.answer({ type: OcgResponseType.SELECT_OPTION, index }),
        })));
        return;
      }
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
        this.pickCards(m.selects, {
          title: title(`Select ${range(m.min, m.max)} card(s)`),
          cards: m.selects.map((c) => ({ code: c.code, caption: locationName(c.location, c.controller, this.me) })),
          mode: m.min === 1 && m.max === 1 ? "single" : "multi",
          isValid: (sel) => sel.length >= m.min && sel.length <= m.max,
          max: m.max,
          onConfirm: (sel) => this.answer({ type: OcgResponseType.SELECT_CARD, indicies: sel }),
          buttons: m.can_cancel ? [{ label: "Cancel", onClick: () => this.answer({ type: OcgResponseType.SELECT_CARD, indicies: null }) }] : [],
          onHover: (code) => this.panel.showInfo(code),
          onHoverEnd: () => this.panel.hoverEnd(),
        });
        return;
      case OcgMessageType.SELECT_TRIBUTE:
        this.pickCards(m.selects, {
          title: title("Select monster(s) to Tribute"),
          // Tributes are normally your own field monsters: caption only the unusual ones (hand, opponent's).
          cards: m.selects.map((c) => ({
            code: c.code,
            caption: c.controller === this.me && c.location === OcgLocation.MZONE ? "" : locationName(c.location, c.controller, this.me),
          })),
          mode: "multi",
          // release_param: how many tributes this card counts as (Double Tribute monsters count 2).
          isValid: (sel) => {
            const worth = sel.reduce((n, i) => n + (m.selects[i].release_param || 1), 0);
            return worth >= m.min && sel.length <= m.max && sel.length > 0;
          },
          max: m.max,
          onConfirm: (sel) => this.answer({ type: OcgResponseType.SELECT_TRIBUTE, indicies: sel }),
          buttons: m.can_cancel ? [{ label: "Cancel", onClick: () => this.answer({ type: OcgResponseType.SELECT_TRIBUTE, indicies: null }) }] : [],
          onHover: (code) => this.panel.showInfo(code),
          onHoverEnd: () => this.panel.hoverEnd(),
        });
        return;
      case OcgMessageType.SELECT_UNSELECT_CARD: {
        // The engine asks one card at a time and lists the chosen ones separately. Show all of them in
        // board order so a card stays put when picked (it just rises, captioned CHOSEN); `index` counts
        // select_cards first, then unselect_cards.
        const entries = [
          ...m.select_cards.map((c, index) => ({ c, index, chosen: false })),
          ...m.unselect_cards.map((c, index) => ({ c, index: m.select_cards.length + index, chosen: true })),
        ].sort((a, b) => a.c.controller - b.c.controller || a.c.location - b.c.location || a.c.sequence - b.c.sequence);
        const chosen = m.unselect_cards.length;
        const done = { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null } as const;
        // FINISH and CANCEL send the same answer: FINISH once enough are chosen, CANCEL before that if
        // allowed, else a faded FINISH that only shows the count.
        const button = m.can_finish || !m.can_cancel
          ? { label: `Finish ${chosen}/${m.max}`, enabled: m.can_finish, onClick: () => this.answer(done) }
          : { label: "Cancel", onClick: () => this.answer(done) };
        this.pickCards(entries.map((e) => e.c), {
          title: title(`Select ${range(m.min, m.max)} card(s)`),
          cards: entries.map((e) => ({ code: e.c.code, caption: e.chosen ? "CHOSEN" : locationName(e.c.location, e.c.controller, this.me), selected: e.chosen })),
          mode: "single",
          buttons: [button],
          onConfirm: ([i]) => this.answer({ type: OcgResponseType.SELECT_UNSELECT_CARD, index: entries[i].index }),
          onHover: (code) => this.panel.showInfo(code),
          onHoverEnd: () => this.panel.hoverEnd(),
        });
        return;
      }
      case OcgMessageType.SELECT_SUM: {
        // Picker indexes: the "must" cards first (locked, always counted), then the optional ones.
        const must = m.selects_must.map((c) => c.amount);
        const value = (amount: number) => amount & 0xffff; // low half; the high half is an alternative value
        const caption = (amount: number) => `VALUE ${value(amount)}`;
        this.modal.picker({
          title: title(`Select cards with a total of ${m.amount}`),
          cards: [
            ...m.selects_must.map((c) => ({ code: c.code, locked: true, caption: caption(c.amount) })),
            ...m.selects.map((c) => ({ code: c.code, caption: caption(c.amount) })),
          ],
          mode: "multi",
          isValid: (sel) => {
            const chosen = sel.filter((i) => i >= must.length).map((i) => m.selects[i - must.length].amount);
            return chosen.length >= m.min && chosen.length <= m.max && sumMatches([...must, ...chosen], m.amount, m.select_max !== 0);
          },
          // CONFIRM shows the running total against the target ("CONFIRM 6/8").
          counter: {
            value: (sel) => sel.reduce((n, i) => n + value(i < must.length ? must[i] : m.selects[i - must.length].amount), 0),
            of: m.amount,
          },
          onConfirm: (sel) => this.answer({ type: OcgResponseType.SELECT_SUM, indicies: sel.filter((i) => i >= must.length).map((i) => i - must.length) }),
          onHover: (code) => this.panel.showInfo(code),
          onHoverEnd: () => this.panel.hoverEnd(),
        });
        return;
      }
      case OcgMessageType.SELECT_COUNTER: {
        // Like tributing: click the cards to take counters from (one per click), CONFIRM once there are enough.
        // Counters are only ever on field cards, so this is always on the board.
        const need = m.count;
        const cp: CounterPick = { need, available: m.cards.map((c) => c.count), picked: m.cards.map(() => 0), total: [] };
        const sum = () => cp.picked.reduce((a, b) => a + b, 0);
        const counterName = this.engine.text.counterName(m.counter_type);
        this.pickCards(m.cards, {
          title: title(`Remove ${need} ${counterName}${need > 1 ? "s" : ""}`),
          cards: m.cards.map((c) => ({ code: c.code })),
          mode: "multi",
          isValid: () => sum() === need,
          counter: { value: sum, of: need },
          onConfirm: () => this.answer({ type: OcgResponseType.SELECT_COUNTER, counters: [...cp.picked] }),
          onHover: (code) => this.panel.showInfo(code),
          onHoverEnd: () => this.panel.hoverEnd(),
        });
        const fp = this.fieldPick;
        if (!fp) { this.modal.close(); break; } // not on the board after all: the bot answers
        // The badges count every kind of counter on the card.
        const views = new Map((this.snapshot?.players ?? []).flatMap((p) => [...p.monsters, ...p.spells])
          .flatMap((v) => (v ? [[key(v.controller, v.location, v.sequence), v] as const] : [])));
        cp.total = fp.keys.map((k, i) => Math.max(counterTotal(views.get(k)?.counters ?? []), m.cards[i].count));
        fp.counters = cp;
        this.refreshFieldPick();
        return;
      }
      case OcgMessageType.SORT_CARD:
        // Big Eye: the cards come top-first; the one numbered 1 goes on top.
        this.modal.sortCards({
          title: title("Click the cards in their new order (1 = top)"),
          codes: m.cards.map((c) => c.code),
          onConfirm: (order) => this.answer({ type: OcgResponseType.SORT_CARD, order }),
          onHover: (code) => this.panel.showInfo(code),
          onHoverEnd: () => this.panel.hoverEnd(),
        });
        return;
      case OcgMessageType.SELECT_PLACE:
      case OcgMessageType.SELECT_DISFIELD:
        // For zone prompts the hint is the passcode of the card being placed, not a string id.
        this.pickPlaces(m.type, m.player, m.field_mask, m.count, hint && this.engine.cards.records.has(Number(hint))
          ? t.describe(569, name(Number(hint)))
          : t.describe(m.type === OcgMessageType.SELECT_PLACE ? 560 : 570));
        return;
      // Declarations (Tribe-Infecting Virus, DNA Transplant, Sixth Sense, Mind Crush...).
      case OcgMessageType.ANNOUNCE_RACE:
        this.declareFlags(title("Declare a Type"), RACES, BigInt(m.available), m.count,
          (races) => ({ type: OcgResponseType.ANNOUNCE_RACE, races }) as OcgResponse);
        return;
      case OcgMessageType.ANNOUNCE_ATTRIB:
        this.declareFlags(title("Declare an Attribute"), ATTRIBUTES.map(([bit, n]) => [BigInt(bit), n]), BigInt(m.available), m.count,
          (picked) => ({ type: OcgResponseType.ANNOUNCE_ATTRIB, attributes: picked.map(Number) }) as OcgResponse);
        return;
      case OcgMessageType.ANNOUNCE_NUMBER:
        // The answer is the option's index, not the number.
        this.modal.dialog(title("Declare a number").toUpperCase(), m.options.map((value, index) => ({
          label: String(value), onClick: () => this.answer({ type: OcgResponseType.ANNOUNCE_NUMBER, value: index }),
        })));
        return;
      case OcgMessageType.ANNOUNCE_CARD: {
        // Typed search over every card the game knows that passes the prompt's filter.
        const codes = declarableCards(this.engine.cards, m.opcodes);
        if (!codes.length) break;
        this.modal.search({
          title: title("Declare a card name"),
          codes,
          onPick: (card) => this.answer({ type: OcgResponseType.ANNOUNCE_CARD, card }),
          onHover: (code) => this.panel.showInfo(code),
        });
        return;
      }
    }
    // Anything not handled above (rare in the GOAT pool: counters to remove, sorting, RPS): the bot answers.
    this.panel.log(`(auto-answered ${OcgMessageType[m.type] ?? m.type})`);
    this.answer(autoRespond(m, Math.random, this.engine.cards));
  }

  /**
   * Declares `count` of the flags in `available` (Types or Attributes): one button dialog per pick, without
   * the ones already picked; answers once all are chosen.
   */
  private declareFlags(title: string, options: [bigint, string][], available: bigint, count: number,
    make: (picked: bigint[]) => OcgResponse, picked: bigint[] = []) {
    const open = options.filter(([bit]) => available & bit && !picked.includes(bit));
    const step = count > 1 ? ` (${picked.length + 1}/${count})` : "";
    this.modal.dialog(`${title}${step}`.toUpperCase(), open.map(([bit, name]) => ({
      label: name,
      onClick: () => {
        const next = [...picked, bit];
        if (next.length >= count) this.answer(make(next));
        else this.declareFlags(title, options, available, count, make, next);
      },
    })));
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
    if (this.fieldPick) {
      this.fieldPickClick(k);
      return;
    }
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

  /**
   * Zone choice: free zones get a semi-transparent yellow fill with a yellow 1px border, more opaque while
   * hovered or once picked (when several are needed). Collects `count` clicks, then responds.
   */
  private pickPlaces(type: OcgMessageType, player: number, fieldMask: number, count: number, label: string) {
    const free = freePlaces(player, fieldMask, 32);
    const chosen: SelectFieldPlace[] = [];
    this.setPrompt(label);
    for (const place of free) {
      if (place.location === OcgLocation.MZONE && place.sequence > 4) continue; // no Extra Monster Zones in GOAT
      const side = this.side(place.player);
      const slot: Slot = place.location === OcgLocation.MZONE ? { kind: "mzone", seq: place.sequence } : { kind: "szone", seq: place.sequence };
      const { x, y } = slotXY(side, slot);
      const g = this.add.graphics().setDepth(790);
      const draw = (on: boolean) => {
        g.clear();
        g.fillStyle(THEME.pick.zone, on ? THEME.pick.zoneHoverAlpha : THEME.pick.zoneAlpha).fillRect(x - CARD.w / 2, y - CARD.h / 2, CARD.w, CARD.h);
        border(g, x - CARD.w / 2, y - CARD.h / 2, CARD.w, CARD.h, THEME.pick.zone);
      };
      draw(false);
      let picked = false;
      const hit = this.add.zone(x, y, CARD.w, CARD.h).setInteractive({ useHandCursor: true }).setDepth(791);
      hit.on("pointerover", () => draw(true));
      hit.on("pointerout", () => draw(picked));
      hit.on("pointerup", () => {
        picked = true;
        draw(true);
        hit.disableInteractive();
        chosen.push(place);
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

function locationName(location: number, controller: number, me: number): string {
  const owner = controller === me ? "" : "OPP ";
  const names: Record<number, string> = {
    [OcgLocation.DECK]: "DECK", [OcgLocation.HAND]: "HAND", [OcgLocation.MZONE]: "FIELD",
    [OcgLocation.SZONE]: "S/T", [OcgLocation.GRAVE]: "GY", [OcgLocation.REMOVED]: "BANISHED", [OcgLocation.EXTRA]: "EXTRA",
  };
  return `${owner}${names[location] ?? "?"}`;
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
