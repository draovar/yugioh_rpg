// Duel-screen UI themes. A theme is the sprites for a fixed set of roles (tools/import-ui.mjs copies them
// from the UI pack into public/assets/ui/<theme>/<role>.png; Boot loads them as `ui-<role>`), the
// nine-slice insets and text offsets measured from those sprites, and the UI colours that go with them.
// Cards (frames, backs, attribute icons) and gameplay feedback (attack red, summon flashes) are not themed.
//
// Pick one with `&theme=NAME` (dev) or the "theme" localStorage key; switching needs a reload.

/** Every sprite role a theme provides (file `<role>.png`, texture key `ui-<role>`). */
export const UI_ROLES = [
  "phase-clickable", "phase-idle", "phase-current", // phase column buttons; also the small wood buttons
  "lp-frame", "lp-fill-green", "lp-fill-orange", "lp-fill-red", // LP bars; the frame also frames the info-panel art
  "panel-frame", "panel-paper", // info panel board, dialog / picker boards, paper inset
  "menu-back", "menu-button", "menu-button-hover", // dark plates (card menu, stats, mat rim) and list-row buttons
  "attack-up", "attack-down", "star",
] as const;
export type UiRole = (typeof UI_ROLES)[number];

export type PhaseState = "idle" | "clickable" | "current";
type Slice = readonly [number, number, number, number];

export interface PhaseLook {
  /** Nine-slice insets (left, right, top, bottom) in the source frame. */
  slice: Slice;
  /** Label colour. */
  text: number;
  /** Label offset from the box centre, so it sits on the button face (raised faces are higher). */
  textDy: number;
}

export interface Theme {
  name: string;
  /** Phase column buttons: clickable (raised), idle (pressed), current (pressed, dark). */
  phase: Record<PhaseState, PhaseLook>;
  /** Current-phase label colour by whose turn it is. */
  turnText: { mine: number; theirs: number };
  /** Small raised buttons (speed, LOG/CARD) made from the phase sprites: slices + label top per state. */
  woodButton: { raised: { slice: Slice; textY: number }; pressed: { slice: Slice; textY: number }; ink: number };
  /**
   * Info panel / dialog board ("panel-frame") and its paper inset ("panel-paper"). `cornerCut`: the board's
   * corners are cut in a staircase this many pixels deep (row 0 misses that many, row 1 one fewer...).
   */
  panel: { rim: number; paperRim: number; cornerCut: number; ink: number; inkSoft: number; paperInk: number };
  /** Dark plates ("menu-back"): rim, value text, label text. */
  plate: { rim: number; ink: number; inkSoft: number };
  /** Card name in the info panel: light text with a 1px drop shadow. */
  cardName: { ink: number; shadow: number };
  /** List-row buttons ("menu-button", "-hover"). */
  listButton: { h: number; slice: number; textY: number; ink: number; inkHover: number };
  /** LP bars: frame rim, filler per LP band (with its slices), label colours. */
  lpBar: {
    rim: number;
    fills: { min: number; role: UiRole; slice: Slice }[];
    label: number; shadow: number; loss: number; gain: number;
  };
  /** Prompt strip across the field. */
  prompt: { strip: number; stripAlpha: number; text: number };
  /** Table and playmat (field.ts). */
  field: { table: number; seam: number; felt: number; line: number; monster: number; label: number };
  /** Choosing cards / zones on the board. */
  pick: { choice: number; selected: number; zone: number; zoneAlpha: number; zoneHoverAlpha: number };
  /** Turn banner per player: band fill, its light top line (and turn number), dark bottom line (and text shadow). */
  banner: Record<"mine" | "theirs", { fill: number; light: number; dark: number }>;
  /** Darkening over the field while a dialog or picker is open. */
  shadeAlpha: number;
}

/**
 * Runewood (Crusenho's Complete UI Essential Pack, CC BY 4.0): light and dark wood, cream paper.
 * Insets are from the sprites' pixel rows (see tools/import-ui.mjs for the files).
 */
const RUNEWOOD: Theme = {
  name: "runewood",
  phase: {
    // Raised: 5 rows of top rim, 7 rows of side below the face.
    clickable: { slice: [4, 4, 5, 7], text: 0x3b2414, textDy: -2 },
    // Pressed: 3 empty rows + 5 rows of rim on top, 4 rows of side below.
    idle: { slice: [4, 4, 8, 4], text: 0x7a4a2c, textDy: 1 },
    current: { slice: [4, 4, 8, 4], text: 0xf2c096, textDy: 1 },
  },
  turnText: { mine: 0x9fdcff, theirs: 0xff9a84 },
  woodButton: { raised: { slice: [4, 4, 5, 7], textY: 5 }, pressed: { slice: [4, 4, 8, 4], textY: 8 }, ink: 0x3b2414 },
  panel: { rim: 9, paperRim: 4, cornerCut: 5, ink: 0x2a1408, inkSoft: 0x5a3018, paperInk: 0x2a1408 },
  plate: { rim: 3, ink: 0xf2c096, inkSoft: 0xb08a68 },
  cardName: { ink: 0xfbe8c8, shadow: 0x2a1408 },
  listButton: { h: 11, slice: 2, textY: 3, ink: 0x2a1408, inkHover: 0xf2c096 },
  lpBar: {
    rim: 3,
    fills: [
      { min: 0.5, role: "lp-fill-green", slice: [0, 0, 1, 0] },
      { min: 0.25, role: "lp-fill-orange", slice: [0, 0, 1, 1] },
      { min: 0, role: "lp-fill-red", slice: [0, 0, 1, 0] },
    ],
    label: 0xf6e3c4, shadow: 0x432925, loss: 0xff5040, gain: 0x7dff6a,
  },
  prompt: { strip: 0x171715, stripAlpha: 0.85, text: 0xffffff },
  field: { table: 0xf0d2af, seam: 0xcfae86, felt: 0x1d4636, line: 0x4f8a6c, monster: 0x225240, label: 0x6fa88a },
  pick: { choice: 0xffd400, selected: 0xff8a1e, zone: 0xffd400, zoneAlpha: 0.3, zoneHoverAlpha: 0.6 },
  banner: {
    mine: { fill: 0x1d6da0, light: 0x7cc4f0, dark: 0x0b2f47 },
    theirs: { fill: 0xa02020, light: 0xf08a7c, dark: 0x470b0b },
  },
  shadeAlpha: 0.5,
};

export const THEMES: Record<string, Theme> = { runewood: RUNEWOOD };

function chooseTheme(): Theme {
  let name: string | null = null;
  try {
    name = (import.meta.env.DEV ? new URLSearchParams(location.search).get("theme") : null) ?? localStorage.getItem("theme");
  } catch { /* no storage */ }
  return (name && THEMES[name]) || RUNEWOOD;
}

/** The theme in use (fixed for the page's lifetime). */
export const THEME: Theme = chooseTheme();

/** Texture key of a role's sprite. */
export const ui = (role: UiRole) => `ui-${role}`;
