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
import { PHASE_NAMES } from "../duel/text.ts";
import { CardSprite, type CardHighlight } from "../ui/duel/CardSprite.ts";
import { Modal, type PickerCard } from "../ui/duel/Modal.ts";
import { describeMessage } from "../ui/duel/duelLog.ts";
import { FIELD_CARD, FIELD_CENTER_X, HAND_CARD, INFO_PANEL, ROWS, SIDE_PANEL, slotXY, type Slot } from "../ui/duel/layout.ts";
import { FONT, makeButton, type Button } from "../ui/widgets.ts";

export interface DuelSceneData {
  playerDeck?: Deck;
  opponentDeck?: Deck;
  opponentName?: string;
  startingLP?: number;
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

export class DuelScene extends Phaser.Scene {
  private engine!: Engine;
  private controller!: DuelController;
  private modal!: Modal;
  private sceneData: DuelSceneData = {};

  private board!: Phaser.GameObjects.Container;
  private sprites = new Map<string, CardSprite>();
  private actions = new Map<string, CardAction[]>();
  private menu: Phaser.GameObjects.Container | null = null;
  private placeTargets: Phaser.GameObjects.GameObject[] = [];
  private snapshot: FieldSnapshot | null = null;

  private info!: { card: CardSprite; name: Phaser.GameObjects.Text; body: Phaser.GameObjects.Text };
  private lpText!: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private phaseText!: Phaser.GameObjects.Text;
  private logText!: Phaser.GameObjects.Text;
  private logLines: string[] = [];
  private phaseButtons!: { bp: Button; m2: Button; ep: Button };

  constructor() {
    super("Duel");
  }

  init(data: DuelSceneData) {
    this.sceneData = data ?? {};
    this.sprites.clear();
    this.actions.clear();
    this.logLines = [];
    this.menu = null;
    this.placeTargets = [];
  }

  async create() {
    this.engine = await loadEngine();
    const { core, cards, readScript } = this.engine;
    this.modal = new Modal(this, cards);

    this.drawStaticBoard();
    this.createInfoPanel();
    this.createSidePanel();
    this.board = this.add.container(0, 0);
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
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => session.destroy());
    this.controller.start();
  }

  // ---------------------------------------------------------------- layout

  private drawStaticBoard() {
    const g = this.add.graphics();
    g.fillStyle(0x0b1630).fillRect(INFO_PANEL.w, 0, SIDE_PANEL.x - INFO_PANEL.w, 720);
    g.fillStyle(0x10152b).fillRect(0, 0, INFO_PANEL.w, 720);
    g.fillStyle(0x10152b).fillRect(SIDE_PANEL.x, 0, SIDE_PANEL.w, 720);
    g.lineStyle(1, 0x3d4f80, 0.8);
    for (const side of [0, 1] as const) {
      const slots: Slot[] = [
        ...[0, 1, 2, 3, 4].map((seq): Slot => ({ kind: "mzone", seq })),
        ...[0, 1, 2, 3, 4, 5].map((seq): Slot => ({ kind: "szone", seq })),
        { kind: "grave" }, { kind: "deck" }, { kind: "extra" }, { kind: "banished" },
      ];
      for (const slot of slots) {
        const { x, y } = slotXY(side, slot);
        g.strokeRoundedRect(x - FIELD_CARD.w / 2 - 4, y - FIELD_CARD.h / 2 - 4, FIELD_CARD.w + 8, FIELD_CARD.h + 8, 4);
      }
    }
    this.phaseText = this.add.text(FIELD_CENTER_X, ROWS.center, "", { fontFamily: FONT, fontSize: "16px", color: "#ffe9a8" }).setOrigin(0.5);
  }

  private createInfoPanel() {
    const card = new CardSprite(this, INFO_PANEL.w / 2, 190, 240, 350);
    card.setVisible(false);
    const name = this.add.text(12, 372, "Hover a card to see it here", { fontFamily: FONT, fontSize: "16px", color: "#ffffff", fontStyle: "bold", wordWrap: { width: INFO_PANEL.w - 24 } });
    const body = this.add.text(12, 400, "", { fontFamily: FONT, fontSize: "12px", color: "#cfd6ff", wordWrap: { width: INFO_PANEL.w - 24 }, lineSpacing: 2 });
    this.info = { card, name, body };
  }

