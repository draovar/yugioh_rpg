// The board on the right of a shop: Runewood's info board (the duel's info panel, the same size), its content inside
// the board's rim: the picked item's name and facts, a card list on the paper inset (a scrollbar at its right edge;
// clicking a card opens its details over the board, like the deck editor's), the price, how many (- / +) and BUY.
// The list's rows are either compact chips (a coloured chip and a name: the card shop's checklist) or the deck
// editor's card rows (art, name, type line, ATK / DEF, copies, a rarity chip: the deck shop's deck lists). Always
// Runewood's board and paper, whatever the UI theme.
import Phaser from "phaser";
import type { Engine } from "../duel/engine/loadEngine.ts";
import { CardInfo } from "../duel-screen/CardInfo.ts";
import { INFO, INSET } from "../duel-screen/layout.ts";
import { cardRow } from "../deck-editor/listRow.ts";
import { FONT_UI, INK, fit, measure, text } from "../ui/pixel.ts";
import { THEME, ui } from "../ui/theme.ts";
import { ListDrag, dragThumb } from "../ui/listDrag.ts";
import { LIST_BUTTON_H, makeListButton } from "../ui/widgets.ts";
import { BUTTON_H, RUNEWOOD, shopButton } from "./shopParts.ts";

/** A listed card: its chip (a short label on a colour; null: none), its name and (card rows) how many copies. */
export interface BoardRow {
  code: number;
  name: string;
  chip: { label: string; color: number } | null;
  copies?: number;
}

export interface BoardOptions {
  /** How many can be bought at once, at most. */
  maxQuantity: number;
  /** While true the board ignores input (something is being opened over the shop). */
  busy: () => boolean;
  onBuy: () => void;
  /** The list's rows: compact chips (the default) or the deck editor's card rows. */
  rows?: "chips" | "cards";
}

const BOARD = { x: 640 - INFO.w, w: INFO.w };
const CONTENT = { x: BOARD.x + INSET.board + 2, w: BOARD.w - 2 * (INSET.board + 2), top: INSET.board + 3, bottom: 360 - INSET.board - 2 };
/** 30 chip rows: the paper reaches down to just above the bottom row. */
const PAPER = { x: CONTENT.x, y: 50, w: CONTENT.w, h: 30 * 9 + 2 * INSET.paper };
const LIST = { x: PAPER.x + INSET.paper, y: PAPER.y + INSET.paper, w: PAPER.w - 2 * INSET.paper - 5, rowH: 9, rows: 30 };
/** Card rows: the deck editor's, 1px shorter (33 px: the 32px art and the line between rows) so 8 fit the paper. */
const CARD_LIST = { ...LIST, rowH: 33, rows: 8 };
const SCROLL = { x: PAPER.x + PAPER.w - INSET.paper - 3, y: LIST.y, w: 3, h: LIST.rows * LIST.rowH };
/** The scrollbar takes presses this far either side of it (it's thin). */
const SCROLL_REACH = 3;
/** Runewood's board and paper, loaded under keys of their own (the theme's `ui-*` ones may be Hologram's). */
const BOARD_KEY = "shop-info-frame", PAPER_KEY = "shop-panel-paper";
const CHIP = { w: 17, h: 7 };
/**
 * The bottom row: the price on the left; -, the count (centred between them), + and BUY on the right (x: left edges
 * and the count's centre, from the board's right edge; - / + are `step` wide). Buttons from `top`, BUTTON_H tall; the
 * 2x texts' top at textY, centred on the buttons.
 */
const RIGHT = CONTENT.x + CONTENT.w;
const BOTTOM = {
  top: CONTENT.bottom - BUTTON_H - 2, textY: CONTENT.bottom - BUTTON_H,
  buy: RIGHT - 36, buyW: 36, plus: RIGHT - 53, count: RIGHT - 60, minus: RIGHT - 79, step: 13,
};
/** A card's details over the board: above it, under anything being opened. */
const DETAILS_DEPTH = 50;
const STATUS_MS = 2000;

interface Details {
  root: Phaser.GameObjects.Container;
  info: CardInfo;
}

/** The chip rows' pieces, one of each per row in view: the chips' boxes and labels, the names. */
interface ChipRows {
  boxes: Phaser.GameObjects.Graphics;
  labels: Phaser.GameObjects.BitmapText[];
  names: Phaser.GameObjects.BitmapText[];
}

