// The deck editor (world menu → DECK EDITOR), in the duel's theme and field template (a felt mat with outlined slots,
// or slot plates straight on the table). Left: your deck, the Main Deck in 4 rows (10 a row, squeezed
// together past 40 cards) and the Extra Deck under it. Right, where the duel's info panel sits: the card list (search
// by name or card text, sort, filters). Click a listed card to add a copy, a card in the deck to take one out. Clicking
// a listed card's art (an eye shows over it on hover) opens its details in an info panel over the list, with ADD and
// CLOSE; hovering a deck card (holding it on a touch screen) shows its details there while hovered. Decks are kept in custom
// slots (prefs.ts `customDecks`) that you can rename; the world menu offers them like the prebuilt decks once their
// Main Deck has 40 cards.
import Phaser from "phaser";
import { TYPE, type CardRecord } from "../duel/cardData.ts";
import {
  CardList, DECK_RULES, SORT_KEYS, addProblem, countKinds, filterCount, goesToExtra, sortDeck, toggleFilter, type FilterState, type SortKey,
} from "../duel/deckEditor.ts";
import { DECKS, type DeckName } from "../duel/decks.ts";
import type { Deck } from "../duel/DuelSession.ts";
import { loadEngine, type Engine } from "../duel/loadEngine.ts";
import { raceNames, attributeNames } from "../duel/text.ts";
import { CardInfo, spellTrapKind } from "../ui/duel/CardInfo.ts";
import { ART_ATLAS, CardSprite } from "../ui/duel/CardSprite.ts";
import { drawTable } from "../ui/duel/field.ts";
import { CARD, INFO, INSET } from "../ui/duel/layout.ts";
import { FONT_UI, INK_SOFT, fit, text } from "../ui/pixel.ts";
import { MAX_CUSTOM_DECKS, chosenDeck, customDeckKey, customDecks, deleteCustomDeck, saveCustomDeck, type CustomDeck } from "../ui/prefs.ts";
import { createTextInput, type TextInput } from "../ui/textInput.ts";
import { THEME, ui } from "../ui/theme.ts";
import { TOUCH } from "../ui/touch.ts";
import { LIST_BUTTON_H, makeListButton, makeListDropDown, type ListButton } from "../ui/widgets.ts";

/** The card list panel's left edge: it takes the info panel's place (and size) on the right. */
const SPLIT = 640 - INFO.w;
/** Top bar (a plate with the deck buttons) and the mat under it, left of the list panel. */
const BAR = { x: 4, y: 4, w: SPLIT - 8, h: LIST_BUTTON_H + 2 * INSET.plate };
const MAT = { x: 4, y: BAR.y + BAR.h + 4, w: SPLIT - 8, h: 360 - (BAR.y + BAR.h + 4) - 4 };
const FELT = { x: MAT.x + INSET.plate, y: MAT.y + INSET.plate, w: MAT.w - 2 * INSET.plate, h: MAT.h - 2 * INSET.plate };
/** Deck cards: 10 a row 1px apart (39 pitch), centred on the felt; Main Deck rows 2px apart. */
const PITCH = CARD.w + 1;
const GRID_W = 9 * PITCH + CARD.w;
const GRID_X = FELT.x + Math.floor((FELT.w - GRID_W) / 2);
const MAIN_LABEL_Y = FELT.y + 5;
const MAIN_Y = MAIN_LABEL_Y + 10;
const ROW_PITCH = CARD.h + 2;
const EXTRA_LABEL_Y = MAIN_Y + 4 * ROW_PITCH + 6;
const EXTRA_Y = EXTRA_LABEL_Y + 10;

/** List panel content (inside the board's rim, like the info panel). */
const PANEL = { x: SPLIT + INSET.board + 2, w: INFO.w - 2 * (INSET.board + 2) };
const SEARCH = { x: PANEL.x, y: INSET.board + 2, w: PANEL.w, h: 15 };
/** The search box's ALL / NAME toggle (inside the box, at its right end) and the clear X left of it. */
const SCOPE = { w: 26, x: SEARCH.x + SEARCH.w - 2 - 26, y: SEARCH.y + 2 };
const CLEAR_X = SCOPE.x - 12;
const TOOLS_Y = SEARCH.y + SEARCH.h + 4;
/** The list: paper with `rows` rows, a scrollbar right of it. */
const LIST = { x: PANEL.x, y: TOOLS_Y + LIST_BUTTON_H + 4, w: PANEL.w - 6, rowH: 34, rows: 8 };
const LIST_H = LIST.rows * LIST.rowH + 2 * INSET.paper;
const ROW_X = LIST.x + INSET.paper, ROW_W = LIST.w - 2 * INSET.paper;
const SCROLL = { x: LIST.x + LIST.w + 2, y: LIST.y, w: 4, h: LIST_H };
const STATUS_Y = LIST.y + LIST_H + 5;

/** Colour strip on a list row by frame (the card frames' main colours). */
const KIND_COLOR = { normal: 0xd8b04a, effect: 0xc8692c, ritual: 0x4f78c8, fusion: 0x8a54a8, spell: 0x2a9a7a, trap: 0xb04a8a };
const kindColor = (r: CardRecord) => r.type & TYPE.SPELL ? KIND_COLOR.spell : r.type & TYPE.TRAP ? KIND_COLOR.trap
  : r.type & TYPE.FUSION ? KIND_COLOR.fusion : r.type & TYPE.RITUAL ? KIND_COLOR.ritual : r.type & TYPE.EFFECT ? KIND_COLOR.effect : KIND_COLOR.normal;
/** Deck counts below the limits (the Main Deck under 40). */
const SHORT_COLOR = 0xff8a70;
/** A press held this long shows the card's details instead of adding/removing it (touch screens). */
const HOLD_MS = 350;
/** Pointer travel that turns a press on the list into a scroll. */
const DRAG_PX = 6;
const MAX_NAME = 16;
const NEW_DECK = "\u0000new";
const OVERLAY_DEPTH = 3000;
/** Filter buttons on a grid of this many equal columns (long labels take two cells); 0 = each as wide as its label. */
const FILTER_COLUMNS = 5;

