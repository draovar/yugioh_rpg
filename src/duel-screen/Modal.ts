// Modal overlays used by duel prompts: button dialogs, a (paged) card picker, the coin call, card ordering and the
// card-name search.
// They cover the field but not the info panel, so hovering a card in a modal still shows it.
import Phaser from "phaser";
import type { CardDb } from "../duel/engine/cardData.ts";
import { CardSearch, type NamedCard } from "../duel/decks/cardSearch.ts";
import { FONT_CARD, FONT_UI, INK, WHITE, fit, measure, text } from "../ui/pixel.ts";
import { LIST_BUTTON_H, makeListButton, type ListButton } from "../ui/widgets.ts";
import { CardSprite } from "./CardSprite.ts";
import { CARD, INFO, INSET } from "./layout.ts";
import { THEME, ui } from "../ui/theme.ts";
import { COIN_SHEET } from "./DuelAnimator.ts";
import { createTextInput } from "../ui/textInput.ts";

/** Card-name search: rows of matches shown at once, and the text field's height. */
const SEARCH_ROWS = 8;
const FIELD_H = 15;

const DEPTH = 1000;
/** The info panel is drawn above dialogs' shade (they never overlap it). */
export const INFO_DEPTH = DEPTH + 1;
/** The board sprite (the theme's "panel-frame"), top-left at (x, y). */
function board(s: Phaser.Scene, x: number, y: number, w: number, h: number) {
  const slice = THEME.panel.slice;
  return s.add.nineslice(x, y, ui("panel-frame"), undefined, w, h, slice, slice, slice, slice).setOrigin(0);
}
const LEFT = INFO.x + INFO.w;
const WIDTH = 640 - LEFT;
const MID_X = LEFT + Math.floor(WIDTH / 2);
/** Every dialog and picker is one of two widths: standard, or wide (the field minus a margin). */
const STANDARD_W = 240;
const WIDE_W = WIDTH - 8;
/** Space between the dialog's rim and its card (and between the card and the text column). */
const CARD_GAP = 4;
/** Between dialog buttons (both directions). */
const BTN_GAP = 4;
/** How far a selected card is raised in a picker, and a hovered one in a single-pick picker. */
const SELECTED_LIFT = 5;
const HOVER_LIFT = 2;
/** Picker card pitch: 9 cards (38px, 5px apart) fill the widest board that fits the field. */
const PICK_PITCH_X = CARD.w + 5;

export interface PickerCard {
  code: number;
  /** Small caption under the card (e.g. which effect); defaults to the card name, "" for none. */
  caption?: string;
  /** Pre-selected and not toggleable (e.g. "must" cards of a sum selection). */
  locked?: boolean;
  /** Shown as selected initially. */
  selected?: boolean;
}

export interface PickerOptions {
  title: string;
  cards: PickerCard[];
  /** "multi": toggle cards, then Confirm (enabled while `isValid` holds). "single": first click resolves. */
  mode: "multi" | "single";
  isValid?: (selected: number[]) => boolean;
  /** Multi mode: how many cards may be picked, shown as a counter on CONFIRM ("CONFIRM 1/2"). */
  max?: number;
  /** Multi mode: a different CONFIRM counter instead of picked/max, e.g. a running sum: `CONFIRM ${value}/${of}`. */
  counter?: { value: (selected: number[]) => number; of: number };
  onConfirm: (selected: number[]) => void;
  /** Extra buttons after CONFIRM; `enabled: false` shows one faded and inert. */
  buttons?: { label: string; onClick: () => void; enabled?: boolean }[];
  onHover?: (code: number) => void;
  onHoverEnd?: () => void;
}

/** The CONFIRM counter of a multi pick: `opts.counter`, or picked/max. Null when there's neither. */
export function pickCounter(opts: PickerOptions): { value: (selected: number[]) => number; of: number } | null {
  return opts.counter ?? (opts.max ? { value: (sel) => sel.length, of: opts.max } : null);
}