export class ShopBoard {
  /** How many to buy at once (- / +). */
  quantity = 1;
  private scene: Phaser.Scene;
  private engine: Engine;
  private opts: BoardOptions;
  private unitPrice = 0;
  private nameText: Phaser.GameObjects.BitmapText;
  private nameShadow: Phaser.GameObjects.BitmapText;
  private factsText: Phaser.GameObjects.BitmapText;
  private priceText: Phaser.GameObjects.BitmapText;
  private priceShadow: Phaser.GameObjects.BitmapText;
  private countText: Phaser.GameObjects.BitmapText | null = null;
  private statusText: Phaser.GameObjects.BitmapText;
  private statusTimer: Phaser.Time.TimerEvent | null = null;
  private rows: BoardRow[] = [];
  private scrollRow = 0;
  /** The list row under the pointer (an index into `rows`), -1 for none; its highlight. */
  private hovered = -1;
  private hoverBand: Phaser.GameObjects.Graphics;
  /** A listed card's details over the board (hidden until a card is clicked). */
  private details: Details;
  /** Chip rows: set again on every scroll. */
  private chipRows: ChipRows | null = null;
  /** Card rows: their art and texts, drawn again on every scroll. */
  private cardRows: Phaser.GameObjects.Container | null = null;
  /** The list's rows: LIST (chips) or CARD_LIST. */
  private list: typeof LIST;
  private scrollbar: Phaser.GameObjects.Graphics;

  static preload(scene: Phaser.Scene) {
    if (!scene.textures.exists(BOARD_KEY)) scene.load.image(BOARD_KEY, "assets/ui/runewood/info-frame.png");
    if (!scene.textures.exists(PAPER_KEY)) scene.load.image(PAPER_KEY, "assets/ui/runewood/panel-paper.png");
  }

  constructor(scene: Phaser.Scene, engine: Engine, opts: BoardOptions) {
    this.scene = scene;
    this.engine = engine;
    this.opts = opts;
    this.list = opts.rows === "cards" ? CARD_LIST : LIST;
    const panel = RUNEWOOD.panel, ps = panel.paperSlice;
    scene.add.nineslice(BOARD.x, 0, BOARD_KEY, undefined, BOARD.w, 360, ...panel.infoSlice).setOrigin(0);
    scene.add.nineslice(PAPER.x, PAPER.y, PAPER_KEY, undefined, PAPER.w, PAPER.h, ps, ps, ps, ps).setOrigin(0);

    // The name like a card's in the info panel: light, 2x, a 1px dark drop shadow.
    const left = CONTENT.x;
    this.nameShadow = text(scene, left + 1, CONTENT.top + 1, "", { color: RUNEWOOD.cardName.shadow, scale: 2 });
    this.nameText = text(scene, left, CONTENT.top, "", { color: RUNEWOOD.cardName.ink, scale: 2 });
    this.factsText = text(scene, left, PAPER.y - 9, "", { color: panel.inkSoft });

    this.hoverBand = scene.add.graphics();
    if (opts.rows === "cards") this.cardRows = scene.add.container(0, 0);
    else {
      this.chipRows = { boxes: scene.add.graphics(), labels: [], names: [] };
      for (let r = 0; r < LIST.rows; r++) {
        const y = LIST.y + r * LIST.rowH + 1;
        this.chipRows.labels.push(text(scene, LIST.x + CHIP.w / 2, y + 1, "", { color: 0xffffff, originX: 0.5 }));
        this.chipRows.names.push(text(scene, LIST.x + CHIP.w + 4, y + 1, "", { color: panel.paperInk }));
      }
    }
    this.scrollbar = scene.add.graphics();

    // Price (the total) in the name's lettering; the count plain black, the buttons' size and line; - / + change it
    // (none when only one can be bought). A status (rare: no card list) shows in the price's place for a moment.
    this.statusText = text(scene, left, BOTTOM.top + (BUTTON_H - 5) / 2, "", { color: panel.inkSoft });
    this.priceShadow = text(scene, left + 1, BOTTOM.textY + 1, "", { color: RUNEWOOD.cardName.shadow, scale: 2 });
    this.priceText = text(scene, left, BOTTOM.textY, "", { color: RUNEWOOD.cardName.ink, scale: 2 });
    if (opts.maxQuantity > 1) {
      this.countText = text(scene, BOTTOM.count, BOTTOM.top + (BUTTON_H - 5) / 2, "", { color: INK });
      shopButton(scene, BOTTOM.minus, BOTTOM.top, BOTTOM.step, "-", "wood", () => this.setQuantity(this.quantity - 1));
      shopButton(scene, BOTTOM.plus, BOTTOM.top, BOTTOM.step, "+", "wood", () => this.setQuantity(this.quantity + 1));
    }
    shopButton(scene, BOTTOM.buy, BOTTOM.top, BOTTOM.buyW, "BUY", "green", () => opts.onBuy());

    // The list scrolls by the wheel (over the board: three chip rows or one card row a notch) or by dragging it (touch);
    // a click (tap) on a card that doesn't drag opens its details; the row under the pointer is highlighted.
    const wheelRows = opts.rows === "cards" ? 1 : 3;
    scene.input.on("wheel", (p: Phaser.Input.Pointer, _: unknown, __: number, dy: number) => {
      if (!opts.busy() && p.x >= BOARD.x && !this.details.root.visible) this.scrollTo(this.scrollRow + Math.sign(dy) * wheelRows);
    });
    const rowAt = (y: number) => this.scrollRow + Math.floor((y - LIST.y) / this.list.rowH);
    const zone = scene.add.zone(LIST.x, LIST.y, SCROLL.x - SCROLL_REACH - LIST.x, SCROLL.h).setOrigin(0).setInteractive({ useHandCursor: true });
    const drag = new ListDrag(scene, zone, { rowH: this.list.rowH, row: () => this.scrollRow, scrollTo: (row) => this.scrollTo(row) });
    zone.on("pointermove", (p: Phaser.Input.Pointer) => { if (!p.isDown) this.hover(rowAt(p.y)); });
    zone.on("pointerout", () => this.hover(-1));
    zone.on("pointerup", (p: Phaser.Input.Pointer) => { if (drag.clicking) this.openDetails(rowAt(p.y)); });

    const bar = scene.add.zone(SCROLL.x - SCROLL_REACH, SCROLL.y, SCROLL.w + 2 * SCROLL_REACH, SCROLL.h).setOrigin(0)
      .setInteractive({ useHandCursor: true });
    dragThumb(scene, bar, SCROLL, () => this.thumb(), () => this.rows.length - this.list.rows, (row) => this.scrollTo(row));
    this.details = this.makeDetails();
  }

