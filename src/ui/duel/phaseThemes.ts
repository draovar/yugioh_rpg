// The phase column look: Runewood buttons from Crusenho's Complete UI Essential Pack (CC BY 4.0),
// imported by tools/import-ui.mjs and nine-sliced to 16x56.
//   clickable – light wood, raised    (you can move to this phase)
//   idle      – light wood, pressed   (not available right now)
//   current   – dark wood, pressed    (the phase the duel is in)

export type PhaseState = "idle" | "clickable" | "current";

export interface PhaseLook {
  /** Nine-slice insets (left, right, top, bottom) in the 32x21 source frame. */
  slice: [number, number, number, number];
  /** Label colour. */
  text: number;
  /** Label offset from the box centre, so it sits on the button face (raised faces are higher). */
  textDy: number;
}

export const PHASE_LOOK: Record<PhaseState, PhaseLook> = {
  // Raised: 5 rows of top rim, 7 rows of side below the face.
  clickable: { slice: [4, 4, 5, 7], text: 0x3b2414, textDy: -2 },
  // Pressed: 3 empty rows + 5 rows of rim on top, 4 rows of side below.
  idle: { slice: [4, 4, 8, 4], text: 0x7a4a2c, textDy: 1 },
  current: { slice: [4, 4, 8, 4], text: 0xf2c096, textDy: 1 },
};

/** Current-phase label colour by whose turn it is (the button itself stays dark wood). */
export const TURN_TEXT = { mine: 0x9fdcff, theirs: 0xff9a84 };