/**
 * A click on card `i` in a multi pick (dialog or board): toggles it; when `max` are picked, a click on another
 * card swaps the one pick if `max` is 1, else does nothing (unpick one first). Returns whether anything changed.
 */
export function togglePick(selected: Set<number>, i: number, max: number | undefined): boolean {
  if (selected.has(i)) selected.delete(i);
  else if (!max || selected.size < max) selected.add(i);
  else if (max === 1) { selected.clear(); selected.add(i); }
  else return false;
  return true;
}

export interface SearchOptions {
  title: string;
  /** The cards that may be picked. */
  codes: number[];
  onPick: (code: number) => void;
  /** Called for the highlighted match (pointer or arrow keys), e.g. to show it in the info panel. */
  onHover?: (code: number) => void;
}

export class Modal {
  private root: Phaser.GameObjects.Container | null = null;
  /** Things to undo on close besides the display objects (the search's HTML input, its caret timer). */
  private cleanups: (() => void)[] = [];
  private readonly scene: Phaser.Scene;
  private readonly cards: CardDb;

  constructor(scene: Phaser.Scene, cards: CardDb) {
    this.scene = scene;
    this.cards = cards;
  }

  get isOpen(): boolean {
    return this.root !== null;
  }

  close(): void {
    for (const f of this.cleanups.splice(0)) f();
    this.root?.destroy();
    this.root = null;
  }

  /**
   * Dialog: the theme's board (rim INSET.board, like the info panel) with the message as plain text on it
   * and list-row buttons. With a card: the card (at 2x) on the left; to its right the message on top
   * and the buttons at the bottom, the message wrapped to the buttons' width, as tall as the card. Without:
   * message above the buttons. The board is STANDARD_W wide (WIDE_W if a button label needs it), content
   * centred, except the card, which sits at the left edge.
   */
  dialog(message: string, buttons: { label: string; onClick: () => void }[], code?: number): void {
    const s = this.scene;
    const root = this.open();
    const rim = INSET.board;
    const cardW = code ? CARD.w * 2 : 0, cardH = code ? CARD.h * 2 : 0;
    const side = code ? cardW + CARD_GAP : 0; // the card and the gap after it
    const labels = buttons.map((b) => b.label);
    const labelW = Math.max(...labels.map((l) => measure(s, FONT_UI, l.toUpperCase()))) + 10;
    const w = labelW <= innerWidth(STANDARD_W) - side ? STANDARD_W : WIDE_W;
    const maxCol = innerWidth(w) - side;
    const grid = buttonGrid(s, labels, maxCol);
    // The text column: as wide as the buttons, or wider (up to the space left) for longer text, e.g. a lone OK
    // under a sentence. `+ 1`: the trailing pixel BitmapText wraps on.
    const textW = Math.max(...message.split("\n").map((line) => measure(s, FONT_UI, line))) + 1;
    const colW = Math.max(grid.width, Math.min(maxCol, textW));
    const left = Math.round(MID_X - w / 2);
    const contentX = left + Math.round((w - side - colW) / 2);
    const colX = contentX + side;
    const body = text(s, 0, 0, message, { color: THEME.panel.ink, maxWidth: colW });
    const textH = 2 + body.height + 6;
    const contentH = Math.max(cardH, textH + grid.h);
    const h = rim + CARD_GAP + contentH + CARD_GAP + rim;
    const top = Math.round(180 - h / 2);
    root.add(board(s, left, top, w, h));
    const contentTop = top + rim + CARD_GAP;
    // The card sits against the left padding; the text and buttons stay where centring put them.
    if (code) root.add(new CardSprite(s, left + rim + CARD_GAP + CARD.w, contentTop + CARD.h).show(code, this.cards.records.get(code)).setScale(2));
    // Centred in the column, each wrapped line too.
    body.setCenterAlign().setPosition(Math.round(colX + (colW - body.width) / 2), contentTop + 2);
    root.add(body);
    // Each row of buttons centred in the column. With a card they sit at its bottom, otherwise right under the text.
    const by = code ? contentTop + contentH - grid.h : contentTop + textH;
    buttons.forEach((b, i) => {
      const row = Math.floor(i / grid.perRow), col = i % grid.perRow;
      const n = Math.min(grid.perRow, buttons.length - row * grid.perRow);
      const rowLeft = Math.round(colX + (colW - (n * (grid.w + BTN_GAP) - BTN_GAP)) / 2);
      const label = fit(s, FONT_UI, b.label.toUpperCase(), grid.w - 6); // very long options get cut
      root.add(makeListButton(s, rowLeft + col * (grid.w + BTN_GAP), by + row * (LIST_BUTTON_H + BTN_GAP), grid.w, label,
        () => { this.close(); b.onClick(); }));
    });
  }