/**
 * Eye shown over a hovered list row's art (2x, dark outline, semi-transparent): clicking the art opens the card.
 * w = white, k = pupil, h = glint.
 */
const EYE = ["...wwwww...", ".ww.....ww.", "w...kkk...w", "w..kkhkk..w", "w...kkk...w", ".ww.....ww.", "...wwwww..."];
const EYE_COLOR: Record<string, number> = { w: 0xffffff, k: 0x1a1a2a, h: 0xffffff };

export class DeckEditor extends Phaser.Scene {
  private engine!: Engine;
  private list!: CardList;
  /** The deck being edited; `saved` = it's in storage under its id (else it's a new, unsaved slot). */
  private deck: CustomDeck = { id: "", name: "", main: [], extra: [] };
  private saved = false;
  private dirty = false;

  private query = "";
  /** Search card text too (ALL), or names only (NAME). */
  private inText = true;
  private sort: SortKey = "type";
  private filters: FilterState = new Map();
  private results: CardRecord[] = [];
  private scrollRow = 0;
  private hoverRow = -1;
  /** The pointer is over the hovered row's art (the eye shows). */
  private hoverArt = false;

  private bar!: Phaser.GameObjects.Container;
  private deckLayer!: Phaser.GameObjects.Container;
  private tools!: Phaser.GameObjects.Container;
  private rows!: Phaser.GameObjects.Container;
  private scrollbar!: Phaser.GameObjects.Graphics;
  private searchText!: Phaser.GameObjects.BitmapText;
  private caret!: Phaser.GameObjects.BitmapText;
  private clearSearch!: Phaser.GameObjects.BitmapText;
  private statusText!: Phaser.GameObjects.BitmapText;
  private statusTimer: Phaser.Time.TimerEvent | null = null;
  private search: TextInput | null = null;
  /** Deck card details while hovered, over the list. */
  private preview: { root: Phaser.GameObjects.Container; info: CardInfo } | null = null;
  /** A listed card's details opened from its art, over the list (under the hover preview), with ADD / CLOSE. */
  private opened: { root: Phaser.GameObjects.Container; info: CardInfo; add: ListButton } | null = null;
  private hideTimer: Phaser.Time.TimerEvent | null = null;
  private overlay: Phaser.GameObjects.Container | null = null;
  /** The filters, shown in the list's place (null: the list shows). */
  private filterPanel: Phaser.GameObjects.Container | null = null;

  constructor() {
    super("DeckEditor");
  }

  async create() {
    this.engine = await loadEngine();
    this.list = new CardList(this.engine.cards.records.values());
    this.query = "";
    this.filters = new Map();
    this.scrollRow = 0;
    this.hoverRow = -1;
    this.hoverArt = false;
    this.overlay = null;
    this.filterPanel = null;
    this.drawStatic();
    this.bar = this.add.container(0, 0);
    this.deckLayer = this.add.container(0, 0);
    this.tools = this.add.container(0, 0);
    this.rows = this.add.container(0, 0);
    this.scrollbar = this.add.graphics();
    this.buildSearch();
    this.buildListInput();
    this.statusText = text(this, PANEL.x + PANEL.w / 2, STATUS_Y, "", { color: THEME.panel.inkSoft, originX: 0.5 });
    this.showHint();
    this.preview = this.makePanel(OVERLAY_DEPTH - 10);
    this.makeOpened();
    this.input.keyboard?.on("keydown-ESC", () => {
      if (this.overlay) return;
      if (this.opened?.root.visible) this.closeCard();
      else this.closeFilters();
    });

    // Start with the deck picked in the world menu if it's a custom one, else the first saved one, else a new one.
    const decks = customDecks();
    const picked = chosenDeck().key;
    this.openDeck(decks.find((d) => customDeckKey(d.id) === picked) ?? decks[0] ?? null);
    this.events.once("shutdown", () => {
      this.search?.destroy();
      this.search = null;
    });
  }

  // --- Static parts: table, mat, list board --------------------------------------------------------------------

  private drawStatic() {
    const parts = this.make.container({}, false);
    drawTable(this, parts, 0);
    const pr = INSET.plate;
    parts.add(this.add.nineslice(BAR.x, BAR.y, ui("menu-back"), undefined, BAR.w, BAR.h, pr, pr, pr, pr).setOrigin(0));
    // "mat" template: a framed felt mat under the deck; "open": the deck straight on the table (slot plates, drawDeck).
    if (THEME.template === "mat") {
      parts.add(this.add.nineslice(MAT.x, MAT.y, ui("menu-back"), undefined, MAT.w, MAT.h, pr, pr, pr, pr).setOrigin(0));
      parts.add(this.add.graphics().fillStyle(THEME.field.felt).fillRect(FELT.x, FELT.y, FELT.w, FELT.h));
    }
    parts.add(this.add.nineslice(SPLIT, 0, ui("info-frame"), undefined, INFO.w, 360, ...THEME.panel.infoSlice).setOrigin(0));
    const ps = THEME.panel.paperSlice;
    parts.add(this.add.nineslice(SEARCH.x, SEARCH.y, ui("panel-paper"), undefined, SEARCH.w, SEARCH.h, ps, ps, ps, ps).setOrigin(0));
    parts.add(this.add.nineslice(LIST.x, LIST.y, ui("panel-paper"), undefined, LIST.w, LIST_H, ps, ps, ps, ps).setOrigin(0));
    // Baked into one texture: none of it ever changes.
    const baked = this.add.renderTexture(0, 0, 640, 360).setOrigin(0);
    baked.draw(parts).render();
    parts.destroy();
  }

