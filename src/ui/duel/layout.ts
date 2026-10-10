// Screen geometry for the duel board (1280x720).
//   [info panel 0-270] [field 270-1010] [side panel 1010-1280]
// The human is always at the bottom; the opponent's side is rotated 180°.

export const FIELD_CARD = { w: 64, h: 93 };
export const HAND_CARD = { w: 80, h: 116 };
export const PICK_CARD = { w: 80, h: 116 };

export const INFO_PANEL = { x: 0, w: 270 };
export const SIDE_PANEL = { x: 1012, w: 268 };

const CENTER_X = 640;
const PITCH = 84;
export const ROWS = { oppHand: 22, oppBack: 132, oppFront: 237, center: 313, myFront: 390, myBack: 495, myHand: 640 };

export type Slot =
  | { kind: "mzone"; seq: number }
  | { kind: "szone"; seq: number } // seq 5 = field zone
  | { kind: "grave" | "deck" | "extra" | "banished" };

/** `side` 0 = human (bottom), 1 = opponent (top). */
export function slotXY(side: 0 | 1, slot: Slot): { x: number; y: number } {
  let col: number, front: boolean;
  switch (slot.kind) {
    case "mzone": col = 1 + slot.seq; front = true; break;
    case "szone": [col, front] = slot.seq === 5 ? [0, true] : [1 + slot.seq, false]; break;
    case "grave": col = 6; front = true; break;
    case "deck": col = 6; front = false; break;
    case "extra": col = 0; front = false; break;
    case "banished": col = 7; front = true; break;
  }
  if (side === 1) col = 6 - col;
  const y = side === 0 ? (front ? ROWS.myFront : ROWS.myBack) : (front ? ROWS.oppFront : ROWS.oppBack);
  return { x: CENTER_X + (col - 3) * PITCH, y };
}

export const FIELD_CENTER_X = CENTER_X;

/** Position of card `i` of `n` in a hand. The human's hand uses larger cards. */
export function handXY(side: 0 | 1, i: number, n: number): { x: number; y: number; w: number; h: number } {
  const size = side === 0 ? HAND_CARD : FIELD_CARD;
  const pitch = Math.min(size.w + 8, 600 / Math.max(1, n));
  return {
    x: CENTER_X + (i - (n - 1) / 2) * pitch,
    y: side === 0 ? ROWS.myHand : ROWS.oppHand,
    w: size.w,
    h: size.h,
  };
}