  private showInfo(code: number) {
    const r = this.engine.cards.records.get(code);
    if (!code || !r) return;
    this.info.card.setVisible(true).show(code, r);
    const stats = r.type & 0x1 ? `\nATK ${r.atk} / DEF ${r.def}` : "";
    this.info.name.setText(r.name + stats);
    this.info.body.setY(this.info.name.y + this.info.name.height + 8).setText(r.desc);
  }

  private createSidePanel() {
    const x = SIDE_PANEL.x + SIDE_PANEL.w / 2;
    const lp = (y: number, who: string) =>
      this.add.text(x, y, `${who}\nLP 8000`, { fontFamily: FONT, fontSize: "20px", color: "#ffffff", align: "center" }).setOrigin(0.5);
    this.lpText = [lp(668, "You"), lp(42, this.sceneData.opponentName ?? "Opponent")];
    this.logText = this.add.text(SIDE_PANEL.x + 12, 92, "", {
      fontFamily: FONT, fontSize: "12px", color: "#c8d0f0", wordWrap: { width: SIDE_PANEL.w - 24 }, lineSpacing: 3,
    });
    const idle = (action: SelectIdleCMDAction) => ({ type: OcgResponseType.SELECT_IDLECMD, action, index: null }) as OcgResponse;
    const battle = (action: SelectBattleCMDAction) => ({ type: OcgResponseType.SELECT_BATTLECMD, action, index: null }) as OcgResponse;
    this.phaseButtons = {
      bp: makeButton(this, x, 500, 200, 38, "Battle Phase", () => this.answer(idle(SelectIdleCMDAction.TO_BP))),
      m2: makeButton(this, x, 546, 200, 38, "Main Phase 2", () => this.answer(battle(SelectBattleCMDAction.TO_M2))),
      ep: makeButton(this, x, 592, 200, 38, "End Turn", () => {
        const p = this.controller.waitingForHuman;
        this.answer(p?.type === OcgMessageType.SELECT_BATTLECMD ? battle(SelectBattleCMDAction.TO_EP) : idle(SelectIdleCMDAction.TO_EP));
      }, 0x7a2d2d),
    };
    this.setPhaseButtons(false, false, false);
  }

  private setPhaseButtons(bp: boolean, m2: boolean, ep: boolean) {
    this.phaseButtons.bp.setEnabled(bp);
    this.phaseButtons.m2.setEnabled(m2);
    this.phaseButtons.ep.setEnabled(ep);
  }

  private log(line: string) {
    this.logLines.push(line);
    while (this.logLines.length > 400) this.logLines.shift();
    // Show as many recent lines as fit between the opponent LP and the buttons.
    for (let n = Math.min(this.logLines.length, 28); n > 0; n--) {
      this.logText.setText(this.logLines.slice(-n).join("\n"));
      if (this.logText.height <= 380) break;
    }
  }

  // ---------------------------------------------------------------- engine events

  private onUpdate(messages: OcgMessage[], snapshot: FieldSnapshot) {
    for (const m of messages) {
      const line = describeMessage(m, this.engine.text);
      if (line) this.log(line);
      if (m.type === OcgMessageType.DAMAGE || m.type === OcgMessageType.PAY_LPCOST) this.floatLP(m.player, `-${m.amount}`, "#ff6666");
      if (m.type === OcgMessageType.RECOVER) this.floatLP(m.player, `+${m.amount}`, "#66ff99");
    }
    this.snapshot = snapshot;
    this.renderBoard(snapshot);
    const c = this.controller;
    const turn = c.turnPlayer === HUMAN ? "Your" : "Opponent's";
    this.phaseText.setText(c.turn ? `Turn ${c.turn} · ${turn} ${PHASE_NAMES[c.phase] ?? ""}` : "");
  }

  private floatLP(player: number, text: string, color: string) {
    const t = this.lpText[player === HUMAN ? 0 : 1];
    const f = this.add.text(t.x, t.y, text, { fontFamily: FONT, fontSize: "26px", color, fontStyle: "bold" }).setOrigin(0.5).setDepth(500);
    this.tweens.add({ targets: f, y: t.y + (player === HUMAN ? -60 : 60), alpha: 0, duration: 1200, onComplete: () => f.destroy() });
  }

