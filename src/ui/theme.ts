// Duel-screen UI themes (runewood, hologram). Positions and sizes are global (layout.ts: INSET,
// LIST_BUTTON); a theme only changes the look:
//   - template: "mat" (a framed playmat, Runewood) or "open" (zones straight on the table, Hologram)
//   - sprites for a fixed set of roles (tools/art/import-ui.mjs copies them from the UI pack into
//     public/assets/ui/<theme>/<role>.png; Boot loads them as `ui-<role>`), described by the nine-slice
//     insets and button-face text offsets measured from them
//   - the UI colours and the table pattern
// Cards (frames, backs, attribute icons) and gameplay feedback (attack red, summon flashes) are not themed.
//
// Pick one with `&theme=NAME` (dev) or the world menu's THEME buttons (`setTheme`, saved in localStorage).

import type Phaser from "phaser";

/** Every sprite role a theme provides (file `<role>.png`, texture key `ui-<role>`). */
export const UI_ROLES = [
  "phase-clickable", "phase-idle", "phase-current", // phase column buttons; also the small wood buttons
  "lp-frame", "lp-fill-green", "lp-fill-orange", "lp-fill-red", // LP bars; the frame also frames the info-panel art
  "info-frame", // the info panel's board (fixed 224x360, so it can be an ornate frame)
  "panel-frame", "panel-paper", // dialog / picker boards, paper inset (description, log)
  "menu-back", "menu-button", "menu-button-hover", // dark plates (card menu, stats, mat rim) and list-row buttons
  "attack-up", "attack-down", "star",
  "zone-monster", // monster zones in the "open" template (the other zones use "menu-back")
  "card-menu", // the card-sized frame a card flips to for its action menu
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

/**
 * Field templates: "mat" = a framed felt playmat over the four zone rows, zones outlined on it (uses the
 * felt / line / monster colours); "open" = no mat, each zone a card-sized sprite on the table ("zone-monster"
 * for monster zones, "menu-back" for the rest).
 */
export type FieldTemplate = "mat" | "open";

export interface Theme {
  name: string;
  template: FieldTemplate;
  /** Phase column buttons: clickable (raised), idle (pressed), current (pressed, dark). */
  phase: Record<PhaseState, PhaseLook>;
  /** Current-phase label colour by whose turn it is. */
  turnText: { mine: number; theirs: number };
  /** Small raised buttons (speed, LOG/CARD, chain mode) made from the phase sprites: slices + label top per state. */
  woodButton: { raised: { slice: Slice; textY: number }; pressed: { slice: Slice; textY: number }; ink: number };
  /**
   * Boards and paper: nine-slice insets of the info panel's frame ("info-frame"), the dialog / picker board
   * ("panel-frame") and the paper inset ("panel-paper"); text colours (`error`: refusals, limits reached, on board or paper).
   */
  panel: { infoSlice: Slice; slice: number; paperSlice: number; ink: number; inkSoft: number; paperInk: number; error: number };
  /** Plates ("menu-back", also open-template zones): nine-slice inset; value / label text. */
  plate: { slice: number; ink: number; inkSoft: number };
  /** The card action menu's frame ("card-menu"): nine-slice inset. */
  cardMenu: { slice: number };
  /** Card name in the info panel: light text with a 1px drop shadow. */
  cardName: { ink: number; shadow: number };
  /** List-row buttons ("menu-button", "-hover"): nine-slice inset, label colours. */
  listButton: { slice: number; ink: number; inkHover: number };
  /** LP bars: the frame's nine-slice inset, filler per LP band (with its slices), label colours. */
  lpBar: {
    slice: number;
    fills: { min: number; role: UiRole; slice: Slice }[];
    label: number; shadow: number; loss: number; gain: number;
  };
  /** Prompt strip across the field. */
  prompt: { strip: number; stripAlpha: number; text: number };
  /** Table (pattern: wooden planks, or a blueprint grid of 8px cells) and the mat template's colours. */
  field: { table: number; seam: number; pattern: "planks" | "grid"; felt: number; line: number; monster: number; label: number };
  /** Choosing cards / zones on the board. */
  pick: { choice: number; selected: number; zone: number; zoneAlpha: number; zoneHoverAlpha: number };
  /** Turn banner per player: band fill, its light top line (and turn number), dark bottom line (and text shadow). */
  banner: Record<"mine" | "theirs", { fill: number; light: number; dark: number }>;
  /** Darkening over the field while a dialog or picker is open. */
  shadeAlpha: number;
}

/**
 * Runewood (Crusenho's Complete UI Essential Pack, CC BY 4.0): light and dark wood, cream paper.
 * Insets are from the sprites' pixel rows (see tools/art/import-ui.mjs for the files).
 */
const RUNEWOOD: Theme = {
  name: "runewood",
  template: "mat",
  phase: {
    // Raised: 5 rows of top rim, 7 rows of side below the face.
    clickable: { slice: [4, 4, 5, 7], text: 0x3b2414, textDy: -2 },
    // Pressed: 3 empty rows + 5 rows of rim on top, 4 rows of side below.
    idle: { slice: [4, 4, 8, 4], text: 0x7a4a2c, textDy: 1 },
    current: { slice: [4, 4, 8, 4], text: 0xf2c096, textDy: 1 },
  },
  turnText: { mine: 0x9fdcff, theirs: 0xff9a84 },
  woodButton: { raised: { slice: [4, 4, 5, 7], textY: 5 }, pressed: { slice: [4, 4, 8, 4], textY: 8 }, ink: 0x3b2414 },
  panel: { infoSlice: [9, 9, 9, 9], slice: 9, paperSlice: 4, ink: 0x2a1408, inkSoft: 0x5a3018, paperInk: 0x2a1408, error: 0xc02818 },
  plate: { slice: 3, ink: 0xf2c096, inkSoft: 0xb08a68 },
  cardMenu: { slice: 3 },
  cardName: { ink: 0xfbe8c8, shadow: 0x2a1408 },
  listButton: { slice: 2, ink: 0x2a1408, inkHover: 0xf2c096 },
  lpBar: {
    slice: 3,
    fills: [
      { min: 0.5, role: "lp-fill-green", slice: [0, 0, 1, 0] },
      { min: 0.25, role: "lp-fill-orange", slice: [0, 0, 1, 1] },
      { min: 0, role: "lp-fill-red", slice: [0, 0, 1, 0] },
    ],
    label: 0xf6e3c4, shadow: 0x432925, loss: 0xff5040, gain: 0x7dff6a,
  },
  prompt: { strip: 0x171715, stripAlpha: 0.85, text: 0xffffff },
  field: { table: 0xf0d2af, seam: 0xcfae86, pattern: "planks", felt: 0x1d4636, line: 0x4f8a6c, monster: 0x225240, label: 0x6fa88a },
  pick: { choice: 0xffd400, selected: 0xff8a1e, zone: 0xffd400, zoneAlpha: 0.3, zoneHoverAlpha: 0.6 },
  banner: {
    mine: { fill: 0x1d6da0, light: 0x7cc4f0, dark: 0x0b2f47 },
    theirs: { fill: 0xa02020, light: 0xf08a7c, dark: 0x470b0b },
  },
  shadeAlpha: 0.5,
};

/**
 * Hologram (same pack): dark navy panels with 2px cyan outlines, bevelled buttons that turn solid light cyan
 * when current/hovered. Light cyan text on navy; a dark navy table with a deep teal mat. Insets from the
 * trimmed sprites (tools/art/import-ui.mjs).
 */
const HOLOGRAM: Theme = {
  name: "hologram",
  template: "open",
  phase: {
    // 32x19 bevelled buttons: 6px bevels top-left / bottom-right; all states share the shape.
    clickable: { slice: [7, 7, 7, 7], text: 0xb7ffff, textDy: 0 },
    idle: { slice: [7, 7, 7, 7], text: 0x4a6a9a, textDy: 0 },
    current: { slice: [7, 7, 7, 7], text: 0x1a2a50, textDy: 0 },
  },
  // Current-phase label on the light cyan button: dark blue / dark red.
  turnText: { mine: 0x0b3a8a, theirs: 0x8a1020 },
  woodButton: { raised: { slice: [7, 7, 7, 7], textY: 6 }, pressed: { slice: [7, 7, 7, 7], textY: 6 }, ink: 0xb7ffff },
  panel: {
    // Info frame (Frame_Standard_02a): notched tabs along every edge, so it only stretches in plain runs of
    // edge (x 77-90, y 72-90 of the 96x96 sprite) and every notch keeps its size.
    infoSlice: [77, 6, 72, 6], slice: 2, paperSlice: 2,
    ink: 0xb7ffff, inkSoft: 0x5a8ac0, paperInk: 0xd8f8ff, error: 0xff6070,
  },
  // Slot Available: 4px border (glow, cyan line, inner ring); content (inset 3) may overlap the inner ring.
  plate: { slice: 4, ink: 0xb7ffff, inkSoft: 0x5a8ac0 },
  // Frame Lite: straight edges, 2px cyan rim.
  cardMenu: { slice: 2 },
  cardName: { ink: 0xe8ffff, shadow: 0x0a1430 },
  listButton: { slice: 2, ink: 0xb7ffff, inkHover: 0x1a2a50 },
  lpBar: {
    slice: 3,
    fills: [
      { min: 0.5, role: "lp-fill-green", slice: [1, 1, 1, 1] },
      { min: 0.25, role: "lp-fill-orange", slice: [1, 1, 1, 1] },
      { min: 0, role: "lp-fill-red", slice: [1, 1, 1, 1] },
    ],
    label: 0xe8ffff, shadow: 0x0a1430, loss: 0xff5060, gain: 0x7dff9a,
  },
  prompt: { strip: 0x0a1430, stripAlpha: 0.85, text: 0xb7ffff },
  field: { table: 0x111a33, seam: 0x1a2850, pattern: "grid", felt: 0x0e2a3c, line: 0x1fa0c0, monster: 0x123448, label: 0x3fb8d8 },
  pick: { choice: 0xffd400, selected: 0xff8a1e, zone: 0xffd400, zoneAlpha: 0.3, zoneHoverAlpha: 0.6 },
  banner: {
    mine: { fill: 0x0f5e9e, light: 0x6fe0ff, dark: 0x061a33 },
    theirs: { fill: 0x9e1030, light: 0xff7a90, dark: 0x33060f },
  },
  shadeAlpha: 0.55,
};

export const THEMES: Record<string, Theme> = { runewood: RUNEWOOD, hologram: HOLOGRAM };

function chooseTheme(): Theme {
  let name: string | null = null;
  try {
    name = (import.meta.env.DEV ? new URLSearchParams(location.search).get("theme") : null) ?? localStorage.getItem(THEME_KEY);
  } catch { /* no storage */ }
  return (name && THEMES[name]) || RUNEWOOD;
}

const THEME_KEY = "theme";

/**
 * The theme in use. Always this one object: `setTheme` swaps its contents, so read it when drawing and
 * never copy its values into module-level constants.
 */
export const THEME: Theme = { ...chooseTheme() };

/** Queues the current theme's UI sprites (public/assets/ui/<theme>/, from tools/art/import-ui.mjs). */
export function loadThemeSprites(load: Phaser.Loader.LoaderPlugin): void {
  for (const role of UI_ROLES) load.image(ui(role), `assets/ui/${THEME.name}/${role}.png`);
}

/**
 * Switches theme without a reload: saves the choice, swaps THEME's contents and reloads the `ui-*`
 * textures; resolves once they're loaded. Only while nothing themed is on screen (the world map).
 */
export function setTheme(scene: Phaser.Scene, name: string): Promise<void> {
  try { localStorage.setItem(THEME_KEY, name); } catch { /* storage unavailable */ }
  Object.assign(THEME, THEMES[name]);
  for (const role of UI_ROLES) scene.textures.remove(ui(role));
  return new Promise((resolve) => {
    scene.load.once("complete", () => resolve());
    loadThemeSprites(scene.load);
    scene.load.start();
  });
}

/** Texture key of a role's sprite. */
export const ui = (role: UiRole) => `ui-${role}`;