  /**
   * Calling a coin toss: the title over the two coin faces (heads = frame 0, tails = 4), each with a HEADS / TAILS
   * list button under it, just wide enough for the label. Clicking a coin (it lifts a little on hover) or its
   * button picks it.
   */
  coinCall(title: string, onPick: (heads: boolean) => void): void {
    const s = this.scene;
    const root = this.open();
    const rim = INSET.board, pad = CARD_GAP;
    const coin = 32, gap = 24;
    const labels = ["HEADS", "TAILS"];
    const btnW = Math.max(...labels.map((l) => measure(s, FONT_UI, l))) + 10;
    const colW = Math.max(coin, btnW);
    const w = STANDARD_W, innerW = innerWidth(w);
    const heading = text(s, 0, 0, title.toUpperCase(), { color: THEME.panel.ink, maxWidth: innerW }).setCenterAlign();
    const h = rim + pad + heading.height + 3 + HOVER_LIFT + coin + 5 + LIST_BUTTON_H + pad + rim;
    const left = Math.round(MID_X - w / 2), top = Math.round(180 - h / 2);
    const innerX = left + rim + pad;
    root.add(board(s, left, top, w, h));
    heading.setPosition(Math.round(innerX + (innerW - heading.width) / 2), top + rim + pad);
    root.add(heading);
    const coinsTop = heading.y + heading.height + 3 + HOVER_LIFT;
    const rowLeft = innerX + Math.round((innerW - (2 * colW + gap)) / 2);
    const pick = (heads: boolean) => { this.close(); onPick(heads); };
    [true, false].forEach((heads, i) => {
      const colX = rowLeft + i * (colW + gap);
      const img = s.add.image(colX + Math.round((colW - coin) / 2), coinsTop, COIN_SHEET, heads ? 0 : 4).setOrigin(0).setInteractive({ useHandCursor: true });
      img.on("pointerover", () => img.setY(coinsTop - HOVER_LIFT));
      img.on("pointerout", () => img.setY(coinsTop));
      img.on("pointerup", () => pick(heads));
      root.add(img);
      root.add(makeListButton(s, colX + Math.round((colW - btnW) / 2), coinsTop + coin + 5, btnW, labels[i], () => pick(heads)));
    });
  }