  /** An info panel board over the list for a card's details, hidden until needed; `bottom` leaves room for buttons. */
  private makePanel(depth: number, bottom = 360 - INSET.board - 2) {
    const r = INSET.board;
    const frame = this.add.nineslice(SPLIT, 0, ui("info-frame"), undefined, INFO.w, 360, ...THEME.panel.infoSlice).setOrigin(0);
    const info = new CardInfo(this, this.engine, { x: PANEL.x, w: PANEL.w, top: r + 2, bottom });
    const root = this.add.container(0, 0, [frame, info.container]).setDepth(depth).setVisible(false);
    return { root, info };
  }

  /** The panel a list card's art opens: details, then ADD (copies in the deck, or why not) and CLOSE at the bottom. */
  private makeOpened() {
    const by = 360 - INSET.board - 2 - LIST_BUTTON_H, bw = Math.floor((PANEL.w - 4) / 2);
    const panel = this.makePanel(OVERLAY_DEPTH - 20, by - 4);
    // Swallows clicks so the list under the panel doesn't react.
    panel.root.addAt(this.add.zone(SPLIT, 0, INFO.w, 360).setOrigin(0).setInteractive(), 0);
    const add = makeListButton(this, PANEL.x, by, bw, "ADD", () => {
      const r = this.engine.cards.records.get(this.opened!.info.code);
      if (r) this.addCard(r);
    });
    panel.root.add(add);
    panel.root.add(makeListButton(this, PANEL.x + bw + 4, by, PANEL.w - bw - 4, "CLOSE", () => this.closeCard()));
    this.opened = { ...panel, add };
  }

  /** Opens a listed card's details over the list. */
  private openCard(code: number) {
    if (!this.opened) return;
    this.hidePreview(true);
    this.search?.setVisible(false);
    this.opened.info.show(code);
    this.opened.root.setVisible(true);
    this.refreshOpened();
  }

  private closeCard() {
    if (!this.opened?.root.visible) return;
    this.opened.root.setVisible(false);
    this.opened.info.clear();
    if (!this.overlay) this.search?.setVisible(true);
  }

  /** The opened card's ADD button: "ADD (2/3)", or why it can't be added (faded). */
  private refreshOpened() {
    const o = this.opened;
    const r = o?.root.visible ? this.engine.cards.records.get(o.info.code) : undefined;
    if (!o || !r) return;
    const problem = addProblem(this.deck, r, this.engine.cards);
    const copies = [...this.deck.main, ...this.deck.extra].filter((c) => c === r.code).length;
    o.add.setLabel(problem ?? `ADD (${copies}/${DECK_RULES.copies})`);
    o.add.setEnabled(!problem);
  }

  /** Shows a deck card's details over the list while it's hovered; a card opened from the list closes (back to the list after). */
  private showPreview(code: number) {
    if (!this.preview || this.overlay) return;
    this.closeCard();
    this.hideTimer?.remove();
    this.hideTimer = null;
    if (this.preview.info.code !== code) this.preview.info.show(code);
    this.preview.root.setVisible(true);
  }

  /** Hides the hover preview, slightly delayed so moving from card to card doesn't flicker (now: at once). */
  private hidePreview(now = false) {
    if (!this.preview) return;
    const hide = () => this.preview?.root.setVisible(false);
    this.hideTimer?.remove();
    this.hideTimer = null;
    if (now) hide();
    else this.hideTimer = this.time.delayedCall(80, hide);
  }

  // --- The deck ------------------------------------------------------------------------------------------------

  /** Opens a saved deck, or a new empty slot (null). */
  private openDeck(deck: CustomDeck | null) {
    if (deck) {
      // Cards that left the pool (or tokens) are dropped.
      const known = (c: number) => { const r = this.engine.cards.records.get(c); return !!r && !(r.type & TYPE.TOKEN); };
      this.deck = { ...deck, main: deck.main.filter(known), extra: (deck.extra ?? []).filter(known) };
      this.saved = true;
    } else {
      const names = new Set(customDecks().map((d) => d.name));
      let n = 1;
      while (names.has(`DECK ${n}`)) n++;
      this.deck = { id: Date.now().toString(36), name: `DECK ${n}`, main: [], extra: [] };
      this.saved = false;
    }
    this.dirty = false;
    this.redraw();
  }

  private redraw() {
    this.drawBar();
    this.drawDeck();
    this.refreshList(false);
  }

  /** Top bar: deck slot drop-down, RENAME, SAVE, DELETE, LOAD (a prebuilt deck or empty), EXIT. */
  private drawBar() {
    this.bar.removeAll(true);
    const y = BAR.y + INSET.plate;
    let x = BAR.x + INSET.plate;
    const gap = 3;
    const slots = customDecks().map((d) => ({ value: d.id, label: d.id === this.deck.id ? this.deck.name : d.name }));
    if (!this.saved) slots.push({ value: this.deck.id, label: this.deck.name });
    if (slots.length < MAX_CUSTOM_DECKS) slots.push({ value: NEW_DECK, label: "+ NEW DECK" });
    const name = `${this.deck.name}${this.dirty ? " *" : ""}`;
    this.bar.add(makeListDropDown(this, x, y, 112, slots, this.deck.id, (id) => id !== this.deck.id && this.guard(() => {
      if (id === NEW_DECK) this.openDeck(null);
      else this.openDeck(customDecks().find((d) => d.id === id) ?? null);
    }, () => this.drawBar()), { label: name }));
    x += 112 + gap;
    const button = (w: number, label: string, onClick: () => void) => {
      this.bar.add(makeListButton(this, x, y, w, label, onClick));
      x += w + gap;
    };
    button(40, "RENAME", () => this.rename());
    button(32, "SAVE", () => this.save());
    button(40, "DELETE", () => this.confirmDelete());
    const prebuilt = [
      { value: "" as DeckName | "", label: "EMPTY DECK" },
      ...(Object.keys(DECKS) as DeckName[]).map((n) => ({ value: n as DeckName | "", label: DECKS[n].label })),
    ];
    this.bar.add(makeListDropDown(this, x, y, 48, prebuilt, null, (n) => this.loadPrebuilt(n), { label: "LOAD" }));
    this.bar.add(makeListButton(this, BAR.x + BAR.w - INSET.plate - 32, y, 32, "EXIT", () => this.guard(() => this.scene.start("Overworld"))));
  }

