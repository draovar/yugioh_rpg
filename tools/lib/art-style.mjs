// How card art is turned into game pixels. Shared by build-art and build-palette so the palette
// is built from exactly what the game shows. Tweak here, then `npm run build-art`.
import { readFileSync } from "node:fs";

export const ART_STYLE = {
  /** 32x32 card-face art: stronger boost so shapes read at tiny size, no dithering. */
  small: { size: 32, saturation: 1.35, contrast: 1.15, brightness: -15, sharpen: 0.6, dither: 0 },
  /** 128x128 info-panel art: milder boost, light ordered dither to soften palette banding. */
  large: { size: 128, saturation: 1.2, contrast: 1.08, brightness: -8, sharpen: 0.5, dither: 32 },
};

/** Applies the saturation / contrast / sharpen boost of a style to a sharp pipeline. */
export function boost(img, s) {
  return img.modulate({ saturation: s.saturation }).linear(s.contrast, s.brightness).sharpen({ sigma: s.sharpen });
}

/** Reads a GIMP .gpl palette into [[r, g, b], ...]. */
export function readGpl(file) {
  return readFileSync(file, "utf-8").split(/\r?\n/)
    .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)/))
    .filter(Boolean)
    .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
}