  /**
   * Putting cards in an order (SORT_CARD, e.g. Big Eye's top 5): the cards in a row, each click numbers the next
   * card (1, 2, ...) with a badge on its top-right corner. RESET clears the numbers; CONFIRM (once every card has
   * one) answers `order[i]` = the 0-based number of card i. Numbered cards stay raised; unnumbered ones lift a little
   * on hover.
   */
  sortCards(opts: { title: string; codes: number[]; onConfirm: (order: number[]) => void; onHover?: (code: number) => void; onHoverEnd?: () => void }): void {
    const s = this.scene;
    const root = this.open();
    const rim = INSET.board, pad = CARD_GAP;
    const n = opts.codes.length;
    const cardsW = n * PICK_PITCH_X - (PICK_PITCH_X - CARD.w);
    const btnW = Math.max(44, ...["RESET", `CONFIRM ${n}/${n}`].map((l) => measure(s, FONT_UI, l) + 10));
    const buttonsW = 2 * btnW + BTN_GAP;
    const titleW = measure(s, FONT_UI, opts.title.toUpperCase()) + 1;
    const w = Math.max(cardsW, buttonsW, titleW) <= innerWidth(STANDARD_W) ? STANDARD_W : WIDE_W;
    const innerW = innerWidth(w);
    const title = text(s, 0, 0, opts.title.toUpperCase(), { color: THEME.panel.ink, maxWidth: innerW }).setCenterAlign();
    const h = rim + pad + title.height + 3 + SELECTED_LIFT + CARD.h + 5 + LIST_BUTTON_H + pad + rim;
    const left = Math.round(MID_X - w / 2), top = Math.round(180 - h / 2);
    const innerX = left + rim + pad;
    root.add(board(s, left, top, w, h));
    title.setPosition(Math.round(innerX + (innerW - title.width) / 2), top + rim + pad);
    root.add(title);

    /** Click number of each card (0-based), -1 while it has none. */
    const order: number[] = opts.codes.map(() => -1);
    let next = 0;
    const cardsTop = title.y + title.height + 3 + SELECTED_LIFT;
    const rowLeft = innerX + Math.round((innerW - cardsW) / 2);
    const by = cardsTop + CARD.h + 5;
    const bx = Math.round(innerX + (innerW - buttonsW) / 2);
    const confirm = makeListButton(s, bx + btnW + BTN_GAP, by, btnW, "", () => { this.close(); opts.onConfirm([...order]); });
    const items = opts.codes.map((code, i) => {
      const x = rowLeft + i * PICK_PITCH_X + CARD.w / 2, y = cardsTop + CARD.h / 2;
      const sp = new CardSprite(s, x, y).show(code, this.cards.records.get(code)).setInteractive({ useHandCursor: true });
      // The number badge, like the board's counters: white on black at the card's top-right corner.
      const label = text(s, 0, 0, "", { color: WHITE });
      const box = s.add.rectangle(0, 0, 0, 7, INK).setOrigin(0);
      return { sp, x, y, label, box };
    });
    const refresh = (hovered = -1) => {
      items.forEach(({ sp, x, y, label, box }, i) => {
        const numbered = order[i] >= 0;
        sp.y = y - (numbered ? SELECTED_LIFT : i === hovered ? HOVER_LIFT : 0);
        label.setText(numbered ? String(order[i] + 1) : "");
        const bw = label.width + 4, right = x + CARD.w / 2, bTop = Math.round(sp.y - CARD.h / 2);
        box.setSize(bw, 7).setPosition(right - bw, bTop).setVisible(numbered);
        label.setPosition(right - bw + 2, bTop + 1).setVisible(numbered);
      });
      confirm.setEnabled(next === n);
      confirm.setLabel(`CONFIRM ${next}/${n}`);
    };
    items.forEach(({ sp, label, box }, i) => {
      sp.on("pointerover", () => { opts.onHover?.(opts.codes[i]); refresh(i); });
      sp.on("pointerout", () => { opts.onHoverEnd?.(); refresh(); });
      sp.on("pointerup", () => { if (order[i] < 0) { order[i] = next++; refresh(); } });
      root.add([sp, box, label]);
    });
    root.add(makeListButton(s, bx, by, btnW, "RESET", () => { order.fill(-1); next = 0; refresh(); }));
    root.add(confirm);
    refresh();
  }