  private onEnd(winner: number | null) {
    this.clearInteraction();
    const won = winner === HUMAN;
    this.modal.dialog(won ? "You win the duel!" : winner === AI ? "You lost the duel…" : "The duel ended in a draw.", [
      { label: "Continue", onClick: () => this.scene.start(this.sceneData.returnScene ?? "Overworld", { duelResult: { won } }) },
    ]);
  }

  // ---------------------------------------------------------------- board rendering

  private renderBoard(snap: FieldSnapshot) {
    this.board.removeAll(true);
    this.sprites.clear();
    snap.players.forEach((p, side) => {
      const s = side as 0 | 1;
      this.lpText[side].setText(`${side === HUMAN ? "You" : this.sceneData.opponentName ?? "Opponent"}\nLP ${p.lp}`);
      p.monsters.forEach((c, seq) => c && this.placeCard(c, slotXY(s, { kind: "mzone", seq })));
      p.spells.forEach((c, seq) => c && this.placeCard(c, slotXY(s, { kind: "szone", seq })));
      this.drawPile(s, { kind: "deck" }, p.deckCount, null);
      this.drawPile(s, { kind: "extra" }, p.extraCount, null);
      this.drawPile(s, { kind: "grave" }, p.grave.length, p.grave.at(-1) ?? null, p.grave);
      this.drawPile(s, { kind: "banished" }, p.banished.length, p.banished.at(-1) ?? null, p.banished);
      this.drawHand(s, p.hand);
    });
    this.applyHighlights();
  }

  private placeCard(c: CardView, at: { x: number; y: number }) {
    const sp = this.cardSprite(c, at.x, at.y, FIELD_CARD.w, FIELD_CARD.h);
    if (c.location === OcgLocation.MZONE && c.position & DEFENSE) sp.setAngle(90);
    if (c.location === OcgLocation.MZONE && !c.faceDown) {
      const stat = this.add.text(at.x, at.y + (c.controller === HUMAN ? 1 : -1) * (FIELD_CARD.h / 2 + 2), `${c.attack}/${c.defense}`, {
        fontFamily: FONT, fontSize: "11px", color: "#ffffff", backgroundColor: "#000000aa", padding: { x: 3, y: 1 },
      }).setOrigin(0.5, c.controller === HUMAN ? 0 : 1);
      this.board.add(stat);
    }
  }

  private drawPile(side: 0 | 1, slot: Slot, count: number, top: CardView | null, contents?: CardView[]) {
    if (!count) return;
    const { x, y } = slotXY(side, slot);
    const sp = new CardSprite(this, x, y, FIELD_CARD.w, FIELD_CARD.h).show(top?.code ?? 0, this.engine.cards.records.get(top?.code ?? 0), { back: !top });
    sp.setInteractive({ useHandCursor: !!contents });
    if (top) sp.on("pointerover", () => this.showInfo(top.code));
    if (contents) sp.on("pointerup", () => this.browsePile(contents));
    const label = this.add.text(x, y, String(count), { fontFamily: FONT, fontSize: "16px", color: "#ffffff", backgroundColor: "#000000bb", padding: { x: 4, y: 1 } }).setOrigin(0.5);
    this.board.add([sp, label]);
  }

  private drawHand(side: 0 | 1, hand: CardView[]) {
    const size = side === HUMAN ? HAND_CARD : FIELD_CARD;
    const y = side === HUMAN ? ROWS.myHand : ROWS.oppHand;
    const pitch = Math.min(size.w + 8, 600 / Math.max(1, hand.length));
    hand.forEach((c, i) => {
      const x = FIELD_CENTER_X + (i - (hand.length - 1) / 2) * pitch;
      const sp = this.cardSprite(c, x, y, size.w, size.h);
      if (side === HUMAN) {
        sp.on("pointerover", () => this.tweens.add({ targets: sp, y: y - 18, duration: 90 }));
        sp.on("pointerout", () => this.tweens.add({ targets: sp, y, duration: 90 }));
      }
    });
  }