  /** Replaces the deck's cards with a prebuilt deck's (or none). */
  private loadPrebuilt(name: DeckName | "") {
    const src: Deck = name ? DECKS[name].deck : { main: [], extra: [] };
    this.deck = { ...this.deck, main: [...src.main], extra: [...(src.extra ?? [])] };
    this.changed();
    if (name) this.status(`LOADED ${DECKS[name].label.toUpperCase()}`);
  }

  private changed() {
    this.dirty = true;
    this.drawBar();
    this.drawDeck();
    this.refreshList(false);
    this.refreshOpened();
  }

  /** The Main Deck (4 rows) and the Extra Deck (1 row), with counts; empty slots outlined. */
  private drawDeck() {
    const L = this.deckLayer;
    L.removeAll(true);
    const cards = this.engine.cards;
    const main = sortDeck(this.deck.main, cards), extra = sortDeck(this.deck.extra, cards);
    const label = THEME.field.label;
    const k = countKinds(main, cards);
    L.add(text(this, GRID_X, MAIN_LABEL_Y, "MAIN DECK", { color: label }));
    L.add(text(this, GRID_X + 40, MAIN_LABEL_Y, String(main.length), { color: main.length < DECK_RULES.mainMin ? SHORT_COLOR : THEME.plate.ink }));
    L.add(text(this, GRID_X + GRID_W, MAIN_LABEL_Y, `MONSTERS ${k.monsters}   SPELLS ${k.spells}   TRAPS ${k.traps}`, { color: label, originX: 1 }));
    L.add(text(this, GRID_X, EXTRA_LABEL_Y, "EXTRA DECK", { color: label }));
    L.add(text(this, GRID_X + 44, EXTRA_LABEL_Y, String(extra.length), { color: THEME.plate.ink }));

    // The empty slots of the first 40 Main / 10 Extra, like the duel's zones: outlined on the mat, or plates on the
    // table ("zone-monster" for the Main Deck, "menu-back" for the Extra Deck, as the duel's monster / other zones).
    const empty: [number, number, boolean][] = [];
    for (let i = main.length; i < 40; i++) empty.push([GRID_X + (i % 10) * PITCH, MAIN_Y + Math.floor(i / 10) * ROW_PITCH, true]);
    for (let i = extra.length; i < 10; i++) empty.push([GRID_X + i * PITCH, EXTRA_Y, false]);
    if (THEME.template === "mat") {
      const g = this.add.graphics().lineStyle(1, THEME.field.line);
      for (const [x, y] of empty) g.strokeRect(x + 0.5, y + 0.5, CARD.w - 1, CARD.h - 1);
      L.add(g);
    } else {
      const rim = THEME.plate.slice;
      for (const [x, y, inMain] of empty) {
        L.add(this.add.nineslice(x, y, ui(inMain ? "zone-monster" : "menu-back"), undefined, CARD.w, CARD.h, rim, rim, rim, rim).setOrigin(0));
      }
    }

    // Past 10 a row (Main Deck over 40, Extra over 10) the cards squeeze together, each overlapping the last.
    const perRow = Math.max(10, Math.ceil(main.length / 4));
    const pitchOf = (n: number) => (n > 10 ? (GRID_W - CARD.w) / (n - 1) : PITCH);
    main.forEach((code, i) => {
      const col = i % perRow, row = Math.floor(i / perRow);
      this.deckCard(code, GRID_X + Math.round(col * pitchOf(perRow)), MAIN_Y + row * ROW_PITCH, "main");
    });
    extra.forEach((code, i) => this.deckCard(code, GRID_X + Math.round(i * pitchOf(extra.length)), EXTRA_Y, "extra"));
  }

  /** One card of the deck (top-left at x, y): click / tap takes a copy out, hover / hold shows it over the list. */
  private deckCard(code: number, x: number, y: number, part: "main" | "extra") {
    const sp = new CardSprite(this, x + CARD.w / 2, y + CARD.h / 2).show(code, this.engine.cards.records.get(code));
    this.deckLayer.add(sp);
    sp.setInteractive({ useHandCursor: true });
    this.pressable(sp, () => code, () => {
      const list = this.deck[part];
      list.splice(list.indexOf(code), 1);
      this.changed();
      this.hidePreview(true);
    });
  }

  /**
   * Hover (mouse) shows the card over the list; on a touch screen a held press does, until release. A quick click /
   * tap calls `onTap` (not after a hold).
   */
  private pressable(obj: Phaser.GameObjects.GameObject, code: () => number, onTap: () => void) {
    let held = false, timer: Phaser.Time.TimerEvent | null = null;
    obj.on("pointerover", (p: Phaser.Input.Pointer) => { if (!p.wasTouch) this.showPreview(code()); });
    obj.on("pointerout", () => { timer?.remove(); this.hidePreview(); });
    obj.on("pointerdown", (p: Phaser.Input.Pointer) => {
      held = false;
      if (p.wasTouch) timer = this.time.delayedCall(HOLD_MS, () => { held = true; this.showPreview(code()); });
    });
    obj.on("pointerup", (p: Phaser.Input.Pointer) => {
      timer?.remove();
      if (p.wasTouch) this.hidePreview(true);
      if (!held) onTap();
      held = false;
    });
  }

  // --- The card list -------------------------------------------------------------------------------------------