  /**
   * Card picker on the same board as the dialogs: title, one row of up to 9 cards with a caption under
   * each, then a row of list-row buttons (CONFIRM in multi mode, the caller's buttons, < > for pages). More
   * than 9 cards make more pages, never more rows, and every page has the first page's size (the board
   * doesn't jump when paging). Single mode: clicking a card picks it (cards lift a little on hover). Multi mode: clicked
   * cards toggle and stay raised; CONFIRM is enabled while `isValid` holds.
   */
  picker(opts: PickerOptions): void {
    const perPage = 9;
    const selected = new Set(opts.cards.flatMap((c, i) => (c.selected || c.locked ? [i] : [])));
    const pages = Math.max(1, Math.ceil(opts.cards.length / perPage));
    const confirmed = () => [...selected].sort((a, b) => a - b);
    const render = (page: number) => {
      const s = this.scene;
      const root = this.open();
      const rim = INSET.board, pad = CARD_GAP;
      const shown = opts.cards.slice(page * perPage, (page + 1) * perPage);
      // Sized for the first (fullest) page, with room under the cards for captions unless no card has one.
      const cols = Math.max(1, Math.min(perPage, opts.cards.length));
      const captions = opts.cards.some((c) => c.caption !== "");
      const cardsW = cols * PICK_PITCH_X - (PICK_PITCH_X - CARD.w);
      const cardsH = CARD.h + (captions ? 2 + 3 : 0);

      const titleW = measure(s, FONT_UI, opts.title.toUpperCase()) + 1;
      const buttons: { label: string; onClick: () => void; confirm?: boolean; narrow?: boolean; enabled?: boolean }[] = [];
      if (pages > 1) buttons.push({ label: "<", narrow: true, onClick: () => render((page + pages - 1) % pages) });
      if (opts.mode === "multi") buttons.push({ label: "Confirm", confirm: true, onClick: () => { this.close(); opts.onConfirm(confirmed()); } });
      for (const b of opts.buttons ?? []) buttons.push({ label: b.label, enabled: b.enabled, onClick: () => { this.close(); b.onClick(); } });
      if (pages > 1) buttons.push({ label: ">", narrow: true, onClick: () => render((page + 1) % pages) });
      const count = pickCounter(opts);
      const confirmLabel = () => (count ? `Confirm ${count.value(confirmed())}/${count.of}` : "Confirm");
      // Wide enough for the counter at its longest too.
      const longest = (b: { label: string; confirm?: boolean }) => (b.confirm && count ? `Confirm ${count.of}/${count.of}` : b.label);
      const wideW = Math.max(44, ...buttons.filter((b) => !b.narrow).map((b) => measure(s, FONT_UI, longest(b).toUpperCase()) + 10));
      const btnW = (b: { narrow?: boolean }) => (b.narrow ? 16 : wideW);
      const buttonsW = buttons.reduce((n, b) => n + btnW(b) + BTN_GAP, -BTN_GAP);

      // Standard width unless the cards (6+ in a row), title or buttons need the wide board.
      const needed = Math.max(cardsW, titleW, buttonsW + (pages > 1 ? 24 : 0));
      const w = needed <= innerWidth(STANDARD_W) ? STANDARD_W : WIDE_W;
      const innerW = innerWidth(w);
      const title = text(s, 0, 0, opts.title.toUpperCase(), { color: THEME.panel.ink, maxWidth: innerW }).setCenterAlign();
      const h = rim + pad + title.height + 3 + SELECTED_LIFT + cardsH + (buttons.length ? 5 + LIST_BUTTON_H : 0) + pad + rim;
      const left = Math.round(MID_X - w / 2), top = Math.round(180 - h / 2);
      const innerX = left + rim + pad;
      root.add(board(s, left, top, w, h));
      title.setPosition(Math.round(innerX + (innerW - title.width) / 2), top + rim + pad);
      root.add(title);

      let confirm: ListButton | null = null;
      const sprites = new Map<number, CardSprite>();
      const baseY = new Map<number, number>();
      // No outlines: selected cards are raised; in single mode a hovered card rises a little.
      const place = (i: number, hovered = false) => {
        const sp = sprites.get(i)!;
        sp.y = baseY.get(i)! - (selected.has(i) ? SELECTED_LIFT : hovered ? HOVER_LIFT : 0);
      };
      const refresh = () => {
        for (const i of sprites.keys()) place(i);
        confirm?.setEnabled(opts.isValid ? opts.isValid(confirmed()) : true);
        confirm?.setLabel(confirmLabel());
      };
      const cardsTop = top + rim + pad + title.height + 3 + SELECTED_LIFT;
      shown.forEach((c, j) => {
        const i = page * perPage + j;
        // A shorter last page is centred in the same board.
        const rowLeft = innerX + Math.round((innerW - (shown.length * PICK_PITCH_X - (PICK_PITCH_X - CARD.w))) / 2);
        const x = rowLeft + j * PICK_PITCH_X + CARD.w / 2;
        const y = cardsTop + CARD.h / 2;
        const sp = new CardSprite(s, x, y).show(c.code, this.cards.records.get(c.code));
        sp.setInteractive({ useHandCursor: !c.locked });
        sp.on("pointerover", () => {
          opts.onHover?.(c.code);
          if (opts.mode === "single" && !c.locked) place(i, true);
        });
        sp.on("pointerout", () => {
          opts.onHoverEnd?.();
          place(i);
        });
        sp.on("pointerup", () => {
          if (c.locked) return;
          if (opts.mode === "single") { this.close(); opts.onConfirm([i]); return; }
          if (togglePick(selected, i, opts.max)) refresh();
        });
        sprites.set(i, sp);
        baseY.set(i, y);
        root.add(sp);
        const caption = fit(s, FONT_CARD, (c.caption ?? this.cards.name(c.code)).toUpperCase(), PICK_PITCH_X - 2);
        if (caption) root.add(text(s, x, y + CARD.h / 2 + 2, caption, { font: FONT_CARD, color: THEME.panel.ink, originX: 0.5 }));
      });

      if (buttons.length) {
        const by = cardsTop + cardsH + 5;
        let bx = Math.round(innerX + (innerW - buttonsW) / 2);
        for (const b of buttons) {
          const btn = makeListButton(s, bx, by, btnW(b), b.label, b.onClick);
          if (b.confirm) confirm = btn;
          if (b.enabled === false) btn.setEnabled(false);
          root.add(btn);
          bx += btnW(b) + BTN_GAP;
        }
        if (pages > 1) root.add(text(s, innerX, by + 3, `${page + 1}/${pages}`, { color: THEME.panel.ink }));
      }
      refresh();
    };
    render(0);
  }

