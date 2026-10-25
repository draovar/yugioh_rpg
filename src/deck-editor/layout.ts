import { CARD, INFO, INSET } from "../duel-screen/layout.ts";
import { LIST_BUTTON_H } from "../ui/widgets.ts";

/** The card list panel's left edge: it takes the info panel's place (and size) on the right. */
export const SPLIT = 640 - INFO.w;
/** Top bar (a plate with the deck buttons) and the mat under it, left of the list panel. */
export const BAR = { x: 4, y: 4, w: SPLIT - 8, h: LIST_BUTTON_H + 2 * INSET.plate };
export const MAT = { x: 4, y: BAR.y + BAR.h + 4, w: SPLIT - 8, h: 360 - (BAR.y + BAR.h + 4) - 4 };
export const FELT = { x: MAT.x + INSET.plate, y: MAT.y + INSET.plate, w: MAT.w - 2 * INSET.plate, h: MAT.h - 2 * INSET.plate };
/** Deck cards: 10 a row 1px apart (39 pitch), centred on the felt; Main Deck rows 2px apart. */
export const PITCH = CARD.w + 1;
export const GRID_W = 9 * PITCH + CARD.w;
export const GRID_X = FELT.x + Math.floor((FELT.w - GRID_W) / 2);
export const MAIN_LABEL_Y = FELT.y + 5;
export const MAIN_Y = MAIN_LABEL_Y + 10;
export const ROW_PITCH = CARD.h + 2;
export const EXTRA_LABEL_Y = MAIN_Y + 4 * ROW_PITCH + 6;
export const EXTRA_Y = EXTRA_LABEL_Y + 10;

/** List panel content (inside the board's rim, like the info panel). */
export const PANEL = { x: SPLIT + INSET.board + 2, w: INFO.w - 2 * (INSET.board + 2) };
export const SEARCH = { x: PANEL.x, y: INSET.board + 2, w: PANEL.w, h: 15 };
/** The search box's ALL / NAME toggle (inside the box, at its right end) and the clear X left of it. */
export const SCOPE = { w: 26, x: SEARCH.x + SEARCH.w - 2 - 26, y: SEARCH.y + 2 };
export const CLEAR_X = SCOPE.x - 12;
export const TOOLS_Y = SEARCH.y + SEARCH.h + 4;
/** The list: paper with `rows` rows, a scrollbar right of it. */
export const LIST = { x: PANEL.x, y: TOOLS_Y + LIST_BUTTON_H + 4, w: PANEL.w - 6, rowH: 34, rows: 8 };
export const LIST_H = LIST.rows * LIST.rowH + 2 * INSET.paper;
export const ROW_X = LIST.x + INSET.paper, ROW_W = LIST.w - 2 * INSET.paper;
export const SCROLL = { x: LIST.x + LIST.w + 2, y: LIST.y, w: 4, h: LIST_H };
export const STATUS_Y = LIST.y + LIST_H + 5;

/** Dialogs (rename, save / delete questions) over everything. */
export const OVERLAY_DEPTH = 3000;
