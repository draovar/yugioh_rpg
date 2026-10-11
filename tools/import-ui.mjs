// Copies the UI sprites we use from the Crusenho "Complete UI Essential Pack" (assets/, CC BY 4.0)
// into public/assets/ui/, trimming transparent padding so they nine-slice cleanly.
// Add entries to SPRITES and rerun: node tools/import-ui.mjs
import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const PACK = path.join(ROOT, "assets/Complete_UI_Essential_Pack_v2.4");
const OUT = path.join(ROOT, "public/assets/ui");

/**
 * output name -> [path inside the pack, trim?]. Button frames keep their full canvas (no trim) so
 * raised and pressed frames stay aligned: a pressed button sits lower inside the same 32x21 box.
 */
const SPRITES = {
  // Phase column (Runewood). a = light wood, b = dark wood; _4 = raised, _1 = pressed.
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
};

mkdirSync(OUT, { recursive: true });
for (const [name, [file, trim]] of Object.entries(SPRITES)) {
  const img = sharp(path.join(PACK, file));
  const info = await (trim ? img.trim({ threshold: 0 }) : img).toFile(path.join(OUT, `${name}.png`));
  console.log(`${name}.png ${info.width}x${info.height}`);
}