  /**
   * Card-name search (declarations; scales to thousands of cards, unlike paging): a text field on paper with
   * the match count, the best SEARCH_ROWS matches as list rows, and a hint line. Typing filters live
   * (CardSearch); Up/Down move the highlight (previewed via onHover), Enter or a click picks. The text is
   * collected by an invisible HTML input over the field, so tapping it opens a phone's keyboard.
   */
  search(opts: SearchOptions): void {
    const s = this.scene;
    const root = this.open();
    const rim = INSET.board, pad = CARD_GAP;
    const finder = new CardSearch(opts.codes.map((code) => ({ code, name: this.cards.name(code) })));
    const w = WIDE_W, innerW = innerWidth(w);
    const rowPitch = LIST_BUTTON_H + 2;
    const title = text(s, 0, 0, opts.title.toUpperCase(), { color: THEME.panel.ink, maxWidth: innerW }).setCenterAlign();
    const h = rim + pad + title.height + 4 + FIELD_H + 4 + SEARCH_ROWS * rowPitch - 2 + 5 + 5 + pad + rim;
    const left = Math.round(MID_X - w / 2), top = Math.round(180 - h / 2);
    const innerX = left + rim + pad;
    root.add(board(s, left, top, w, h));
    title.setPosition(Math.round(innerX + (innerW - title.width) / 2), top + rim + pad);
    root.add(title);

    // Text field: paper inset, typed text + blinking caret on the left, match count on the right.
    const fieldY = title.y + title.height + 4;
    const ps = THEME.panel.paperSlice;
    root.add(s.add.nineslice(innerX, fieldY, ui("panel-paper"), undefined, innerW, FIELD_H, ps, ps, ps, ps).setOrigin(0));
    const typed = text(s, innerX + 5, fieldY + 5, "", { color: THEME.panel.paperInk });
    const caret = text(s, innerX + 5, fieldY + 5, "_", { color: THEME.panel.paperInk });
    const count = text(s, 0, fieldY + 5, "", { color: THEME.panel.inkSoft });
    root.add([typed, caret, count]);
    const blink = s.time.addEvent({ delay: 450, loop: true, callback: () => caret.setVisible(!caret.visible) });

    let results: NamedCard[] = [];
    let highlight = 0;
    const rowsY = fieldY + FIELD_H + 4;
    const rows = Array.from({ length: SEARCH_ROWS }, (_, i) => {
      const btn = makeListButton(s, innerX, rowsY + i * rowPitch, innerW, "", () => { const c = results[i]; if (c) pick(c.code); });
      btn[2].on("pointerover", () => { if (results[i]) setHighlight(i); });
      root.add(btn);
      return btn;
    });
    const hint = text(s, innerX + innerW / 2, rowsY + SEARCH_ROWS * rowPitch - 2 + 5, "TYPE A NAME (TAP THE BOX ON A PHONE) - UP / DOWN, ENTER TO PICK",
      { color: THEME.panel.inkSoft, originX: 0.5 });
    root.add(hint);

    const pick = (code: number) => { this.close(); opts.onPick(code); };
    const setHighlight = (i: number) => {
      highlight = i;
      rows.forEach((r, j) => r.setHighlighted(j === i && !!results[j]));
      const c = results[i];
      if (c) opts.onHover?.(c.code);
    };
    const update = (query: string) => {
      results = finder.find(query);
      const shownText = fit(s, FONT_UI, query.toUpperCase(), innerW - 70);
      typed.setText(shownText);
      caret.setX(innerX + 5 + (shownText ? typed.width + 1 : 0));
      count.setText(results.length === 1 ? "1 MATCH" : `${results.length} MATCHES`);
      count.setX(Math.round(innerX + innerW - 5 - count.width));
      rows.forEach((r, i) => {
        const c = results[i];
        for (const part of r) (part as unknown as Phaser.GameObjects.Components.Visible).setVisible(!!c);
        if (c) r.setLabel(fit(s, FONT_UI, c.name.toUpperCase(), innerW - 8));
      });
      setHighlight(0);
    };

    const input = createTextInput(s, { x: innerX, y: fieldY, w: innerW, h: FIELD_H }, {
      onChange: update,
      onKey: (e) => {
        const n = Math.min(results.length, SEARCH_ROWS);
        if (e.key === "ArrowDown" && n) { setHighlight((highlight + 1) % n); return true; }
        if (e.key === "ArrowUp" && n) { setHighlight((highlight + n - 1) % n); return true; }
        if (e.key === "Enter") { const c = results[highlight]; if (c) pick(c.code); return true; }
        return false;
      },
    });
    this.cleanups.push(() => { input.destroy(); blink.remove(); });
    update("");
    input.focus();
  }

