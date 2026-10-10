// Modal overlays used by duel prompts: button dialogs and a card picker.
// The overlay covers the field and side panel but not the info panel, so hovering
// a card in a modal can still show its details on the left.
import Phaser from "phaser";
import type { CardDb } from "../../duel/cardData.ts";
import { FONT, makeButton } from "../widgets.ts";
import { CardSprite } from "./CardSprite.ts";
import { INFO_PANEL, PICK_CARD } from "./layout.ts";

const DEPTH = 1000;
const LEFT = INFO_PANEL.x + INFO_PANEL.w;
const WIDTH = 1280 - LEFT;
const MID_X = LEFT + WIDTH / 2;

export interface PickerCard {
  code: number;
  /** Small caption under the card (e.g. which effect). */
  caption?: string;
  /** Pre-selected and not toggleable (e.g. "must" cards of a sum selection). */
  locked?: boolean;
  /** Shown as selected initially. */
  selected?: boolean;
}

export interface PickerOptions {
  title: string;
  cards: PickerCard[];
  /**
   * "multi": toggle cards, then Confirm (enabled while `isValid` holds).
   * "single": the first click resolves immediately.
   */
  mode: "multi" | "single";
  isValid?: (selected: number[]) => boolean;
  onConfirm: (selected: number[]) => void;
  /** Extra buttons under the cards, e.g. Cancel / Finish / Don't chain. */
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

  /** A message with a row of buttons. Optional card shown above the text. */
  dialog(message: string, buttons: { label: string; onClick: () => void }[], code?: number): void {
    const s = this.scene;
    const root = this.open();
    const hasCard = !!code;
    const panelH = (hasCard ? 330 : 170) + (buttons.length > 3 ? 50 * Math.ceil(buttons.length / 3 - 1) : 0);
    root.add(this.panel(MID_X, 360, 520, panelH));
    let y = 360 - panelH / 2 + 24;
    if (hasCard) {
      root.add(new CardSprite(s, MID_X, y + 70, 100, 146).show(code!, this.cards.records.get(code!)));
      y += 160;
    }
    root.add(s.add.text(MID_X, y, message, { fontFamily: FONT, fontSize: "18px", color: "#ffffff", align: "center", wordWrap: { width: 480 } }).setOrigin(0.5, 0));
    const perRow = Math.min(3, buttons.length);
    buttons.forEach((b, i) => {
      const row = Math.floor(i / 3), col = i % 3;
      const n = Math.min(perRow, buttons.length - row * 3);
      const bx = MID_X + (col - (n - 1) / 2) * 160;
      const by = 360 + panelH / 2 - 36 - (Math.ceil(buttons.length / 3) - 1 - row) * 50;
      root.add(makeButton(s, bx, by, 150, 40, b.label, () => { this.close(); b.onClick(); }));
    });
  }

  picker(opts: PickerOptions): void {
    const s = this.scene;
    const root = this.open();
    const perRow = 9;
    const rows = Math.ceil(opts.cards.length / perRow);
    const cw = rows > 3 ? PICK_CARD.w * 0.75 : PICK_CARD.w;
    const ch = rows > 3 ? PICK_CARD.h * 0.75 : PICK_CARD.h;
    const pitchX = cw + 14, pitchY = ch + 34;
    const panelH = Math.min(700, 130 + rows * pitchY);
    const top = 360 - panelH / 2;
    root.add(this.panel(MID_X, 360, WIDTH - 30, panelH));
    root.add(s.add.text(MID_X, top + 16, opts.title, { fontFamily: FONT, fontSize: "18px", color: "#ffffff", align: "center", wordWrap: { width: WIDTH - 80 } }).setOrigin(0.5, 0));

    const selected = new Set(opts.cards.flatMap((c, i) => (c.selected || c.locked ? [i] : [])));
    const sprites: CardSprite[] = [];
    let confirm: ReturnType<typeof makeButton> | null = null;
    const refresh = () => {
      sprites.forEach((sp, i) => sp.setHighlight(selected.has(i) ? "selected" : "action"));
      confirm?.setEnabled(opts.isValid ? opts.isValid([...selected].sort((a, b) => a - b)) : true);
    };

    opts.cards.forEach((c, i) => {
      const row = Math.floor(i / perRow), col = i % perRow;
      const n = Math.min(perRow, opts.cards.length - row * perRow);
      const x = MID_X + (col - (n - 1) / 2) * pitchX;
      const y = top + 60 + ch / 2 + row * pitchY;
      const sp = new CardSprite(s, x, y, cw, ch).show(c.code, this.cards.records.get(c.code));
      sp.setInteractive({ useHandCursor: !c.locked });
      sp.on("pointerover", () => opts.onHover?.(c.code));
      sp.on("pointerup", () => {
        if (c.locked) return;
        if (opts.mode === "single") { this.close(); opts.onConfirm([i]); return; }
        if (selected.has(i)) selected.delete(i); else selected.add(i);
        refresh();
      });
      sprites.push(sp);
      const caption = c.caption ?? this.cards.name(c.code);
      root.add([sp, s.add.text(x, y + ch / 2 + 4, caption, {
        fontFamily: FONT, fontSize: "11px", color: "#dddddd", align: "center", wordWrap: { width: pitchX - 4 }, maxLines: 2,
      }).setOrigin(0.5, 0)]);
    });

    const buttons = [...(opts.buttons ?? [])];
    const by = top + panelH - 32;
    const all = opts.mode === "multi" ? [{ label: "Confirm", onClick: () => {} }, ...buttons] : buttons;
    all.forEach((b, i) => {
      const bx = MID_X + (i - (all.length - 1) / 2) * 170;
      if (opts.mode === "multi" && i === 0) {
        confirm = makeButton(s, bx, by, 150, 40, "Confirm", () => {
          this.close();
          opts.onConfirm([...selected].sort((a, b) => a - b));
        }, 0x2f7a3d);
        root.add(confirm);
      } else {
        root.add(makeButton(s, bx, by, 150, 40, b.label, () => { this.close(); b.onClick(); }));
      }
    });
    refresh();
  }

  private open(): Phaser.GameObjects.Container {
    this.close();
    const s = this.scene;
    const shade = s.add.rectangle(LEFT, 0, WIDTH, 720, 0x000000, 0.55).setOrigin(0).setInteractive();
    this.root = s.add.container(0, 0, [shade]).setDepth(DEPTH);
    return this.root;
  }

  private panel(x: number, y: number, w: number, h: number): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics();
    g.fillStyle(0x151a33, 0.97).fillRoundedRect(x - w / 2, y - h / 2, w, h, 10);
    g.lineStyle(2, 0x6c7bd1).strokeRoundedRect(x - w / 2, y - h / 2, w, h, 10);
    return g;
  }
}
