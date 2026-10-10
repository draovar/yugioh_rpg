// Modal overlays used by duel prompts: button dialogs and a (paged) card picker.
// They cover the field but not the info panel, so hovering a card in a modal still shows it.
import Phaser from "phaser";
import type { CardDb } from "../../duel/cardData.ts";
import { FONT_CARD, INK, WHITE, border, fit, text } from "../pixel.ts";
import { makeButton } from "../widgets.ts";
import { CardSprite } from "./CardSprite.ts";
import { CARD, DIVIDER } from "./layout.ts";

const DEPTH = 1000;
const LEFT = DIVIDER.x + DIVIDER.w;
const WIDTH = 640 - LEFT;
const MID_X = LEFT + Math.floor(WIDTH / 2);
const PANEL = 0x1b2147;

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

  /** A message with a row of buttons, optionally showing a card (at 2x) above the text. */
  dialog(message: string, buttons: { label: string; onClick: () => void }[], code?: number): void {
    const s = this.scene;
    const root = this.open();
    const w = 260;
    const body = text(s, 0, 0, message, { color: WHITE, maxWidth: w - 16 });
    const cardH = code ? CARD.h * 2 + 8 : 0;
    const rows = Math.ceil(buttons.length / 3);
    const h = 10 + cardH + body.height + 10 + rows * 16 + 6;
    const top = 180 - Math.floor(h / 2);
    root.add(this.panel(MID_X - w / 2, top, w, h));
    let y = top + 8;
    if (code) {
      const card = new CardSprite(s, MID_X, y + CARD.h).show(code, this.cards.records.get(code)).setScale(2);
      root.add(card);
      y += cardH;
    }
    body.setPosition(Math.round(MID_X - body.width / 2), y);
    root.add(body);
    y += body.height + 10;
    buttons.forEach((b, i) => {
      const row = Math.floor(i / 3), col = i % 3;
      const n = Math.min(3, buttons.length - row * 3);
      root.add(makeButton(s, MID_X + (col - (n - 1) / 2) * 82, y + 6 + row * 16, 78, 13, b.label, () => { this.close(); b.onClick(); }));
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
      const refresh = () => {
        for (const [i, sp] of sprites) sp.setHighlight(selected.has(i) ? "selected" : opts.cards[i].locked ? "none" : "action");
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
        sp.on("pointerup", () => {
          if (c.locked) return;
          if (opts.mode === "single") { this.close(); opts.onConfirm([i]); return; }
          if (selected.has(i)) selected.delete(i); else selected.add(i);
          refresh();
        });
        sprites.set(i, sp);
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