  private open(): Phaser.GameObjects.Container {
    this.close();
    // The whole screen, table behind the info panel's frame included; the info panel itself is drawn above
    // the shade (INFO_DEPTH) so it stays bright and hovered cards still show there.
    const shade = this.scene.add.rectangle(0, 0, 640, 360, 0x000000, THEME.shadeAlpha).setOrigin(0).setInteractive();
    this.root = this.scene.add.container(0, 0, [shade]).setDepth(DEPTH);
    return this.root;
  }
}

/**
 * Lays dialog buttons out in a grid within `width`: all share the longest label's width (min 44); as many
 * per row as fit, a single full-width column for long labels (several buttons that don't fit side by side).
 */
function buttonGrid(scene: Phaser.Scene, labels: string[], width: number): { w: number; perRow: number; width: number; h: number } {
  const labelW = Math.max(...labels.map((l) => measure(scene, FONT_UI, l.toUpperCase())));
  let w = Math.min(width, Math.max(44, labelW + 10));
  const perRow = Math.max(1, Math.min(labels.length, Math.floor((width + BTN_GAP) / (w + BTN_GAP))));
  if (perRow === 1 && labels.length > 1) w = width; // a stacked list; a lone button keeps its size
  const rows = Math.ceil(labels.length / perRow);
  return { w, perRow, width: perRow * (w + BTN_GAP) - BTN_GAP, h: rows * (LIST_BUTTON_H + BTN_GAP) - BTN_GAP };
}

/** Content width inside a board of width `w`: the rim plus CARD_GAP padding on each side. */
function innerWidth(w: number): number {
  return w - 2 * (INSET.board + CARD_GAP);
}
