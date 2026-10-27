import Phaser from "phaser";
import {
  OcgLocation,
  OcgMessageType,
  OcgResponseType,
  type OcgCardLoc,
  type OcgMessage,
  type OcgResponse,
} from "ocgcore-wasm";
import { loadEngine, type Engine } from "../duel/engine/loadEngine.ts";
import { DuelSession, type CardView, type FieldSnapshot, type Deck, type DuelSeed } from "../duel/engine/DuelSession.ts";
import { DuelController, type HumanPrompt } from "../duel/DuelController.ts";
import { AiSeat, type AiPlayer } from "../duel/ai/AiSeat.ts";
import { BRAINS, DEFAULT_BRAIN, type BrainName } from "../duel/ai/brains.ts";
import { formatTrace, type TraceEntry } from "../duel/ai/trace.ts";
import { AiWorkerClient } from "../duel/ai/worker/AiWorkerClient.ts";
import { DECKS } from "../duel/decks/decks.ts";
import { aiRpsOpponent } from "../duel/rps.ts";
import { animSpeed, chainMode, revealAiCards } from "../ui/prefs.ts";
import type { NetDuel } from "../net/p2p.ts";
import { CardSprite } from "./CardSprite.ts";
import { Modal } from "./Modal.ts";
import { InfoPanel } from "./InfoPanel.ts";
import { describeMessage } from "./duelLog.ts";
import { DuelAnimator } from "./DuelAnimator.ts";
import { RpsIntro } from "./RpsIntro.ts";
import { CardMenu } from "./CardMenu.ts";
import { BoardPick } from "./BoardPick.ts";
import { drawField } from "./field.ts";
import { CARD, FIELD_CENTER, cardKey } from "./layout.ts";
import { installAnimPreview } from "../dev/animPreview.ts";
import { installDialogPreview } from "../dev/dialogPreview.ts";
import { showPrompt, type PhaseAction, type PromptHost } from "./duelPrompts.ts";
import { withDevSetup } from "../dev/devSetups.ts";
import { ui } from "../ui/theme.ts";
import { BoardView } from "./BoardView.ts";
import { PhaseColumn } from "./PhaseColumn.ts";
import { PromptBand } from "./PromptBand.ts";
import { createCornerButtons } from "./cornerButtons.ts";
import { boardLog, replayInfo } from "./aiTrace.ts";

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
  /** The opponent AI's brain (ignored with `net`). Default: DEFAULT_BRAIN. */
  ai?: BrainName;
}

