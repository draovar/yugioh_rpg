// Modal overlays used by duel prompts: button dialogs and a (paged) card picker.
// They cover the field but not the info panel, so hovering a card in a modal still shows it.
import Phaser from "phaser";
import type { CardDb } from "../../duel/cardData.ts";
import { FONT_CARD, FONT_UI, INK, WHITE, border, fit, measure, text } from "../pixel.ts";
import { LIST_BUTTON_H, makeButton, makeListButton } from "../widgets.ts";
import { CardSprite } from "./CardSprite.ts";
import { CARD, INFO } from "./layout.ts";
import { PANEL as WOOD } from "./panelStyles.ts";

const DEPTH = 1000;
const LEFT = INFO.x + INFO.w;
const WIDTH = 640 - LEFT;
const MID_X = LEFT + Math.floor(WIDTH / 2);
const PANEL = 0x1b2147;
const DIALOG_W = 240;
/** Space between the dialog's rim and its card (and between the card and the text column). */
const CARD_GAP = 4;
/** Between dialog buttons (both directions). */
const BTN_GAP = 4;
/** How far a selected card is raised in a picker. */
const SELECTED_LIFT = 5;

export interface PickerCard {
  code: number;
  /** Small caption under the card (e.g. which effect); defaults to the card name. */
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
   * and the buttons at the bottom, the message wrapped to the buttons' width and the board shrunk around
   * them, as tall as the card. Without: message above the buttons, the board as wide as the wider of the two.
   */
  dialog(message: string, buttons: { label: string; onClick: () => void }[], code?: number): void {
    const s = this.scene;
    const root = this.open();
    const rim = WOOD.rim;
    const cardW = code ? CARD.w * 2 : 0, cardH = code ? CARD.h * 2 : 0;
    // Text/button column: inside the rim (CARD_GAP padding), after the card and a gap if there is one.
    const maxCol = DIALOG_W - 2 * (rim + CARD_GAP) - (code ? cardW + CARD_GAP : 0);
    const grid = buttonGrid(s, buttons.map((b) => b.label), maxCol);
    const colW = code ? grid.width : Math.max(grid.width, Math.min(maxCol, measure(s, FONT_UI, message) + 1)) // + the trailing pixel BitmapText wraps on;
    const w = 2 * (rim + CARD_GAP) + (code ? cardW + CARD_GAP : 0) + colW;
    const left = Math.round(MID_X - w / 2);
    const colX = left + rim + CARD_GAP + (code ? cardW + CARD_GAP : 0);
    const body = text(s, 0, 0, message, { color: WOOD.ink, maxWidth: colW });
    const textH = 2 + body.height + 6;
    const contentH = Math.max(cardH, textH + grid.h);
    const h = rim + CARD_GAP + contentH + CARD_GAP + rim;
    const top = Math.round(180 - h / 2);
    root.add(s.add.nineslice(left, top, WOOD.frame, undefined, w, h, rim, rim, rim, rim).setOrigin(0));
    const contentTop = top + rim + CARD_GAP;
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

  picker(opts: PickerOptions): void {
    const perRow = 9, rowsPerPage = 3, perPage = perRow * rowsPerPage;
    const selected = new Set(opts.cards.flatMap((c, i) => (c.selected || c.locked ? [i] : [])));
    const pages = Math.max(1, Math.ceil(opts.cards.length / perPage));
    const render = (page: number) => {
      const s = this.scene;
      const root = this.open();
      const pitchX = CARD.w + 6, pitchY = CARD.h + 14;
      const shown = opts.cards.slice(page * perPage, (page + 1) * perPage);
      const rows = Math.max(1, Math.ceil(shown.length / perRow));
      const h = 22 + rows * pitchY + 22;
      const top = 180 - Math.floor(h / 2);
      root.add(this.panel(LEFT + 4, top, WIDTH - 8, h));
      root.add(text(s, MID_X, top + 6, opts.title.toUpperCase(), { color: WHITE, originX: 0.5, maxWidth: WIDTH - 24 }));

      let confirm: ReturnType<typeof makeButton> | null = null;
      const sprites = new Map<number, CardSprite>();
      const baseY = new Map<number, number>();
      // No outlines: selected cards are lifted a few pixels instead.
      const refresh = () => {
        for (const [i, sp] of sprites) sp.y = baseY.get(i)! - (selected.has(i) ? SELECTED_LIFT : 0);
        confirm?.setEnabled(opts.isValid ? opts.isValid([...selected].sort((a, b) => a - b)) : true);
      };
      shown.forEach((c, j) => {
        const i = page * perPage + j;
        const row = Math.floor(j / perRow), col = j % perRow;
        const n = Math.min(perRow, shown.length - row * perRow);
        const x = Math.round(MID_X + (col - (n - 1) / 2) * pitchX);
        const y = top + 20 + CARD.h / 2 + row * pitchY;
        const sp = new CardSprite(s, x, y).show(c.code, this.cards.records.get(c.code));
        sp.setInteractive({ useHandCursor: !c.locked });
        sp.on("pointerover", () => opts.onHover?.(c.code));
        sp.on("pointerout", () => opts.onHoverEnd?.());
        sp.on("pointerup", () => {
          if (c.locked) return;
          if (opts.mode === "single") { this.close(); opts.onConfirm([i]); return; }
          if (selected.has(i)) selected.delete(i); else selected.add(i);
          refresh();
        });
        sprites.set(i, sp);
        baseY.set(i, y);
        const caption = fit(s, FONT_CARD, (c.caption ?? this.cards.name(c.code)).toUpperCase(), pitchX - 2);
        root.add([sp, text(s, x, y + CARD.h / 2 + 4, caption, { font: FONT_CARD, color: WHITE, originX: 0.5 })]);
      });

      const buttons: { label: string; onClick: () => void; confirm?: boolean }[] = [];
      if (pages > 1) buttons.push({ label: "<", onClick: () => render((page + pages - 1) % pages) });
      if (opts.mode === "multi") buttons.push({ label: "CONFIRM", confirm: true, onClick: () => { this.close(); opts.onConfirm([...selected].sort((a, b) => a - b)); } });
      for (const b of opts.buttons ?? []) buttons.push({ label: b.label.toUpperCase(), onClick: () => { this.close(); b.onClick(); } });
      if (pages > 1) buttons.push({ label: ">", onClick: () => render((page + 1) % pages) });
      const by = top + h - 12;
      buttons.forEach((b, i) => {
        const narrow = b.label.length <= 1;
        const bx = MID_X + (i - (buttons.length - 1) / 2) * 76;
        const btn = makeButton(s, bx, by, narrow ? 20 : 72, 13, b.label, b.onClick, b.confirm ? 0x2f7a3d : undefined);
        if (b.confirm) confirm = btn;
        root.add(btn);
      });
      if (pages > 1) root.add(text(s, LEFT + 10, by - 2, `${page + 1}/${pages}`, { color: WHITE }));
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

  private panel(x: number, y: number, w: number, h: number): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics();
    g.fillStyle(PANEL).fillRect(Math.round(x), Math.round(y), w, h);
    border(g, Math.round(x), Math.round(y), w, h, INK);
    border(g, Math.round(x) + 1, Math.round(y) + 1, w - 2, h - 2, 0x6c7bd1);
    return g;
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
