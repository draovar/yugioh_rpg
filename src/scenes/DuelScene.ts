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
import { DuelController, type HumanPrompt } from "../duel/DuelController.ts";
import { DECKS } from "../duel/decks.ts";
import { CHAIN_MODES, chainMode, setChainMode } from "../ui/prefs.ts";
import type { NetDuel } from "../net/p2p.ts";
import { autoRespond, declarableCards, freePlaces } from "../duel/autoBot.ts";
import { ATTRIBUTES, RACES, raceNames } from "../duel/text.ts";
import {
  ATTRIBUTE_INDEX, ATTRIBUTE_SHEET, CardSprite, SPELL_ATTRIBUTE, SPELL_KIND_ICON, SPELL_NORMAL_ICON, SPELL_SHEET, TRAP_ATTRIBUTE,
  type CardHighlight,
} from "../ui/duel/CardSprite.ts";
import { INFO_DEPTH, Modal, type PickerOptions } from "../ui/duel/Modal.ts";
import { describeMessage } from "../ui/duel/duelLog.ts";
import { DuelAnimator } from "../ui/duel/DuelAnimator.ts";
import { CardMenu } from "../ui/duel/CardMenu.ts";
import { drawField } from "../ui/duel/field.ts";
import { CARD, FIELD, FIELD_CENTER, INFO, INSET, PHASE_COL, handXY, slotXY, type Slot } from "../ui/duel/layout.ts";
import { FONT_UI, INK, INK_SOFT, WHITE, border, measure, text } from "../ui/pixel.ts";
import { LIST_BUTTON_H, makeButton, makeListButton, makeWoodButton, type ListButton, type WoodButton } from "../ui/widgets.ts";
import { installAnimPreview } from "./animPreview.ts";
import { installDialogPreview } from "./dialogPreview.ts";
import { withDevSetup } from "./devSetups.ts";
import { LPBar, LP_BAR } from "../ui/duel/LPBar.ts";
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
  /** Dev: name of a test board from devSetups.ts (`&setup=tribute`), placed before the duel starts. */
  setup?: string;
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

/** Info panel geometry: everything sits inside the frame's rim. */
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
/** Level stars in the info panel: 7x7 sprite, 3px apart. */
const STAR_SIZE = 7, STAR_GAP = 3;
/** How long an LP change ("-1500") stays inside the LP bar. */
const LP_DELTA_MS = 1200;
/** Info-panel ATK / DEF plates: height (label: plate.inkSoft, value: plate.ink at 2x). */
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