  private cardSprite(c: CardView, x: number, y: number, w: number, h: number): CardSprite {
    const own = c.controller === HUMAN;
    const sp = new CardSprite(this, x, y, w, h).show(c.code, this.engine.cards.records.get(c.code), {
      back: c.code === 0, dim: own && c.faceDown,
    });
    sp.setInteractive({ useHandCursor: true });
    const k = key(c.controller, c.location, c.sequence);
    sp.on("pointerover", () => c.code && this.showInfo(c.code));
    sp.on("pointerup", (p: Phaser.Input.Pointer) => this.onCardClick(k, p));
    this.sprites.set(k, sp);
    this.board.add(sp);
    return sp;
  }

  private browsePile(contents: CardView[]) {
    if (this.modal.isOpen || !contents.length) return;
    const pending = this.controller.waitingForHuman;
    this.modal.picker({
      title: "Cards in this pile (newest first)",
      cards: [...contents].reverse().map((c) => ({ code: c.code, locked: true })),
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
    this.actions.clear();
    this.closeMenu();
    for (const o of this.placeTargets) o.destroy();
    this.placeTargets = [];
    this.setPhaseButtons(false, false, false);
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
        add(m.summons, "Normal Summon", SelectIdleCMDAction.SELECT_SUMMON);
        add(m.special_summons, "Special Summon", SelectIdleCMDAction.SELECT_SPECIAL_SUMMON);
        add(m.monster_sets, "Set", SelectIdleCMDAction.SELECT_MONSTER_SET);
        add(m.spell_sets, "Set", SelectIdleCMDAction.SELECT_SPELL_SET);
        add(m.pos_changes, "Change Position", SelectIdleCMDAction.SELECT_POS_CHANGE);
        m.activates.forEach((c, index) => this.addAction(c, this.activateLabel(c.code, c.description), {
          type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index,
        }));
        this.setPhaseButtons(m.to_bp, false, m.to_ep);
        this.applyHighlights();
        return;
      }
      case OcgMessageType.SELECT_BATTLECMD: {
        m.attacks.forEach((c, index) => this.addAction(c, "Attack", { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index }));
        m.chains.forEach((c, index) => this.addAction(c, this.activateLabel(c.code, c.description), {
          type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_CHAIN, index,
        }));
        this.setPhaseButtons(false, m.to_m2, m.to_ep);
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
        const text = m.description ? t.describe(m.description, name(m.code)) : t.describe(95, name(m.code));
        this.yesNo(text || `Activate the effect of "${name(m.code)}"?`, (yes) => ({ type: OcgResponseType.SELECT_EFFECTYN, yes }), m.code);
        return;
      }
      case OcgMessageType.SELECT_YESNO:
        this.yesNo(t.describe(m.description), (yes) => ({ type: OcgResponseType.SELECT_YESNO, yes }));
        return;
      case OcgMessageType.SELECT_OPTION:
        this.modal.dialog(title("Choose an option"), m.options.map((o, index) => ({
          label: t.describe(o), onClick: () => this.answer({ type: OcgResponseType.SELECT_OPTION, index }),
        })));
        return;
      case OcgMessageType.SELECT_POSITION: {
        const choices: [OcgPosition, string][] = [
          [OcgPosition.FACEUP_ATTACK, "Attack"], [OcgPosition.FACEDOWN_ATTACK, "Face-down Attack"],
          [OcgPosition.FACEUP_DEFENSE, "Defense"], [OcgPosition.FACEDOWN_DEFENSE, "Face-down Defense"],
        ];
        this.modal.dialog(`Choose a battle position for "${name(m.code)}"`, choices.filter(([p]) => m.positions & p).map(([position, label]) => ({
          label, onClick: () => this.answer({ type: OcgResponseType.SELECT_POSITION, position }),
        })), m.code);
        return;
      }
      case OcgMessageType.SELECT_CARD:
        this.modal.picker({
          title: title(`Select ${range(m.min, m.max)} card(s)`),
          cards: m.selects.map((c) => ({ code: c.code, caption: `${name(c.code)}\n${locationName(c.location, c.controller)}` })),
          mode: m.min === 1 && m.max === 1 ? "single" : "multi",
          isValid: (sel) => sel.length >= m.min && sel.length <= m.max,
          onConfirm: (sel) => this.answer({ type: OcgResponseType.SELECT_CARD, indicies: sel }),
          buttons: m.can_cancel ? [{ label: "Cancel", onClick: () => this.answer({ type: OcgResponseType.SELECT_CARD, indicies: null }) }] : [],
          onHover: (code) => this.showInfo(code),
        });
        return;
      case OcgMessageType.SELECT_TRIBUTE:
        this.modal.picker({
          title: title(`Select monster(s) to Tribute`),
          cards: m.selects.map((c) => ({ code: c.code, caption: `${name(c.code)}\n${locationName(c.location, c.controller)}` })),
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
          ...m.select_cards.map((c) => ({ code: c.code, caption: `${name(c.code)}\n${locationName(c.location, c.controller)}` })),
          ...m.unselect_cards.map((c) => ({ code: c.code, caption: `${name(c.code)} ✓`, selected: true })),
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
            ...m.selects.map((c) => ({ code: c.code, caption: `${name(c.code)} (${c.amount & 0xffff})` })),
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

  private yesNo(text: string, make: (yes: boolean) => OcgResponse, code?: number) {
    this.modal.dialog(text, [
      { label: "Yes", onClick: () => this.answer(make(true)) },
      { label: "No", onClick: () => this.answer(make(false)) },
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
    const w = 190, h = 34;
    const x = Phaser.Math.Clamp(p.x, INFO_PANEL.w + w / 2 + 4, SIDE_PANEL.x - w / 2 - 4);
    const top = Math.max(h / 2 + 4, p.y - 20 - list.length * (h + 4));
    this.menu = this.add.container(0, 0).setDepth(900);
    list.forEach((a, i) => this.menu!.add(makeButton(this, x, top + i * (h + 4), w, h, a.label, () => this.answer(a.response), 0x3a3f8f)));
  }

  private closeMenu() {
    this.menu?.destroy();
    this.menu = null;
  }

  /** Highlights free zones on the field; collects `count` clicks, then responds. */
  private pickPlaces(type: OcgMessageType, player: number, fieldMask: number, count: number, title: string) {
    const free = freePlaces(player, fieldMask, 32);
    const chosen: SelectFieldPlace[] = [];
    this.phaseText.setText(title);
    for (const place of free) {
      const side = (place.player === HUMAN ? 0 : 1) as 0 | 1;
      const slot: Slot = place.location === OcgLocation.MZONE ? { kind: "mzone", seq: place.sequence } : { kind: "szone", seq: place.sequence };
      if (place.location === OcgLocation.MZONE && place.sequence > 4) continue; // no Extra Monster Zones in GOAT
      const { x, y } = slotXY(side, slot);
      const r = this.add.rectangle(x, y, FIELD_CARD.w + 8, FIELD_CARD.h + 8, 0xffe14d, 0.25).setStrokeStyle(2, 0xffe14d).setDepth(800);
      r.setInteractive({ useHandCursor: true }).on("pointerup", () => {
        chosen.push(place);
        r.destroy();
        if (chosen.length >= count) {
          this.answer(type === OcgMessageType.SELECT_PLACE
            ? { type: OcgResponseType.SELECT_PLACE, places: chosen }
            : { type: OcgResponseType.SELECT_DISFIELD, places: chosen });
        }
      });
      this.placeTargets.push(r);
    }
  }
}

function range(min: number, max: number) {
  return min === max ? String(min) : `${min}-${max}`;
}

function locationName(location: number, controller: number): string {
  const owner = controller === HUMAN ? "Your" : "Opp.";
  const names: Record<number, string> = {
    [OcgLocation.DECK]: "Deck", [OcgLocation.HAND]: "Hand", [OcgLocation.MZONE]: "Monster Zone",
    [OcgLocation.SZONE]: "S/T Zone", [OcgLocation.GRAVE]: "GY", [OcgLocation.REMOVED]: "Banished", [OcgLocation.EXTRA]: "Extra Deck",
  };
  return `${owner} ${names[location] ?? "?"}`;
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