  /** The search box: paper field with the typed text and a caret; an HTML input over it collects the typing. */
  private buildSearch() {
    const tx = SEARCH.x + 5, ty = SEARCH.y + 5;
    this.searchText = text(this, tx, ty, "", { color: THEME.panel.paperInk });
    this.caret = text(this, tx, ty, "_", { color: THEME.panel.paperInk });
    this.time.addEvent({ delay: 450, loop: true, callback: () => this.caret.setVisible(!this.caret.visible) });
    // Right end of the field (outside the HTML input, which covers the rest): X clears the search, then the toggle
    // between searching names and card text (ALL) or names only (NAME).
    this.clearSearch = text(this, CLEAR_X + 4, ty, "X", { color: THEME.panel.paperInk }).setVisible(false);
    this.add.zone(CLEAR_X, SEARCH.y, 12, SEARCH.h).setOrigin(0).setInteractive({ useHandCursor: true })
      .on("pointerup", () => { this.search?.setValue(""); this.setQuery(""); });
    const scope = makeListButton(this, SCOPE.x, SCOPE.y, SCOPE.w, this.inText ? "ALL" : "NAME", () => {
      this.inText = !this.inText;
      scope.setLabel(this.inText ? "ALL" : "NAME");
      this.setQuery(this.query);
    });
    this.search = createTextInput(this, { x: SEARCH.x, y: SEARCH.y, w: CLEAR_X - SEARCH.x, h: SEARCH.h }, {
      maxLength: 40,
      onChange: (v) => this.setQuery(v),
    });
    // On a desktop you can type at once; phones open their keyboard only when the box is tapped.
    if (!TOUCH) this.search.focus();
    this.setQuery("");
  }

  private setQuery(q: string) {
    this.query = q;
    const shown = q.toUpperCase();
    const room = CLEAR_X - SEARCH.x - 10;
    // The placeholder starts after the caret, so the caret doesn't blink over its first letter.
    const tx = SEARCH.x + 5;
    if (!q) this.searchText.setText(this.inText ? "SEARCH NAME OR CARD TEXT" : "SEARCH CARD NAMES").setTint(THEME.panel.inkSoft).setX(tx + this.caret.width + 1);
    else this.searchText.setText(fit(this, FONT_UI, shown, room)).setTint(THEME.panel.paperInk).setX(tx);
    this.caret.setX(q ? tx + this.searchText.width : tx);
    this.clearSearch.setVisible(!!q);
    this.refreshList(true);
  }

  /**
   * Sort drop-down and FILTERS button, equally wide, then the number of matches on a small plate under the
   * search box's ALL / NAME toggle (same x and width).
   */
  private drawTools() {
    this.tools.removeAll(true);
    const gap = 4, sortW = Math.floor((SCOPE.x - gap - PANEL.x - gap) / 2), filterW = SCOPE.x - gap - (PANEL.x + sortW + gap);
    this.tools.add(makeListDropDown(this, PANEL.x, TOOLS_Y, sortW, SORT_KEYS.map((s) => ({ value: s.key, label: s.label })), this.sort,
      (key) => { this.sort = key; this.refreshList(true); }, { prefix: "SORT: " }));
    const n = filterCount(this.filters);
    // FILTERS opens / closes the filters (lit while they're open).
    const filters = makeListButton(this, PANEL.x + sortW + gap, TOOLS_Y, filterW, n ? `FILTERS ${n}` : "FILTERS",
      () => (this.filterPanel ? this.closeFilters() : this.openFilters()));
    if (this.filterPanel) filters.setHighlighted(true);
    this.tools.add(filters);
    const pr = THEME.plate.slice;
    this.tools.add(this.add.nineslice(SCOPE.x, TOOLS_Y, ui("menu-back"), undefined, SCOPE.w, LIST_BUTTON_H, pr, pr, pr, pr).setOrigin(0));
    this.tools.add(text(this, SCOPE.x + SCOPE.w / 2, TOOLS_Y + 3, String(this.results.length), { color: THEME.plate.ink, originX: 0.5 }));
  }

  /** Runs the search again; `toTop` scrolls back to the first match (a new search), else keeps the place. */
  private refreshList(toTop: boolean) {
    if (!this.list) return;
    this.results = this.list.find(this.query, this.filters, this.sort, this.inText);
    if (toTop) this.scrollRow = 0;
    this.drawTools();
    this.scrollTo(this.scrollRow);
  }

  private maxScroll() {
    return Math.max(0, this.results.length - LIST.rows);
  }

  private scrollTo(row: number) {
    this.scrollRow = Phaser.Math.Clamp(Math.round(row), 0, this.maxScroll());
    this.drawRows();
    this.drawScrollbar();
  }

  /** The visible rows: frame-colour strip, 32x32 art, name, Level / Attribute / Type (or Spell/Trap kind), ATK / DEF, copies in the deck. */
  private drawRows() {
    this.rows.removeAll(true);
    const inDeck = new Map<number, number>();
    for (const c of [...this.deck.main, ...this.deck.extra]) inDeck.set(c, (inDeck.get(c) ?? 0) + 1);
    const ink = THEME.panel.paperInk, soft = THEME.panel.inkSoft;
    const g = this.add.graphics();
    this.rows.add(g);
    for (let i = 0; i < LIST.rows; i++) {
      const r = this.results[this.scrollRow + i];
      if (!r) break;
      const y = LIST.y + INSET.paper + i * LIST.rowH;
      if (i === this.hoverRow) g.fillStyle(ink, 0.12).fillRect(ROW_X, y, ROW_W, LIST.rowH);
      if (i > 0) g.fillStyle(ink, 0.18).fillRect(ROW_X, y, ROW_W, 1);
      g.fillStyle(kindColor(r)).fillRect(ROW_X + 1, y + 2, 2, LIST.rowH - 3);
      const artX = ROW_X + 5, artY = y + 1;
      if (this.textures.get(ART_ATLAS).has(String(r.code))) this.rows.add(this.add.image(artX, artY, ART_ATLAS, String(r.code)).setOrigin(0));
      else g.fillStyle(INK_SOFT).fillRect(artX, artY, 32, 32);
      if (i === this.hoverRow && this.hoverArt) this.rows.add(eyeIcon(this, artX, artY));
      const tx = artX + 36, right = ROW_X + ROW_W - 2;
      const copies = inDeck.get(r.code) ?? 0;
      const countW = copies ? 14 : 0;
      this.rows.add(text(this, tx, y + 4, fit(this, FONT_UI, r.name.toUpperCase(), right - tx - countW), { color: ink }));
      if (copies) this.rows.add(text(this, right, y + 4, `x${copies}`, { color: copies >= DECK_RULES.copies ? THEME.panel.error : ink, originX: 1 }));
      const [line2, line3] = describe(r);
      this.rows.add(text(this, tx, y + 14, fit(this, FONT_UI, line2, right - tx), { color: soft }));
      if (line3) this.rows.add(text(this, tx, y + 24, line3, { color: soft }));
    }
    if (!this.results.length) this.rows.add(text(this, LIST.x + LIST.w / 2, LIST.y + 20, "NO CARDS FOUND", { color: soft, originX: 0.5 }));
  }