  /** Shows an item: its name (wrapped to fit, 2x), facts, card list (from the top) and price for one. */
  show(name: string, facts: string, rows: BoardRow[], unitPrice: number) {
    this.rows = rows;
    this.unitPrice = unitPrice;
    const wrapped = this.wrapName(name.toUpperCase());
    this.nameText.setText(wrapped);
    this.nameShadow.setText(wrapped);
    this.factsText.setText(facts);
    this.setQuantity(this.quantity);
    this.setStatus("");
    this.closeDetails();
    this.hovered = -1;
    this.scrollTo(0);
  }

  /** How many to buy at once: 1 to maxQuantity; the count and the total price follow. */
  setQuantity(n: number) {
    if (this.opts.busy()) return;
    this.quantity = Phaser.Math.Clamp(n, 1, this.opts.maxQuantity);
    // Centred on its glyphs (measure leaves out the font's trailing spacing, which `width` counts).
    const count = String(this.quantity);
    this.countText?.setText(count).setX(Math.round(BOTTOM.count - measure(this.scene, FONT_UI, count) / 2));
    const price = `${this.unitPrice * this.quantity} CHIPS`;
    this.priceText.setText(price);
    this.priceShadow.setText(price);
  }

  /** A line in the price's place for a moment ("": the price again). */
  setStatus(s: string, color = RUNEWOOD.panel.inkSoft) {
    this.statusTimer?.remove();
    this.statusText.setText(s).setTint(color);
    this.priceText.setVisible(!s);
    this.priceShadow.setVisible(!s);
    this.statusTimer = s ? this.scene.time.delayedCall(STATUS_MS, () => this.setStatus("")) : null;
  }

  get detailsOpen() {
    return this.details.root.visible;
  }

  closeDetails() {
    if (!this.details.root.visible) return;
    this.details.root.setVisible(false);
    this.details.info.clear();
  }

  /** The name in lines that fit the board at 2x, word by word. */
  private wrapName(name: string): string {
    const width = CONTENT.w / 2, lines: string[] = [];
    for (const word of name.split(" ")) {
      const last = lines.length - 1;
      if (last >= 0 && measure(this.scene, FONT_UI, `${lines[last]} ${word}`) <= width) lines[last] += ` ${word}`;
      else lines.push(word);
    }
    return lines.join("\n");
  }

  /** The scrollbar's thumb (top, height), or null when the whole list fits. */
  private thumb(): { y: number; h: number } | null {
    if (this.rows.length <= this.list.rows) return null;
    const h = Math.max(8, Math.round((SCROLL.h * this.list.rows) / this.rows.length));
    return { y: SCROLL.y + Math.round(((SCROLL.h - h) * this.scrollRow) / (this.rows.length - this.list.rows)), h };
  }

