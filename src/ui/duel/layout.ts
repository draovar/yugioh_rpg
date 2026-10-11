// Duel screen geometry at the native 640x360 resolution, taken from docs/layout-sketch.png.
//   [info panel 0-223] [phase column 230-245] [field 250-640]
// The human is at the bottom; the opponent's side is mirrored.

/** Every card (hand, field, piles) is 38x56 including its 1px outline. */
export const CARD = { w: 38, h: 56 };

export const INFO = { x: 0, w: 224 };
export const PHASE_COL = { x: 230, w: 16, h: 56, top: 2, pitch: 60 };
export const FIELD = { left: 250, right: 640 };
/** Centre of the playing field (activation zoom, banners). */
export const FIELD_CENTER = { x: 444, y: 180 };

/** Zone column centres, left to right, from the human's point of view. */
const COLS = [328, 386, 444, 502, 560];
const PILE_LEFT = 275;
const PILE_RIGHT = 614;
export const ROWS = { oppHand: 29, oppBack: 91, oppFront: 149, myFront: 211, myBack: 269, myHand: 331 };

export type Slot =
  | { kind: "mzone"; seq: number }
  | { kind: "szone"; seq: number } // seq 5 = field zone
  | { kind: "grave" | "deck" | "extra" | "banished" };

/** `side` 0 = human (bottom), 1 = opponent (top, mirrored). */
export function slotXY(side: 0 | 1, slot: Slot): { x: number; y: number } {
  const mine = side === 0;
  const front = mine ? ROWS.myFront : ROWS.oppFront;
  const back = mine ? ROWS.myBack : ROWS.oppBack;
  const col = (seq: number) => COLS[mine ? seq : 4 - seq];
  const left = mine ? PILE_LEFT : PILE_RIGHT;
  const right = mine ? PILE_RIGHT : PILE_LEFT;
  switch (slot.kind) {
    case "mzone": return { x: col(slot.seq), y: front };
    case "szone": return slot.seq === 5 ? { x: left, y: front } : { x: col(slot.seq), y: back };
    case "extra": return { x: left, y: back };
    case "grave": case "banished": return { x: right, y: front };
    case "deck": return { x: right, y: back };
  }
}

/** Card `i` of `n` in a hand: 40px apart, squeezed when the hand gets large. */
export function handXY(side: 0 | 1, i: number, n: number): { x: number; y: number } {
  const span = 376 - CARD.w; // usable width between the pile columns
  const pitch = n > 1 ? Math.min(40, Math.floor(span / (n - 1))) : 0;
  return { x: Math.round(FIELD_CENTER.x + (i - (n - 1) / 2) * pitch), y: side === 0 ? ROWS.myHand : ROWS.oppHand };
}