  private drawScrollbar() {
    const g = this.scrollbar.clear();
    g.fillStyle(THEME.panel.inkSoft, 0.35).fillRect(SCROLL.x, SCROLL.y, SCROLL.w, SCROLL.h);
    const total = this.results.length;
    if (total <= LIST.rows) return;
    const thumbH = Math.max(12, Math.round(SCROLL.h * LIST.rows / total));
    const thumbY = SCROLL.y + Math.round((SCROLL.h - thumbH) * this.scrollRow / this.maxScroll());
    g.fillStyle(THEME.panel.ink).fillRect(SCROLL.x, thumbY, SCROLL.w, thumbH);
  }

  /**
   * One zone over the list handles it all: hover highlights a row (and shows the eye over its art); click / tap adds
   * a copy, or opens the card when on its art; dragging (touch) scrolls. The mouse wheel scrolls; so does the scrollbar.
   */
  private buildListInput() {
    const zone = this.add.zone(LIST.x, LIST.y, LIST.w, LIST_H).setOrigin(0).setInteractive({ useHandCursor: true });
    const rowAt = (p: Phaser.Input.Pointer) => {
      const i = Math.floor((p.y - LIST.y - INSET.paper) / LIST.rowH);
      return i >= 0 && i < LIST.rows && this.results[this.scrollRow + i] ? i : -1;
    };
    /** Over the 32x32 art of row `i`. */
    const onArt = (p: Phaser.Input.Pointer, i: number) => {
      const artX = ROW_X + 5, artY = LIST.y + INSET.paper + i * LIST.rowH + 1;
      return i >= 0 && p.x >= artX && p.x < artX + 32 && p.y >= artY && p.y < artY + 32;
    };
    let down: { y: number; scroll: number; row: number } | null = null;
    let dragging = false;
    const hover = (i: number, art: boolean) => {
      if (i === this.hoverRow && art === this.hoverArt) return;
      this.hoverRow = i;
      this.hoverArt = art;
      this.drawRows();
    };
    zone.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (down && p.isDown) {
        if (!dragging && Math.abs(p.y - down.y) > DRAG_PX) {
          dragging = true;
          hover(-1, false);
        }
        if (dragging) this.scrollTo(down.scroll - (p.y - down.y) / LIST.rowH);
        return;
      }
      if (p.wasTouch) return;
      const i = rowAt(p);
      hover(i, onArt(p, i));
    });
    zone.on("pointerout", () => {
      hover(-1, false);
      down = null;
    });
    zone.on("pointerdown", (p: Phaser.Input.Pointer) => {
      down = { y: p.y, scroll: this.scrollRow, row: rowAt(p) };
      dragging = false;
    });
    zone.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (p.wasTouch) hover(-1, false);
      const i = rowAt(p);
      if (down && !dragging && i >= 0 && i === down.row) {
        const r = this.results[this.scrollRow + i];
        if (onArt(p, i)) {
          hover(-1, false);
          this.openCard(r.code);
        } else this.addCard(r);
      }
      down = null;
    });
    // Wheel over the list panel: one row per 50 units (a mouse notch is ~100; trackpads send many small steps).
    let wheel = 0;
    this.input.on("wheel", (p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      if (this.overlay || this.opened?.root.visible || this.filterPanel || p.x < SPLIT) return;
      wheel += dy;
      const steps = Math.trunc(wheel / 50);
      if (!steps) return;
      wheel -= steps * 50;
      this.scrollTo(this.scrollRow + steps);
      if (!p.wasTouch) {
        const i = rowAt(p);
        this.hoverRow = -2; // force a redraw of the highlight
        hover(i, onArt(p, i));
      }
    });
    // Scrollbar: press or drag anywhere on it to jump there.
    const bar = this.add.zone(SCROLL.x - 1, SCROLL.y, SCROLL.w + 3, SCROLL.h).setOrigin(0).setInteractive({ useHandCursor: true });
    const jump = (p: Phaser.Input.Pointer) => this.scrollTo(((p.y - SCROLL.y) / SCROLL.h) * (this.maxScroll() + 1) - 0.5);
    bar.on("pointerdown", jump);
    bar.on("pointermove", (p: Phaser.Input.Pointer) => { if (p.isDown) jump(p); });
  }

  /** Adds a copy of `r` (to the Extra Deck if it's a Fusion), unless a rule says no. */
  private addCard(r: CardRecord) {
    const problem = addProblem(this.deck, r, this.engine.cards);
    if (problem) return this.status(problem, true);
    (goesToExtra(r) ? this.deck.extra : this.deck.main).push(r.code);
    this.changed();
  }

  // --- Status line ---------------------------------------------------------------------------------------------

  private showHint() {
    this.statusText.setText(TOUCH ? "TAP: ADD / REMOVE   TAP THE ART: CARD INFO" : "CLICK: ADD / REMOVE   CLICK THE ART: CARD INFO")
      .setTint(THEME.panel.inkSoft);
    this.statusText.setX(Math.round(PANEL.x + PANEL.w / 2 - this.statusText.width / 2));
  }

  /** A message under the list for a moment (red for refusals), then the hint again. */
  private status(msg: string, error = false) {
    this.statusText.setText(msg).setTint(error ? THEME.panel.error : THEME.panel.ink);
    this.statusText.setX(Math.round(PANEL.x + PANEL.w / 2 - this.statusText.width / 2));
    this.statusTimer?.remove();
    this.statusTimer = this.time.delayedCall(1800, () => this.showHint());
  }

  // --- Saving, renaming, deleting ------------------------------------------------------------------------------

  private save() {
    saveCustomDeck({ ...this.deck, main: [...this.deck.main], extra: [...this.deck.extra] });
    this.saved = true;
    this.dirty = false;
    this.drawBar();
    const short = DECK_RULES.mainMin - this.deck.main.length;
    this.status(short > 0 ? `SAVED - ${short} MORE CARDS TO DUEL WITH IT` : "SAVED - PICK IT IN THE MENU");
  }

  /** Runs `then`, first asking what to do with unsaved changes (SAVE / DISCARD / CANCEL; `onCancel` after CANCEL). */
  private guard(then: () => void, onCancel?: () => void) {
    if (!this.dirty) return then();
    this.dialog(`SAVE THE CHANGES TO ${this.deck.name}?`, [
      { label: "SAVE", onClick: () => { this.save(); then(); } },
      { label: "DISCARD", onClick: then },
      { label: "CANCEL", onClick: () => onCancel?.() },
    ]);
  }

  private confirmDelete() {
    this.dialog(`DELETE ${this.deck.name}?`, [
      {
        label: "DELETE", onClick: () => {
          if (this.saved) deleteCustomDeck(this.deck.id);
          this.openDeck(customDecks()[0] ?? null);
        },
      },
      { label: "CANCEL", onClick: () => {} },
    ]);
  }

  /** Opens an overlay: a shade over everything (swallowing clicks) and a board centred on the screen. */
  private openOverlay(w: number, h: number): { root: Phaser.GameObjects.Container; left: number; top: number } {
    this.hidePreview(true);
    this.search?.setVisible(false);
    const left = Math.round((640 - w) / 2), top = Math.round((360 - h) / 2);
    const shade = this.add.rectangle(0, 0, 640, 360, 0x000000, THEME.shadeAlpha).setOrigin(0).setInteractive();
    const s = THEME.panel.slice;
    const board = this.add.nineslice(left, top, ui("panel-frame"), undefined, w, h, s, s, s, s).setOrigin(0);
    const root = this.add.container(0, 0, [shade, board]).setDepth(OVERLAY_DEPTH);
    this.overlay = root;
    return { root, left, top };
  }

  private closeOverlay() {
    this.overlay?.destroy();
    this.overlay = null;
    if (!this.opened?.root.visible) this.search?.setVisible(true);
  }

  /** A message with buttons in a row; any button closes it. */
  private dialog(message: string, buttons: { label: string; onClick: () => void }[]) {
    const w = 240, bw = 56, gap = 4;
    const msg = text(this, 0, 0, message, { color: THEME.panel.ink, maxWidth: w - 2 * (INSET.board + 6) }).setCenterAlign();
    const h = INSET.board + 8 + msg.height + 10 + LIST_BUTTON_H + 8 + INSET.board;
    const { root, left, top } = this.openOverlay(w, h);
    msg.setPosition(Math.round(left + (w - msg.width) / 2), top + INSET.board + 8);
    root.add(msg);
    const rowW = buttons.length * bw + (buttons.length - 1) * gap;
    buttons.forEach((b, i) => root.add(makeListButton(this, left + Math.round((w - rowW) / 2) + i * (bw + gap), msg.y + msg.height + 10, bw, b.label,
      () => { this.closeOverlay(); b.onClick(); })));
  }

  /** Name field (typed, max 16 characters) with OK / CANCEL; Enter = OK, Esc = CANCEL. */
  private rename() {
    const w = 200, fieldH = 15, bw = 56;
    const h = INSET.board + 6 + 5 + 6 + fieldH + 8 + LIST_BUTTON_H + 6 + INSET.board;
    const { root, left, top } = this.openOverlay(w, h);
    const innerX = left + INSET.board + 6, innerW = w - 2 * (INSET.board + 6);
    root.add(text(this, left + w / 2, top + INSET.board + 6, "DECK NAME", { color: THEME.panel.ink, originX: 0.5 }));
    const fieldY = top + INSET.board + 6 + 5 + 6;
    const ps = THEME.panel.paperSlice;
    root.add(this.add.nineslice(innerX, fieldY, ui("panel-paper"), undefined, innerW, fieldH, ps, ps, ps, ps).setOrigin(0));
    const typed = text(this, innerX + 5, fieldY + 5, "", { color: THEME.panel.paperInk });
    const caret = text(this, innerX + 5, fieldY + 5, "_", { color: THEME.panel.paperInk });
    root.add([typed, caret]);
    const blink = this.time.addEvent({ delay: 450, loop: true, callback: () => caret.setVisible(!caret.visible) });
    let value = this.deck.name;
    const show = () => { typed.setText(value.toUpperCase()); caret.setX(typed.x + typed.width + (value ? 1 : 0)); };
    show();
    const done = (ok: boolean) => {
      input.destroy();
      blink.remove();
      this.closeOverlay();
      const name = value.trim().toUpperCase();
      if (!ok || !name || name === this.deck.name) return;
      this.deck.name = name;
      this.dirty = true;
      this.drawBar();
    };
    const input = createTextInput(this, { x: innerX, y: fieldY, w: innerW, h: fieldH }, {
      maxLength: MAX_NAME,
      onChange: (v) => { value = v; show(); },
      onKey: (e) => {
        if (e.key === "Enter") { done(true); return true; }
        if (e.key === "Escape") { done(false); return true; }
        return false;
      },
    });
    input.setValue(value);
    input.focus();
    const by = fieldY + fieldH + 8;
    root.add(makeListButton(this, left + w / 2 - bw - 2, by, bw, "OK", () => done(true)));
    root.add(makeListButton(this, left + w / 2 + 2, by, bw, "CANCEL", () => done(false)));
  }

  // --- Filters -------------------------------------------------------------------------------------------------

  /**
   * The filters, in the list's place (search, SORT and the match count stay, and update live): per group its name, then
   * its options as toggle buttons, wrapping (on a grid: FILTER_COLUMNS). Nothing picked in a group = any; one-value groups
   * (`single`: CARD, ATTRIBUTE, LEVEL, TYPE, SPELL/TRAP) keep one pick, MONSTER picks are alternatives (EFFECT or FLIP);
   * groups combine (FIRE and LEVEL 4). RESET clears them all; DONE, the FILTERS button or Esc goes back to the list.
   */
  private openFilters() {
    this.closeFilters();
    this.hoverRow = -1;
    this.hoverArt = false;
    const root = this.add.container(0, 0).setDepth(10);
    this.filterPanel = root;
    // Covers the list and its scrollbar, and swallows their clicks.
    root.add(this.add.zone(PANEL.x, LIST.y, PANEL.w, LIST_H).setOrigin(0).setInteractive());
    const ps = THEME.panel.paperSlice;
    root.add(this.add.nineslice(PANEL.x, LIST.y, ui("panel-paper"), undefined, PANEL.w, LIST_H, ps, ps, ps, ps).setOrigin(0));
    const pad = INSET.paper + 2, left = PANEL.x + pad, right = PANEL.x + PANEL.w - pad;
    const gap = 2, pitch = LIST_BUTTON_H + 2;
    const cell = Math.floor((right - left - (FILTER_COLUMNS - 1) * gap) / Math.max(1, FILTER_COLUMNS));
    let y = LIST.y + pad;
    const redraw: (() => void)[] = [];
    for (const g of this.list.groups) {
      root.add(text(this, left, y, g.label, { color: THEME.panel.inkSoft }));
      y += 7;
      // Grid: each button one cell, or two for a label too long for one; a button goes in the first line of its group
      // with room (so a short one can fill a gap a long one left). Else buttons as wide as their labels, in order.
      const used: number[] = [];
      let x = left, lines = 1;
      // A group whose labels all fit half a cell (LEVEL) gets half cells, twice as many a line, on the same columns.
      const half = Math.floor((cell - gap) / 2);
      const halves = g.options.every((o) => this.textWidth(o.label) + 4 <= half);
      const unit = halves ? half : cell, columns = halves ? 2 * FILTER_COLUMNS : FILTER_COLUMNS;
      for (const o of g.options) {
        let bx: number, by: number, w: number;
        if (FILTER_COLUMNS) {
          const span = this.textWidth(o.label) + 4 > unit ? 2 : 1;
          let line = used.findIndex((n) => n + span <= columns);
          if (line < 0) line = used.push(0) - 1;
          bx = left + used[line] * (unit + gap);
          by = y + line * pitch;
          w = span * unit + (span - 1) * gap;
          used[line] += span;
          lines = used.length;
        } else {
          w = this.textWidth(o.label) + 8;
          if (x > left && x + w > right) { x = left; lines++; }
          bx = x;
          by = y + (lines - 1) * pitch;
          x += w + gap;
        }
        const picked = () => this.filters.get(g.label)?.has(o.label) ?? false;
        const button = makeListButton(this, bx, by, w, o.label, () => {
          toggleFilter(this.filters, g, o.label);
          for (const r of redraw) r();
          this.refreshList(true);
        });
        button.setHighlighted(picked());
        redraw.push(() => button.setHighlighted(picked()));
        root.add(button);
      }
      y += lines * pitch + 3;
    }
    const by = LIST.y + LIST_H - pad - LIST_BUTTON_H, bw = Math.floor((right - left - 4) / 2);
    root.add(makeListButton(this, left, by, bw, "RESET", () => {
      this.filters = new Map();
      for (const r of redraw) r();
      this.refreshList(true);
    }));
    root.add(makeListButton(this, right - bw, by, bw, "DONE", () => this.closeFilters()));
    this.drawTools();
  }

  private closeFilters() {
    if (!this.filterPanel) return;
    this.filterPanel.destroy();
    this.filterPanel = null;
    this.drawTools();
    this.drawRows();
  }

  private textWidth(s: string): number {
    const t = text(this, 0, 0, s);
    const w = t.width;
    t.destroy();
    return w;
  }
}

