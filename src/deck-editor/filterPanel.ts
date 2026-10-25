import Phaser from "phaser";
import { toggleFilter, type FilterGroup, type FilterState } from "../duel/decks/deckRules.ts";
import { INSET } from "../duel-screen/layout.ts";
import { text } from "../ui/pixel.ts";
import { THEME, ui } from "../ui/theme.ts";
import { LIST_BUTTON_H, makeListButton } from "../ui/widgets.ts";
import { LIST, LIST_H, PANEL } from "./layout.ts";

/** Filter buttons on a grid of this many equal columns (long labels take two cells); 0 = each as wide as its label. */
const FILTER_COLUMNS = 5;

export interface FilterPanelHost {
  groups: FilterGroup[];
  /** The current filters (RESET replaces the map). */
  filters(): FilterState;
  /** A pick changed: run the search again. */
  changed(): void;
  reset(): void;
  done(): void;
}

/**
 * The filters, in the list's place (search, SORT and the match count stay, and update live): per group its name, then
 * its options as toggle buttons, wrapping (on a grid: FILTER_COLUMNS). Nothing picked in a group = any; one-value groups
 * (`single`: CARD, ATTRIBUTE, LEVEL, TYPE, SPELL/TRAP) keep one pick, MONSTER picks are alternatives (EFFECT or FLIP);
 * groups combine (FIRE and LEVEL 4). RESET clears them all; DONE, the FILTERS button or Esc goes back to the list.
 */
export function createFilterPanel(scene: Phaser.Scene, host: FilterPanelHost): Phaser.GameObjects.Container {
  const root = scene.add.container(0, 0).setDepth(10);
  // Covers the list and its scrollbar, and swallows their clicks.
  root.add(scene.add.zone(PANEL.x, LIST.y, PANEL.w, LIST_H).setOrigin(0).setInteractive());
  const ps = THEME.panel.paperSlice;
  root.add(scene.add.nineslice(PANEL.x, LIST.y, ui("panel-paper"), undefined, PANEL.w, LIST_H, ps, ps, ps, ps).setOrigin(0));
  const pad = INSET.paper + 2, left = PANEL.x + pad, right = PANEL.x + PANEL.w - pad;
  const gap = 2, pitch = LIST_BUTTON_H + 2;
  const cell = Math.floor((right - left - (FILTER_COLUMNS - 1) * gap) / Math.max(1, FILTER_COLUMNS));
  const textWidth = (s: string) => {
    const t = text(scene, 0, 0, s);
    const w = t.width;
    t.destroy();
    return w;
  };
  let y = LIST.y + pad;
  const redraw: (() => void)[] = [];
  for (const g of host.groups) {
    root.add(text(scene, left, y, g.label, { color: THEME.panel.inkSoft }));
    y += 7;
    // Grid: each button one cell, or two for a label too long for one; a button goes in the first line of its group
    // with room (so a short one can fill a gap a long one left). Else buttons as wide as their labels, in order.
    const used: number[] = [];
    let x = left, lines = 1;
    // A group whose labels all fit half a cell (LEVEL) gets half cells, twice as many a line, on the same columns.
    const half = Math.floor((cell - gap) / 2);
    const halves = g.options.every((o) => textWidth(o.label) + 4 <= half);
    const unit = halves ? half : cell, columns = halves ? 2 * FILTER_COLUMNS : FILTER_COLUMNS;
    for (const o of g.options) {
      let bx: number, by: number, w: number;
      if (FILTER_COLUMNS) {
        const span = textWidth(o.label) + 4 > unit ? 2 : 1;
        let line = used.findIndex((n) => n + span <= columns);
        if (line < 0) line = used.push(0) - 1;
        bx = left + used[line] * (unit + gap);
        by = y + line * pitch;
        w = span * unit + (span - 1) * gap;
        used[line] += span;
        lines = used.length;
      } else {
        w = textWidth(o.label) + 8;
        if (x > left && x + w > right) { x = left; lines++; }
        bx = x;
        by = y + (lines - 1) * pitch;
        x += w + gap;
      }
      const picked = () => host.filters().get(g.label)?.has(o.label) ?? false;
      const button = makeListButton(scene, bx, by, w, o.label, () => {
        toggleFilter(host.filters(), g, o.label);
        for (const r of redraw) r();
        host.changed();
      });
      button.setHighlighted(picked());
      redraw.push(() => button.setHighlighted(picked()));
      root.add(button);
    }
    y += lines * pitch + 3;
  }
  const by = LIST.y + LIST_H - pad - LIST_BUTTON_H, bw = Math.floor((right - left - 4) / 2);
  root.add(makeListButton(scene, left, by, bw, "RESET", () => {
    host.reset();
    for (const r of redraw) r();
    host.changed();
  }));
  root.add(makeListButton(scene, right - bw, by, bw, "DONE", () => host.done()));
  return root;
}
