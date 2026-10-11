// Modal overlays used by duel prompts: button dialogs and a (paged) card picker.
// They cover the field but not the info panel, so hovering a card in a modal still shows it.
import Phaser from "phaser";
import type { CardDb } from "../../duel/cardData.ts";
import { FONT_CARD, FONT_UI, fit, measure, text } from "../pixel.ts";
import { LIST_BUTTON_H, makeListButton, type ListButton } from "../widgets.ts";
import { CardSprite } from "./CardSprite.ts";
import { CARD, INFO } from "./layout.ts";
import { PANEL as WOOD } from "./panelStyles.ts";

const DEPTH = 1000;
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
  onConfirm: (selected: number[]) => void;
  buttons?: { label: string; onClick: () => void }[];
  onHover?: (code: number) => void;
  onHoverEnd?: () => void;
}

export class Modal {
  private root: Phaser.GameObjects.Container | null = null;
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
    this.root?.destroy();
    this.root = null;
  }

  /**
   * Runewood dialog: light wood board (rim 9, like the info panel) with the message as plain text on the
   * wood and list-row buttons. With a card: the card (at 2x) on the left; to its right the message on top
   * and the buttons at the bottom, the message wrapped to the buttons' width, as tall as the card. Without:
   * message above the buttons. The board is STANDARD_W wide (WIDE_W if a button label needs it), content
   * centred, except the card, which sits at the left edge.
   */
  dialog(message: string, buttons: { label: string; onClick: () => void }[], code?: number): void {
    const s = this.scene;
    const root = this.open();
    const rim = WOOD.rim;
    const cardW = code ? CARD.w * 2 : 0, cardH = code ? CARD.h * 2 : 0;
    const side = code ? cardW + CARD_GAP : 0; // the card and the gap after it
    const labels = buttons.map((b) => b.label);
    const labelW = Math.max(...labels.map((l) => measure(s, FONT_UI, l.toUpperCase()))) + 10;
    const w = labelW <= innerWidth(STANDARD_W) - side ? STANDARD_W : WIDE_W;
    const maxCol = innerWidth(w) - side;
    const grid = buttonGrid(s, labels, maxCol);
    const colW = code ? grid.width : Math.max(grid.width, Math.min(maxCol, measure(s, FONT_UI, message) + 1)); // + the trailing pixel BitmapText wraps on
    const left = Math.round(MID_X - w / 2);
    const contentX = left + Math.round((w - side - colW) / 2);
    const colX = contentX + side;
    const body = text(s, 0, 0, message, { color: WOOD.ink, maxWidth: colW });
    const textH = 2 + body.height + 6;
    const contentH = Math.max(cardH, textH + grid.h);
    const h = rim + CARD_GAP + contentH + CARD_GAP + rim;
    const top = Math.round(180 - h / 2);
    root.add(s.add.nineslice(left, top, WOOD.frame, undefined, w, h, rim, rim, rim, rim).setOrigin(0));
    const contentTop = top + rim + CARD_GAP;
    // The card sits against the left padding; the text and buttons stay where centring put them.
    if (code) root.add(new CardSprite(s, left + rim + CARD_GAP + CARD.w, contentTop + CARD.h).show(code, this.cards.records.get(code)).setScale(2));
    // Centred in the column, each wrapped line too.
    body.setCenterAlign().setPosition(Math.round(colX + (colW - body.width) / 2), contentTop + 2);
    root.add(body);
    // With a card the buttons sit at the bottom of the column, left-aligned; otherwise right under the text.
    const by = code ? contentTop + contentH - grid.h : contentTop + textH;
    buttons.forEach((b, i) => {
      const row = Math.floor(i / grid.perRow), col = i % grid.perRow;
      const n = Math.min(grid.perRow, buttons.length - row * grid.perRow);
      const rowLeft = code ? colX : Math.round(colX + (colW - (n * (grid.w + BTN_GAP) - BTN_GAP)) / 2);
      const label = fit(s, FONT_UI, b.label.toUpperCase(), grid.w - 6); // very long options get cut
      root.add(makeListButton(s, rowLeft + col * (grid.w + BTN_GAP), by + row * (LIST_BUTTON_H + BTN_GAP), grid.w, label,
        () => { this.close(); b.onClick(); }));
    });
  }

  /**
   * Card picker on the same wood board as the dialogs, shrunk to fit: title, up to 3 rows of 9 cards with a
   * caption under each, then a row of list-row buttons (CONFIRM in multi mode, the caller's buttons, < >
   * for pages). Single mode: clicking a card picks it (cards lift a little on hover). Multi mode: clicked
   * cards toggle and stay raised; CONFIRM is enabled while `isValid` holds.
   */
  picker(opts: PickerOptions): void {
    const perRow = 9, rowsPerPage = 3, perPage = perRow * rowsPerPage;
    const selected = new Set(opts.cards.flatMap((c, i) => (c.selected || c.locked ? [i] : [])));
    const pages = Math.max(1, Math.ceil(opts.cards.length / perPage));
    const confirmed = () => [...selected].sort((a, b) => a - b);
    const render = (page: number) => {
      const s = this.scene;
      const root = this.open();
      const rim = WOOD.rim, pad = CARD_GAP;
      const shown = opts.cards.slice(page * perPage, (page + 1) * perPage);
      const cols = Math.max(1, Math.min(perRow, shown.length));
      const rows = Math.max(1, Math.ceil(shown.length / perRow));
      // Room under each card for its caption (unless no card on the page has one), and above it for the lift.
      const captions = shown.some((c) => c.caption !== "");
      const rowH = CARD.h + (captions ? 2 + 3 : 0);
      const pitchY = rowH + 4 + SELECTED_LIFT;
      const cardsW = cols * PICK_PITCH_X - (PICK_PITCH_X - CARD.w);
      const cardsH = rows * pitchY - (pitchY - rowH);

      const titleW = measure(s, FONT_UI, opts.title.toUpperCase()) + 1;
      const buttons: { label: string; onClick: () => void; confirm?: boolean; narrow?: boolean }[] = [];
      if (pages > 1) buttons.push({ label: "<", narrow: true, onClick: () => render((page + pages - 1) % pages) });
      if (opts.mode === "multi") buttons.push({ label: "Confirm", confirm: true, onClick: () => { this.close(); opts.onConfirm(confirmed()); } });
      for (const b of opts.buttons ?? []) buttons.push({ label: b.label, onClick: () => { this.close(); b.onClick(); } });
      if (pages > 1) buttons.push({ label: ">", narrow: true, onClick: () => render((page + 1) % pages) });
      const wideW = Math.max(44, ...buttons.filter((b) => !b.narrow).map((b) => measure(s, FONT_UI, b.label.toUpperCase()) + 10));
      const btnW = (b: { narrow?: boolean }) => (b.narrow ? 16 : wideW);
      const buttonsW = buttons.reduce((n, b) => n + btnW(b) + BTN_GAP, -BTN_GAP);

      // Standard width unless the cards (6+ in a row), title or buttons need the wide board.
      const needed = Math.max(cardsW, titleW, buttonsW + (pages > 1 ? 24 : 0));
      const w = needed <= innerWidth(STANDARD_W) ? STANDARD_W : WIDE_W;
      const innerW = innerWidth(w);
      const title = text(s, 0, 0, opts.title.toUpperCase(), { color: WOOD.ink, maxWidth: innerW }).setCenterAlign();
      const h = rim + pad + title.height + 3 + SELECTED_LIFT + cardsH + (buttons.length ? 5 + LIST_BUTTON_H : 0) + pad + rim;
      const left = Math.round(MID_X - w / 2), top = Math.round(180 - h / 2);
      const innerX = left + rim + pad;
      root.add(s.add.nineslice(left, top, WOOD.frame, undefined, w, h, rim, rim, rim, rim).setOrigin(0));
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
      };
      const cardsTop = top + rim + pad + title.height + 3 + SELECTED_LIFT;
      shown.forEach((c, j) => {
        const i = page * perPage + j;
        const row = Math.floor(j / perRow), col = j % perRow;
        const n = Math.min(perRow, shown.length - row * perRow);
        const rowLeft = innerX + Math.round((innerW - (n * PICK_PITCH_X - (PICK_PITCH_X - CARD.w))) / 2);
        const x = rowLeft + col * PICK_PITCH_X + CARD.w / 2;
        const y = cardsTop + row * pitchY + CARD.h / 2;
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
          if (selected.has(i)) selected.delete(i); else selected.add(i);
          refresh();
        });
        sprites.set(i, sp);
        baseY.set(i, y);
        root.add(sp);
        const caption = fit(s, FONT_CARD, (c.caption ?? this.cards.name(c.code)).toUpperCase(), PICK_PITCH_X - 2);
        if (caption) root.add(text(s, x, y + CARD.h / 2 + 2, caption, { font: FONT_CARD, color: WOOD.ink, originX: 0.5 }));
      });

      if (buttons.length) {
        const by = cardsTop + cardsH + 5;
        let bx = Math.round(innerX + (innerW - buttonsW) / 2);
        for (const b of buttons) {
          const btn = makeListButton(s, bx, by, btnW(b), b.label, b.onClick);
          if (b.confirm) confirm = btn;
          root.add(btn);
          bx += btnW(b) + BTN_GAP;
        }
        if (pages > 1) root.add(text(s, innerX, by + 3, `${page + 1}/${pages}`, { color: WOOD.ink }));
      }
      refresh();
    };
    render(0);
  }

  private open(): Phaser.GameObjects.Container {
    this.close();
    const shade = this.scene.add.rectangle(LEFT, 0, WIDTH, 360, 0x000000, 0.5).setOrigin(0).setInteractive();
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
  return w - 2 * (WOOD.rim + CARD_GAP);
}