/** A list row's second and third lines: "LV4 DARK SPELLCASTER" / "ATK 2500  DEF 2100", or "SPELL - QUICK-PLAY". */
function describe(r: CardRecord): [string, string] {
  if (r.type & TYPE.MONSTER) {
    const stat = (v: number) => (v < 0 ? "?" : String(v));
    return [`LV${r.level & 0xff} ${attributeNames(r.attribute)} ${raceNames(BigInt(r.race))}`, `ATK ${stat(r.atk)}  DEF ${stat(r.def)}`];
  }
  return [`${r.type & TYPE.SPELL ? "SPELL" : "TRAP"} - ${spellTrapKind(r.type)}`, ""];
}

/** The eye over a hovered row's art (top-left of the art at x, y): the art dimmed a little, the eye at 2x in the middle. */
function eyeIcon(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.3).fillRect(x, y, 32, 32);
  const ex = x + Math.floor((32 - EYE[0].length * 2) / 2), ey = y + Math.floor((32 - EYE.length * 2) / 2);
  // Screen pixels of the 2x eye, then a 1px dark outline around them (each pixel drawn once: alpha mustn't stack).
  const lit = new Map<string, number>();
  EYE.forEach((row, iy) => [...row].forEach((ch, ix) => {
    if (ch === ".") return;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) lit.set(`${ix * 2 + dx},${iy * 2 + dy}`, EYE_COLOR[ch]);
  }));
  const outline = new Set<string>();
  for (const key of lit.keys()) {
    const [px, py] = key.split(",").map(Number);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const k = `${px + dx},${py + dy}`;
      if (!lit.has(k)) outline.add(k);
    }
  }
  for (const k of outline) {
    const [px, py] = k.split(",").map(Number);
    g.fillStyle(0x000000, 0.6).fillRect(ex + px, ey + py, 1, 1);
  }
  for (const [k, color] of lit) {
    const [px, py] = k.split(",").map(Number);
    g.fillStyle(color, 0.85).fillRect(ex + px, ey + py, 1, 1);
  }
  return g;
}