  /**
   * A listed card's details over the board, like the deck editor's: the duel's info panel (the UI theme's, like the
   * one a pack opens beside), CLOSE (Esc) under it. It swallows clicks on the board.
   */
  private makeDetails(): Details {
    const by = CONTENT.bottom - LIST_BUTTON_H;
    const info = new CardInfo(this.scene, this.engine, { x: CONTENT.x, w: CONTENT.w, top: INSET.board + 2, bottom: by - 4 });
    const close = makeListButton(this.scene, CONTENT.x + CONTENT.w - 48, by, 48, "CLOSE", () => this.closeDetails());
    const root = this.scene.add.container(0, 0, [
      this.scene.add.zone(BOARD.x, 0, BOARD.w, 360).setOrigin(0).setInteractive(),
      this.scene.add.nineslice(BOARD.x, 0, ui("info-frame"), undefined, BOARD.w, 360, ...THEME.panel.infoSlice).setOrigin(0),
      info.container, ...close,
    ]).setDepth(DETAILS_DEPTH).setVisible(false);
    return { root, info };
  }

  /** Opens list row `i`'s card in the details panel. */
  private openDetails(i: number) {
    const card = this.rows[i];
    if (!card || this.opts.busy()) return;
    this.details.info.show(card.code);
    this.details.root.setVisible(true);
    this.hover(-1);
  }

  /** Highlights list row `i` (-1: none). */
  private hover(i: number) {
    this.hovered = i >= 0 && i < this.rows.length ? i : -1;
    this.drawHover();
  }

  private drawHover() {
    const r = this.hovered - this.scrollRow;
    this.hoverBand.clear();
    if (this.hovered >= 0 && r >= 0 && r < this.list.rows) {
      this.hoverBand.fillStyle(RUNEWOOD.panel.paperInk, 0.12).fillRect(LIST.x - 1, LIST.y + r * this.list.rowH, LIST.w + 1, this.list.rowH);
    }
  }

  private scrollTo(row: number) {
    this.scrollRow = Phaser.Math.Clamp(row, 0, Math.max(0, this.rows.length - this.list.rows));
    if (this.chipRows) this.drawChipRows(this.chipRows);
    if (this.cardRows) this.drawCardRows(this.cardRows);
    // Scrollbar: the track, and the thumb for the rows in view (as the card text's scrollbar in the info panel: a faint
    // track, the thumb darker).
    this.scrollbar.clear();
    const t = this.thumb();
    if (t) {
      this.scrollbar.fillStyle(RUNEWOOD.panel.paperInk, 0.15).fillRect(SCROLL.x, SCROLL.y, SCROLL.w, SCROLL.h);
      this.scrollbar.fillStyle(RUNEWOOD.panel.paperInk, 0.6).fillRect(SCROLL.x, t.y, SCROLL.w, t.h);
    }
    this.drawHover();
  }

  /** The chip rows in view: each card's rarity chip and its name, cut to fit. */
  private drawChipRows({ boxes, labels, names }: ChipRows) {
    const nameW = LIST.w - CHIP.w - 4;
    boxes.clear();
    for (let r = 0; r < LIST.rows; r++) {
      const card = this.rows[this.scrollRow + r], chip = card?.chip;
      labels[r].setText(chip ? chip.label : "");
      labels[r].setX(Math.round(LIST.x + CHIP.w / 2 - labels[r].width / 2));
      names[r].setText(card ? fit(this.scene, FONT_UI, card.name.toUpperCase(), nameW) : "");
      if (chip) boxes.fillStyle(chip.color).fillRect(LIST.x, LIST.y + r * LIST.rowH + 1, CHIP.w, CHIP.h);
    }
  }

  /**
   * The card rows in view, drawn again: the deck editor's rows (`cardRow`: frame strip, art, name, type line, ATK /
   * DEF) with a line between them, the copies on the right of the name, the rarity chip (if any) on the right of the
   * ATK / DEF line.
   */
  private drawCardRows(into: Phaser.GameObjects.Container) {
    const ink = RUNEWOOD.panel.paperInk, soft = RUNEWOOD.panel.inkSoft, right = LIST.x + LIST.w - 2;
    into.removeAll(true);
    const g = this.scene.add.graphics();
    into.add(g);
    for (let i = 0; i < CARD_LIST.rows; i++) {
      const row = this.rows[this.scrollRow + i];
      if (!row) break;
      const y = LIST.y + i * CARD_LIST.rowH, r = this.engine.cards.records.get(row.code);
      if (i > 0) g.fillStyle(ink, 0.18).fillRect(LIST.x, y, LIST.w, 1);
      if (!r) continue;
      cardRow(this.scene, into, g, r, LIST.x, y, LIST.w, CARD_LIST.rowH, 14, ink, soft);
      if (row.copies) into.add(text(this.scene, right, y + 4, `x${row.copies}`, { color: ink, originX: 1 }));
      if (row.chip) {
        const cx = right + 1 - CHIP.w;
        g.fillStyle(row.chip.color).fillRect(cx, y + 23, CHIP.w, CHIP.h);
        const label = text(this.scene, 0, y + 24, row.chip.label, { color: 0xffffff });
        into.add(label.setX(Math.round(cx + CHIP.w / 2 - label.width / 2)));
      }
    }
  }
}