interface CardAction {
  label: string;
  response: OcgResponse;
}

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

  /** The cards on the board (sprites by cardKey, counter badges). */
  private view!: BoardView;
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
  /** Turns started so far (the traces' T number). */
  private turnCount = 0;
  /** Testing aid: the AI's hand and set cards are shown (world menu "AI CARDS", or `&reveal`); never in multiplayer. */
  private revealOpponent = false;
  private phase = 0;

  private panel!: InfoPanel;
  /** Declared attack (sprite keys), outlined until the hit or until the attack ends. */
  private attackMarks: [string | null, string | null] = [null, null];
  private attackArrow: Phaser.GameObjects.Image | null = null;
  private phaseColumn!: PhaseColumn;
  private promptBand!: PromptBand;
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
    this.turnCount = 0;
    this.revealOpponent = false;
    this.phase = 0;
    this.attackArrow = null;
    this.attackMarks = [null, null];
  }

  async create() {
    this.engine = await loadEngine();
    const { core, cards, readScript } = this.engine;
    this.modal = new Modal(this, cards);

    // Table, playmat and zones (field.ts).
    drawField(this, this.add.container(0, 0));
    const scene = this;
    this.view = new BoardView({
      scene: this,
      cards,
      get panel() { return scene.panel; },
      get animator() { return scene.animator; },
      get revealOpponent() { return scene.revealOpponent; },
      get me() { return scene.me; },
      side: (player) => this.side(player),
      handCount: this.handCount,
      lpValue: this.lpValue,
      onCardClick: (k) => this.onCardClick(k),
      openDeckMenu: (sp) => this.openDeckMenu(sp),
      browsePile: (side, contents, banished, pile) => this.browsePile(side, contents, banished, pile),
      applyHighlights: () => this.applyHighlights(),
    });
    this.boardPick = new BoardPick({
      scene: this,
      sprites: this.view.sprites,
      snapshot: () => this.snapshot,
      side: (player) => this.side(player),
      setPrompt: (label, buttons, counter) => this.promptBand.set(label, buttons, counter),
      counterBadge: (k, count) => this.view.counterBadge(k, count),
      applyHighlights: () => this.applyHighlights(),
    });
    this.animator = new DuelAnimator({
      scene: this,
      cards,
      get me() { return scene.me; },
      sprites: this.view.sprites,
      board: this.view.container,
      handCount: this.handCount,
      setPhase: (phase) => { this.phase = phase; this.phaseColumn.draw(); },
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
    createCornerButtons(this, this.animator, this.panel);
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
    this.phaseColumn = new PhaseColumn(this, {
      get phase() { return scene.phase; },
      get myTurn() { return scene.turnPlayer === scene.me; },
      phaseActions: this.phaseActions,
      answer: (response) => this.answer(response),
    });
    this.phaseColumn.draw();
    this.promptBand = new PromptBand(this);
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
    // Duels vs the AI always get a seed that fits `&seed=N`, so a traced one can be replayed.
    const seedNumber = this.sceneData.seed ?? Math.floor(Math.random() * 2 ** 31);
    const seed = net ? net.seed : ([BigInt(seedNumber), 0n, 0n, 0n] as DuelSeed);
    session = new DuelSession({ core, cards, readScript, startingLP: this.sceneData.startingLP, seed, decks });
    const params = new URLSearchParams(location.search);
    // `&aitrace` prints every AI decision to the console (also in the deployed game, for reporting misplays).
    const trace = params.has("aitrace");
    if (trace && !net) {
      console.log(replayInfo(this.sceneData, this.me, seedNumber, mine, theirs));
      // L logs the whole board, both hands and set cards included (not while typing in a text field).
      this.input.keyboard?.on("keydown-L", () => {
        if (document.activeElement instanceof HTMLInputElement) return;
        console.log(boardLog(this.controller.session, cards, this.me,
          { turn: this.turnCount, phase: this.phase, turnPlayer: this.turnPlayer, seed: seedNumber }));
      });
    }
    this.revealOpponent = !net && (revealAiCards() || params.has("reveal"));
    // The AI thinks in a Web Worker (`&noworker`: on the main thread).
    const aiSeat = (1 - this.me) as 0 | 1;
    const brain = this.sceneData.ai ?? DEFAULT_BRAIN;
    const onTrace = trace ? (e: TraceEntry) => console.log(formatTrace(e)) : undefined;
    let ai: AiPlayer | undefined;
    if (!net) {
      const useWorker = typeof Worker !== "undefined" && !params.has("noworker");
      ai = useWorker
        ? new AiWorkerClient({ seat: aiSeat, brain, duel: session, engine: { core, cards, readScript }, deck: theirs.main, onTrace })
        : new AiSeat({
          seat: aiSeat, brain: BRAINS[brain]({ engine: { core, cards, readScript } }), duel: session,
          deck: theirs.main, strict: import.meta.env.DEV, onTrace,
        });
    }
    this.controller = new DuelController({
      session,
      me: this.me,
      remote: net?.remote,
      ai,
      chainMode,
      revealOpponent: this.revealOpponent,
      schedule: (ms, fn) => this.time.delayedCall(ms, fn),
      events: {
        onUpdate: (messages, snapshot) => this.onUpdate(messages, snapshot),
        onPrompt: (prompt, hint) => {
          this.previewing = false; // a real prompt replaces any dev preview
          this.lastHint = hint;
          this.onPrompt(prompt, hint);
        },
        onEnd: (winner, reason) => this.onEnd(winner, reason),
        onError: (message) => this.stopDuel(`${message} The duel can't continue.`),
      },
    });
    this.controller.start();
    // Dev: `&anims` adds a dropdown to replay single animations (see animPreview.ts).
    if (import.meta.env.DEV && params.has("anims")) {
      installAnimPreview({
        scene: this, animator: this.animator, me: () => this.me, snapshot: () => this.snapshot, renderBoard: (snap) => this.view.render(snap),
      });
    }
    // Dev: `&dialogs` adds a dropdown to open every prompt UI with sample cards (see dialogPreview.ts).
    if (import.meta.env.DEV && params.has("dialogs")) {
      installDialogPreview({
        scene: this,
        me: () => this.me,
        snapshot: () => this.snapshot,
        prompt: (prompt, hint, onAnswer) => this.previewPrompt(() => this.onPrompt(prompt, hint), onAnswer),
        end: (winner) => this.previewPrompt(() => this.endDialog(winner, 1 /* LP reached 0 */, () => this.answer({ type: OcgResponseType.SELECT_YESNO, yes: true }))),
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
      prompt: (label) => void this.promptBand.set(label),
      ask: (message, buttons) => new Promise((resolve) => {
        this.modal.dialog(message, buttons.map((label, i) => ({ label, onClick: () => resolve(i) })));
      }),
      log: (line) => this.panel.log(line),
      active: () => !this.ended,
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => rps.destroy());
    return rps.run();
  }

  // ---------------------------------------------------------------- engine events

  private async onUpdate(messages: OcgMessage[], snapshot: FieldSnapshot): Promise<void> {
    if (!this.snapshot) {
      // First update: show full decks and empty hands so the opening draw has something to animate from.
      this.view.render({
        players: snapshot.players.map((p) => ({ ...p, hand: [], deckCount: p.deckCount + p.hand.length })) as unknown as FieldSnapshot["players"],
      });
    }
    if (messages.length) this.view.hideCounterBadges();
    await this.animator.play(messages, (m) => {
      if (m.type === OcgMessageType.NEW_TURN) { this.turnPlayer = m.player; this.turnCount++; }
      if (m.type === OcgMessageType.DRAW && m.player === this.me) this.panel.drew(m.drawn[0]?.code ?? 0);
      const line = describeMessage(m, this.engine.text, this.me);
      if (line) this.panel.log(line);
    });
    this.snapshot = snapshot;
    this.view.render(snapshot);
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

  private onEnd(winner: number | null, reason: number | null) {
    this.ended = true;
    this.clearInteraction();
    this.endDialog(winner, reason, () => this.scene.start(this.sceneData.returnScene ?? "Overworld", { duelResult: { won: winner === this.me } }));
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

  /** Win / loss / draw, and why underneath (LP reached 0, Exodia, Destiny Board...). */
  private endDialog(winner: number | null, reason: number | null, onContinue: () => void) {
    let message = "THE DUEL ENDED IN A DRAW.";
    if (winner === this.me) message = "YOU WIN THE DUEL!";
    else if (winner === 1 - this.me) message = "YOU LOST THE DUEL...";
    const why = reason === null ? "" : this.engine.text.winReason(reason);
    this.modal.dialog(why ? `${message}
${why.toUpperCase()}` : message, [{ label: "CONTINUE", onClick: onContinue }]);
  }

  /** Lists a pile's cards in a picker dialog: a Graveyard (newest first, then banished cards) or your Extra Deck. */
  private browsePile(side: 0 | 1, contents: CardView[], banished: CardView[], pile: "grave" | "extra" = "grave") {
    if (this.modal.isOpen || !contents.length && !banished.length) return;
    const pending = this.controller.waitingForHuman;
    const owner = side === 0 ? "Your" : "Opponent's";
    // Cards you can use from here (a contact fusion's Sp.Sum, an effect that activates in the Graveyard) are
    // clickable, captioned with their action; the rest only show.
    const shown = [...contents, ...[...banished].reverse()];
    const acts = shown.map((c) => (c.location === undefined ? undefined : this.actions.get(cardKey(c))));
    this.modal.picker({
      title: pile === "extra" ? `${owner} Extra Deck` : `${owner} Graveyard (newest first)${banished.length ? ", then banished" : ""}`,
      // No names (they're on the cards); only banished cards get a caption, to tell them apart.
      cards: shown.map((c, i) => acts[i]
        ? { code: c.code, caption: acts[i].map((a) => a.label).join(" / ") }
        : { code: c.code, inert: true, caption: i < contents.length ? "" : "BANISHED" }),
      mode: "single",
      onConfirm: ([i]) => {
        const list = acts[i]!;
        if (list.length === 1) { this.answer(list[0].response); return; }
        this.modal.dialog(this.engine.text.name(shown[i].code).toUpperCase(),
          [...list.map((a) => ({ label: a.label.toUpperCase(), onClick: () => this.answer(a.response) })), { label: "CANCEL", onClick: () => {} }],
          shown[i].code);
      },
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
    this.promptBand.set(null);
    this.actions.clear();
    this.phaseActions.clear();
    this.closeMenu();
    this.phaseColumn.draw();
    this.applyHighlights();
  }

  /**
   * Red arrow (8x6, the theme's "attack-up" / "attack-down") on the declared attacker's edge facing the opponent:
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
    this.view.container.add(this.attackArrow);
  }

  /**
   * Playable cards aren't outlined; only the cursor tells them apart (hand cursor on cards with an
   * action, plain arrow elsewhere). While choosing on the board, candidates get a yellow 1px outline and
   * picked ones an orange 2px one (BoardPick); a declared attack outlines attacker and target in red. A pile holding
   * a card with an action (it's used from the pile browser) gets the yellow outline, slowly pulsing, and a yellow count.
   */
  private applyHighlights() {
    const [attacker, target] = this.attackMarks;
    this.drawAttackArrow(attacker ? this.view.sprites.get(attacker) : undefined);
    for (const [k, sp] of this.view.sprites) {
      const pick = this.boardPick.highlight(k);
      sp.setHighlight(pick.look ?? (k === attacker ? "attacker" : k === target ? "attacked" : "none"));
      if (sp.input) sp.input.cursor = this.actions.has(k) || pick.clickable ? "pointer" : "default";
    }
    // Your Extra Deck / Graveyard pulses while a card in it has an action (banished cards are browsed with the GY).
    const inPile = (location: number) => [...this.actions.keys()].some((k) => k.startsWith(`${this.me}:${location}:`));
    this.view.markPile("extra", inPile(OcgLocation.EXTRA));
    this.view.markPile("grave", inPile(OcgLocation.GRAVE) || inPile(OcgLocation.REMOVED));
  }

  /** Sets up the UI for a prompt you have to answer (duelPrompts.ts). */
  private onPrompt(m: HumanPrompt, hint: bigint | null) {
    this.clearInteraction();
    showPrompt(this.prompts, m, hint);
    // Card actions and phase boxes (idle / battle prompts) only take effect once drawn.
    this.phaseColumn.draw();
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
    const sp = this.view.sprites.get(k);
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
