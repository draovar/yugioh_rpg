// Copies each duel-screen theme's UI sprites from the Crusenho "Complete UI Essential Pack" (assets/,
// CC BY 4.0) into public/assets/ui/<theme>/<role>.png. The roles are UI_ROLES in src/ui/theme.ts; a role
// left out here (e.g. Runewood's "star", drawn for this project) is a hand-made file kept in the folder.
// The theme's nine-slice insets and colours live in src/ui/theme.ts.
// Usage: node tools/art/import-ui.mjs [theme...]   (default: every theme)
import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PACK = path.join(ROOT, "assets/Complete_UI_Essential_Pack_v2.4");
const OUT = path.join(ROOT, "public/assets/ui");

/**
 * theme -> role -> [source, options]. The source is a path inside the pack, or "@<theme>/<file>" to copy
 * another theme's output (shared sprites). Options:
 *   trim     – cut transparent padding (button frames that must stay aligned keep their canvas)
 *   flatten  – [colours..., into]: repaint those colours with the last one (e.g. a frame's inner grid,
 *              which nine-slice stretching would distort)
 *   recolor  – paint every opaque pixel this colour (single-colour fillers in other colours)
 *   replace  – { from: to, ... }: swap exact colours (e.g. a frame's fill for another theme colour)
 */
/** The hologram frames' inner grid colours, flattened into the last one. */
const HOLO_GRID = ["#2b3961", "#2d3b63", "#2b3b68", "#29375f"];

const THEMES = {
  runewood: {
    // Phase column. a = light wood, b = dark wood; _4 = raised, _1 = pressed (32x21).
    "phase-clickable": ["13_Runewood_Theme/SpritesAnimated/UI_Runewood_Button02a_4.png"],
    "phase-idle": ["13_Runewood_Theme/SpritesAnimated/UI_Runewood_Button02a_1.png"],
    "phase-current": ["13_Runewood_Theme/SpritesAnimated/UI_Runewood_Button02b_1.png"],
    // LP bars: a wooden frame with an inset track, and coloured fillers stretched inside it.
    "lp-frame": ["13_Runewood_Theme/Sprites/UI_Runewood_Bar01a.png"],
    "lp-fill-green": ["13_Runewood_Theme/Sprites/UI_Runewood_BarFiller02b.png"],
    "lp-fill-orange": ["13_Runewood_Theme/Sprites/UI_Runewood_BarFiller01a.png"],
    "lp-fill-red": ["13_Runewood_Theme/Sprites/UI_Runewood_BarFiller02a.png"],
    // Info panel and dialogs: light wood board with a thick rim, cream paper inset behind long text.
    "info-frame": ["13_Runewood_Theme/Sprites/UI_Runewood_Frame05b.png"],
    "panel-frame": ["13_Runewood_Theme/Sprites/UI_Runewood_Frame05b.png"],
    "panel-paper": ["13_Runewood_Theme/Sprites/UI_Runewood_FrameBanner01a.png"],
    // Attack declaration arrows (red): up when you attack, down when the opponent attacks.
    "attack-up": ["13_Runewood_Theme/SpritesColors/UI_Runewood_IconAlert03b.png"],
    "attack-down": ["13_Runewood_Theme/SpritesColors/UI_Runewood_IconAlert04b.png"],
    // Dark plates (card menu, stats, mat rim) and list-row buttons (c = darker row, on hover).
    "menu-back": ["13_Runewood_Theme/Sprites/UI_Runewood_Frame01a.png"],
    "menu-button": ["13_Runewood_Theme/Sprites/UI_Runewood_FrameList09a.png"],
    "menu-button-hover": ["13_Runewood_Theme/Sprites/UI_Runewood_FrameList09c.png"],
    // Unused by the mat layout; the plate sprite stands in.
    "zone-monster": ["13_Runewood_Theme/Sprites/UI_Runewood_Frame01a.png"],
    // Card action menu: the dark wood frame (as the plates).
    "card-menu": ["13_Runewood_Theme/Sprites/UI_Runewood_Frame01a.png"],
  },
  hologram: {
    // Phase column: small bevelled buttons (32x19 trimmed). Release = clickable, Lock = idle (plain),
    // Press = current (solid light cyan). Same shape in every state, so labels don't move.
    "phase-clickable": ["06_Hologram_Theme/Sprites/UI_Hologram_Button_Small_Release_01a1.png", { trim: true }],
    "phase-idle": ["06_Hologram_Theme/Sprites/UI_Hologram_Button_Small_Lock_01a1.png", { trim: true }],
    "phase-current": ["06_Hologram_Theme/Sprites/UI_Hologram_Button_Small_Press_01a1.png", { trim: true }],
    // LP bars: rounded outline bar (29x14) and the solid cyan filler (32x9), recoloured per LP band.
    "lp-frame": ["06_Hologram_Theme/Sprites/UI_Hologram_Fillbar_02a.png", { trim: true }],
    // Theme cyan while healthy, a deeper blue below half, red when low.
    "lp-fill-green": ["06_Hologram_Theme/Sprites/UI_Hologram_Fillbar_Filler_04a.png", { trim: true }],
    "lp-fill-orange": ["06_Hologram_Theme/Sprites/UI_Hologram_Fillbar_Filler_04a.png", { trim: true, recolor: "#2f8fe0" }],
    "lp-fill-red": ["06_Hologram_Theme/Sprites/UI_Hologram_Fillbar_Filler_04a.png", { trim: true, recolor: "#ff4050" }],
    // Info panel: the notched frame. Dialogs: the plain navy frame with a 2px cyan rim. Inner grids
    // flattened. The paper inset is the square outline bar (navy, 1px cyan line inside).
    "info-frame": ["06_Hologram_Theme/Sprites/UI_Hologram_Frame_Standard_02a.png", { flatten: HOLO_GRID }],
    "panel-frame": ["06_Hologram_Theme/Sprites/UI_Hologram_Frame_Standard_01a.png", { flatten: HOLO_GRID }],
    "panel-paper": ["06_Hologram_Theme/Sprites/UI_Hologram_Fillbar_03a.png", { trim: true }],
    // Plates: the "available" slot (28x28, rounded, cyan line). List rows: the square outline bar,
    // solid cyan on hover.
    "menu-back": ["06_Hologram_Theme/Sprites/UI_Hologram_Slot_Available_01a.png", { trim: true }],
    "menu-button": ["06_Hologram_Theme/Sprites/UI_Hologram_Fillbar_03a.png", { trim: true }],
    "menu-button-hover": ["06_Hologram_Theme/Sprites/UI_Hologram_Fillbar_Filler_04a.png", { trim: true }],
    // Open field: monster zones are the cyan slot ("menu-back") with its centre in the lighter blue of the
    // paper inset (the info panel's description box); the other zones use the plain slot.
    "zone-monster": ["06_Hologram_Theme/Sprites/UI_Hologram_Slot_Available_01a.png", { trim: true, replace: { "#1d2d51": "#2c416d" } }],
    // Card action menu: the small square frame (straight edges, 2px cyan rim, inner grid flattened).
    "card-menu": ["06_Hologram_Theme/Sprites/UI_Hologram_Frame_Lite_01a.png", { flatten: HOLO_GRID }],
    // No hologram versions: Runewood's red attack arrows and the level star.
    "attack-up": ["@runewood/attack-up.png"],
    "attack-down": ["@runewood/attack-down.png"],
    "star": ["@runewood/star.png"],
  },
};

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