/** Info-panel art: 128px art inside the LP bar's frame (theme rim). */
const ART_FRAME = 128 + 2 * INSET.lpTrack;
/** The duel log text starts below its "DUEL LOG" header, inside the paper. */
const LOG_Y = LAYOUT.top + 13;

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
  private counterBadges: Phaser.GameObjects.Container[] = [];
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
  /** Counter line on the prompt's button plate ("1/2"), set by refreshFieldPick. */
  private promptCounter: Phaser.GameObjects.BitmapText | null = null;
  /**
   * Card choice happening on the board (see `pickCards`): `keys[i]` is the sprite key of `opts.cards[i]`;
   * `confirm` is the strip's CONFIRM button in multi mode.
   */
  private fieldPick: { keys: string[]; selected: Set<number>; opts: PickerOptions; confirm: ListButton | null } | null = null;

  constructor() {
    super("Duel");
  }

  init(data: DuelSceneData) {
    this.sceneData = data ?? {};
    this.me = data?.net?.me ?? 0;
    this.ended = false;
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
      me: this.me,
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
    this.createInfoPanel();
    this.phaseGfx = this.add.container(0, 0);
    this.drawPhaseColumn();
    this.createPromptBand();
    this.input.on("pointerdown", (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (this.menu && !over.some((o) => this.menu!.exists(o))) this.closeMenu(true);
    });

    const net = this.sceneData.net;
    const decks: [Deck, Deck] = net
      ? net.decks
      : withDevSetup([this.sceneData.playerDeck ?? DECKS.yugi.deck, this.sceneData.opponentDeck ?? DECKS.kaiba.deck], this.sceneData.setup);
    const seed = net ? net.seed
      : this.sceneData.seed !== undefined ? ([BigInt(this.sceneData.seed), 0n, 0n, 0n] as [bigint, bigint, bigint, bigint]) : undefined;
    const session = new DuelSession({ core, cards, readScript, startingLP: this.sceneData.startingLP, seed, decks });
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
    net?.onClose(() => this.stopDuel("Your opponent left the duel."));
    net?.onSurrender(() => this.stopDuel("Your opponent forfeited. You win the duel!", true));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.controller.stop();
      session.destroy();
      net?.close();
    });
    // Debug handle for the browser console (dev builds only).
    if (import.meta.env.DEV) (window as unknown as { duelScene: DuelScene }).duelScene = this;
    this.controller.start();
    // Dev: `&anims` adds a dropdown to replay single animations (see animPreview.ts).
    if (import.meta.env.DEV && new URLSearchParams(location.search).has("anims")) {
      installAnimPreview({ scene: this, animator: this.animator, snapshot: () => this.snapshot, renderBoard: (snap) => this.renderBoard(snap) });
    }
    // Dev: `&dialogs` adds a dropdown to open every prompt UI with sample cards (see dialogPreview.ts).
    if (import.meta.env.DEV && new URLSearchParams(location.search).has("dialogs")) {
      installDialogPreview({
        scene: this,
        snapshot: () => this.snapshot,
        prompt: (prompt, hint, onAnswer) => this.previewPrompt(() => this.onPrompt(prompt, hint), onAnswer),
        end: (winner) => this.previewPrompt(() => this.endDialog(winner, () => this.answer({ type: OcgResponseType.SELECT_YESNO, yes: true }))),
        graveyard: (side, codes, banished) => this.previewPrompt(() => this.browsePile(side, codes.map((code) => ({ code }) as CardView), banished.map((code) => ({ code }) as CardView))),
      });
    }
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

  private createInfoPanel() {
    const L = LAYOUT;
    // Everything in the panel sits above dialogs' shade (INFO_DEPTH), so it stays bright and shows hovered cards.
    this.add.nineslice(0, 0, ui("info-frame"), undefined, INFO.w, 360, ...THEME.panel.infoSlice).setOrigin(0).setDepth(INFO_DEPTH);
    this.lpBars = [
      new LPBar(this, L.bar.x, L.lp.mine, L.bar.w, "You", this.startLP).set(this.startLP).setDepth(INFO_DEPTH),
      new LPBar(this, L.bar.x, L.lp.opp, L.bar.w, this.sceneData.opponentName ?? "Opponent", this.startLP).set(this.startLP).setDepth(INFO_DEPTH),
    ];
    this.infoPanel = this.add.container(0, 0).setDepth(INFO_DEPTH);
    this.logText = text(this, L.x + INSET.paper, LOG_Y, "", { color: THEME.panel.paperInk, maxWidth: L.w - INSET.paper * 2 }).setDepth(INFO_DEPTH + 1);
    this.createCornerButtons();
    this.showEmpty();
  }

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
    this.panelToggle = makeWoodButton(this, x, top + pitch, w, "LOG", () => {
      this.panelMode = this.panelMode === "card" ? "log" : "card";
      this.panelToggle.setLabel(this.panelMode === "card" ? "LOG" : "CARD");
      if (this.panelMode === "card" && this.lastCode) this.showCard(this.lastCode);
      else this.showLog();
    });
    const chainLabel = () => chainMode().toUpperCase();
    const chain = makeWoodButton(this, x, top + 2 * pitch, w, chainLabel(), () => {
      setChainMode(CHAIN_MODES[(CHAIN_MODES.indexOf(chainMode()) + 1) % CHAIN_MODES.length]);
      chain.setLabel(chainLabel());
      this.log({
        auto: "Chain prompts: only when a card fits the moment",
        all: "Chain prompts: whenever a card can be used",
        off: "Chain prompts: off (forced effects still ask)",
      }[chainMode()]);
    });
  }

  /** Cream paper inset whose outer edge is the box (x, y, w, h); text goes inside, padded by its rim. */
  private paper(x: number, y: number, w: number, h: number) {
    const r = THEME.panel.paperSlice;
    this.infoPanel.add(this.add.nineslice(x, y, ui("panel-paper"), undefined, w, h, r, r, r, r).setOrigin(0));
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
    const L = LAYOUT, ink = THEME.panel.ink;
    const monster = (r.type & 0x1) !== 0;

    // Name at 2x, light with a 1px dark drop shadow, left-aligned; names wider than their space scroll (see
    // scrollName). Monsters stop before the attribute icon; Spells/Traps (icons sit by the art) get the full width.
    const nameW = monster ? L.w - 20 : L.w;
    const nameStr = r.name.toUpperCase();
    const nameText = text(this, 0, 0, nameStr, { scale: 2, color: THEME.cardName.ink });
    const name = this.add.container(L.x, L.top, [text(this, 1, 1, nameStr, { scale: 2, color: THEME.cardName.shadow }), nameText]);
    p.add(name);
    if (nameText.width > nameW) this.scrollName(name, nameText.width, nameW);
    const attr = ATTRIBUTE_INDEX[r.attribute];
    if (monster && attr !== undefined) p.add(this.add.image(L.x + L.w - 16, L.top - 1, ATTRIBUTE_SHEET, attr).setOrigin(0));
    if (monster) for (let i = 0; i < (r.level & 0xff); i++) p.add(this.add.image(L.x + i * (STAR_SIZE + STAR_GAP), L.top + 14, ui("star")).setOrigin(0));
    // 128x128 art in a wooden frame (the LP bar's frame, nine-sliced), loaded on first view.
    const artY = L.top + 24;
    const artKey = `art128-${code}`;
    const lpRim = INSET.lpTrack, fs = THEME.lpBar.slice;
    p.add(this.add.nineslice(L.x, artY, ui("lp-frame"), undefined, ART_FRAME, ART_FRAME, fs, fs, fs, fs).setOrigin(0));
    const placeArt = () => { if (this.infoCode === code && p.active) p.add(this.add.image(L.x + lpRim, artY + lpRim, artKey).setOrigin(0)); };
    if (this.textures.exists(artKey)) placeArt();
    else {
      this.load.image(artKey, `cards/art128/${code}.png`);
      this.load.once(`filecomplete-image-${artKey}`, placeArt);
      this.load.start();
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
      p.add(this.add.image(iconsX, iconsY, ATTRIBUTE_SHEET, r.type & 0x2 ? SPELL_ATTRIBUTE : TRAP_ATTRIBUTE).setOrigin(0));
      p.add(this.add.image(iconsX + 20, iconsY, SPELL_SHEET, kind).setOrigin(0));
      types = [r.type & 0x2 ? "SPELL" : "TRAP", spellTrapKind(r.type)];
    }
    const pr = THEME.plate.slice;
    p.add(this.add.nineslice(statX, typesY, ui("menu-back"), undefined, statW, artY + ART_FRAME - typesY, pr, pr, pr, pr).setOrigin(0));
    types.forEach((str, i) => p.add(text(this, statX + 5, typesY + 5 + i * 8, str, { color: THEME.plate.ink })));
    const descY = artY + ART_FRAME + 5;
    this.paper(L.x, descY, L.w, L.bottom - descY);
    const pad = INSET.paper + 1;
    p.add(text(this, L.x + pad, descY + pad, r.desc, { maxWidth: L.w - pad * 2, color: THEME.panel.paperInk }));
  }

  /**
   * One stat in the info panel: a dark wood plate (Frame01a, as the card menu) with a pixel icon on the
   * left, a small label ("ATK") over the value in 2x light text.
   */
  private statPlate(p: Phaser.GameObjects.Container, x: number, y: number, w: number, label: string, value: string, icon: PixelIcon) {
    const pr = THEME.plate.slice;
    p.add(this.add.nineslice(x, y, ui("menu-back"), undefined, w, STAT_PLATE_H, pr, pr, pr, pr).setOrigin(0));
    const g = this.add.graphics();
    const iconY = y + Math.floor((STAT_PLATE_H - icon.rows.length) / 2);
    icon.rows.forEach((row, iy) => [...row].forEach((ch, ix) => {
      const color = icon.colors[ch];
      if (color !== undefined) g.fillStyle(color).fillRect(x + 5 + ix, iconY + iy, 1, 1);
    }));
    p.add(g);
    const tx = x + 5 + icon.rows[0].length + 4;
    p.add(text(this, tx, y + 5, label, { color: THEME.plate.inkSoft }));
    p.add(text(this, tx, y + 12, value, { scale: 2, color: THEME.plate.ink }));
  }

  /**
   * Marquee for long card names: wait, scroll left until the end is visible, pause, jump back to the
   * start, pause, repeat. The name (text + shadow, `nameWidth` wide) is clipped to `width` by a geometry mask.
   */
  private scrollName(name: Phaser.GameObjects.Container, nameWidth: number, width: number) {
    const mask = this.make.graphics({}, false);
    mask.fillStyle(0xffffff).fillRect(name.x, name.y - 1, width, 2 * 7 + 3);
    name.setMask(mask.createGeometryMask());
    const overflow = nameWidth - width;
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
    this.infoPanel.add(text(this, L.x + 1, L.top, "DUEL LOG", { color: THEME.panel.inkSoft }));
    this.paper(L.x, LOG_Y - INSET.paper - 1, L.w, L.bottom - LOG_Y + INSET.paper + 1);
    this.renderLog();
  }

  private log(line: string) {
    this.logLines.push(line.toUpperCase());
    while (this.logLines.length > 200) this.logLines.shift();
    this.renderLog();
  }

  private renderLog() {
    // Show as many recent lines as fit above the speed button.
    const room = LAYOUT.bottom - INSET.paper - this.logText.y;
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
    if (messages.length) for (const b of this.counterBadges) b.setVisible(false);
    await this.animator.play(messages, (m) => {
      if (m.type === OcgMessageType.NEW_TURN) this.turnPlayer = m.player;
      // Card mode starts empty; the first card you draw fills it.
      if (m.type === OcgMessageType.DRAW && m.player === this.me && !this.lastCode && m.drawn[0]?.code) {
        this.lastCode = m.drawn[0].code;
        if (this.panelMode === "card") this.showCard(this.lastCode);
      }
      const line = describeMessage(m, this.engine.text, this.me);
      if (line) this.log(line);
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
    this.controller.stop();
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
    this.counterBadges = [];
    snap.players.forEach((p, player) => {
      const s = this.side(player);
      this.handCount[s] = p.hand.length;
      this.lpValue[s] = p.lp;
      this.lpBars[s].set(p.lp);
      p.monsters.forEach((c, seq) => c && this.placeCard(c, slotXY(s, { kind: "mzone", seq })));
      p.spells.forEach((c, seq) => c && this.placeCard(c, slotXY(s, { kind: "szone", seq })));
      this.drawPile(s, { kind: "deck" }, p.deckCount, null);
      // Only your own Extra Deck can be browsed (the opponent's cards are hidden anyway).
      this.drawPile(s, { kind: "extra" }, p.extraCount, null, s === 0 ? p.extra : undefined);
      this.drawPile(s, { kind: "grave" }, p.grave.length, p.grave.at(-1) ?? null, [...p.grave].reverse(), p.banished);
      this.drawHand(s, p.hand);
    });
    this.applyHighlights();
  }

  private placeCard(c: CardView, at: { x: number; y: number }) {
    const sp = this.cardSprite(c, at.x, at.y);
    const sideways = c.location === OcgLocation.MZONE && (c.position & DEFENSE) !== 0;
    if (sideways) sp.setAngle(90);
    // Counters: a number badge on the card's top-right corner, like the pile counts.
    if (c.counters) {
      const badge = this.badge(at.x + (sideways ? CARD.h : CARD.w) / 2, at.y - (sideways ? CARD.w : CARD.h) / 2, String(c.counters), 1);
      this.counterBadges.push(badge);
      this.board.add(badge);
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
        sp.on("pointerover", () => this.showInfo(top.code));
        sp.on("pointerout", () => this.hoverEnd());
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
    sp.on("pointerover", () => code && this.showInfo(code));
    sp.on("pointerout", () => this.hoverEnd());
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
      // Closing sets the pending prompt up again (and ends a dev preview of this browser).
      buttons: [{ label: "Close", onClick: () => { this.previewing = false; if (pending) this.onPrompt(pending, this.lastHint); } }],
      onHover: (code) => this.showInfo(code),
      onHoverEnd: () => this.hoverEnd(),
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
      this.log(`(preview) answer: ${JSON.stringify(response, (_k, v) => (typeof v === "bigint" ? String(v) : v))}`);
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
        this.pickCards(m.selects, {
          title: title(`Select ${range(m.min, m.max)} card(s)`),
          cards: m.selects.map((c) => ({ code: c.code, caption: locationName(c.location, c.controller, this.me) })),
          mode: m.min === 1 && m.max === 1 ? "single" : "multi",
          isValid: (sel) => sel.length >= m.min && sel.length <= m.max,
          max: m.max,
          onConfirm: (sel) => this.answer({ type: OcgResponseType.SELECT_CARD, indicies: sel }),
          buttons: m.can_cancel ? [{ label: "Cancel", onClick: () => this.answer({ type: OcgResponseType.SELECT_CARD, indicies: null }) }] : [],
          onHover: (code) => this.showInfo(code),
          onHoverEnd: () => this.hoverEnd(),
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
          onHover: (code) => this.showInfo(code),
          onHoverEnd: () => this.hoverEnd(),
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
          onHover: (code) => this.showInfo(code),
          onHoverEnd: () => this.hoverEnd(),
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
          onHover: (code) => this.showInfo(code),
        });
        return;
      }
    }
    // Anything not handled above (rare in the GOAT pool: counters to remove, sorting, RPS): the bot answers.
    this.log(`(auto-answered ${OcgMessageType[m.type] ?? m.type})`);
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
