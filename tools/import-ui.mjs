// Copies each duel-screen theme's UI sprites from the Crusenho "Complete UI Essential Pack" (assets/,
// CC BY 4.0) into public/assets/ui/<theme>/<role>.png. The roles are UI_ROLES in src/ui/theme.ts; a role
// left out here (e.g. "star", drawn for this project) is a hand-made file kept in the theme's folder.
// The theme's nine-slice insets and colours live in src/ui/theme.ts.
// Usage: node tools/import-ui.mjs [theme...]   (default: every theme)
import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const PACK = path.join(ROOT, "assets/Complete_UI_Essential_Pack_v2.4");
const OUT = path.join(ROOT, "public/assets/ui");

/**
 * theme -> role -> [path inside the pack, trim?]. Button frames keep their full canvas (no trim) so
 * raised and pressed frames stay aligned: a pressed button sits lower inside the same box.
 */
const THEMES = {
  runewood: {
    // Phase column. a = light wood, b = dark wood; _4 = raised, _1 = pressed (32x21).
    "phase-clickable": ["13_Runewood_Theme/SpritesAnimated/UI_Runewood_Button02a_4.png", false],
    "phase-idle": ["13_Runewood_Theme/SpritesAnimated/UI_Runewood_Button02a_1.png", false],
    "phase-current": ["13_Runewood_Theme/SpritesAnimated/UI_Runewood_Button02b_1.png", false],
    // LP bars: a wooden frame with an inset track, and coloured fillers stretched inside it.
    "lp-frame": ["13_Runewood_Theme/Sprites/UI_Runewood_Bar01a.png", false],
    "lp-fill-green": ["13_Runewood_Theme/Sprites/UI_Runewood_BarFiller02b.png", false],
    "lp-fill-orange": ["13_Runewood_Theme/Sprites/UI_Runewood_BarFiller01a.png", false],
    "lp-fill-red": ["13_Runewood_Theme/Sprites/UI_Runewood_BarFiller02a.png", false],
    // Info panel: light wood board with a thick rim, cream paper inset behind long text.
    "panel-frame": ["13_Runewood_Theme/Sprites/UI_Runewood_Frame05b.png", false],
    "panel-paper": ["13_Runewood_Theme/Sprites/UI_Runewood_FrameBanner01a.png", false],
    // Attack declaration arrows (red): up when you attack, down when the opponent attacks.
    "attack-up": ["13_Runewood_Theme/SpritesColors/UI_Runewood_IconAlert03b.png", false],
    "attack-down": ["13_Runewood_Theme/SpritesColors/UI_Runewood_IconAlert04b.png", false],
    // Dark plates (card menu, stats, mat rim) and list-row buttons (c = darker row, on hover).
    "menu-back": ["13_Runewood_Theme/Sprites/UI_Runewood_Frame01a.png", false],
    "menu-button": ["13_Runewood_Theme/Sprites/UI_Runewood_FrameList09a.png", false],
    "menu-button-hover": ["13_Runewood_Theme/Sprites/UI_Runewood_FrameList09c.png", false],
  },
};

const wanted = process.argv.slice(2);
for (const [theme, sprites] of Object.entries(THEMES)) {
  if (wanted.length && !wanted.includes(theme)) continue;
  const dir = path.join(OUT, theme);
  mkdirSync(dir, { recursive: true });
  for (const [role, [file, trim]] of Object.entries(sprites)) {
    const img = sharp(path.join(PACK, file));
    const info = await (trim ? img.trim({ threshold: 0 }) : img).toFile(path.join(dir, `${role}.png`));
    console.log(`${theme}/${role}.png ${info.width}x${info.height}`);
  }
}