/** Applies flatten / recolor / replace on raw RGBA pixels. */
async function repaint(img, { flatten, recolor, replace }) {
  const { data, info } = await img.raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const from = (flatten ?? []).slice(0, -1).map(hex), into = flatten && hex(flatten.at(-1)), paint = recolor && hex(recolor);
  const swaps = Object.entries(replace ?? {}).map(([a, b]) => [hex(a), hex(b)]);
  const same = (i, [r, g, b]) => data[i] === r && data[i + 1] === g && data[i + 2] === b;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    if (paint) [data[i], data[i + 1], data[i + 2]] = paint;
    else if (from.some((c) => same(i, c))) [data[i], data[i + 1], data[i + 2]] = into;
    else {
      const swap = swaps.find(([a]) => same(i, a));
      if (swap) [data[i], data[i + 1], data[i + 2]] = swap[1];
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
}

const wanted = process.argv.slice(2);
for (const [theme, sprites] of Object.entries(THEMES)) {
  if (wanted.length && !wanted.includes(theme)) continue;
  const dir = path.join(OUT, theme);
  mkdirSync(dir, { recursive: true });
  for (const [role, [src, opts = {}]] of Object.entries(sprites)) {
    const file = src.startsWith("@") ? path.join(OUT, src.slice(1)) : path.join(PACK, src);
    // Trim first (from the file, so the result is a fresh buffer), then repaint.
    let img = sharp(opts.trim ? await sharp(file).trim({ threshold: 0 }).png().toBuffer() : file);
    if (opts.flatten || opts.recolor || opts.replace) img = await repaint(img, opts);
    const info = await img.png().toFile(path.join(dir, `${role}.png`));
    console.log(`${theme}/${role}.png ${info.width}x${info.height}`);
  }
}
