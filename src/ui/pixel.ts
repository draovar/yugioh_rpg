// Pixel-art UI helpers for the 640x360 game: bitmap text and crisp 1px shapes.
import Phaser from "phaser";

/** 3x5 game font (UI text, ATK/DEF digits). */
export const FONT_UI = "tiny5";
/** 3x3 font (card names on small cards). */
export const FONT_CARD = "nerds3";

export const INK = 0x171715;
export const INK_SOFT = 0x555555;
export const PAPER = 0xeeeeee;
export const WHITE = 0xffffff;

export interface TextOptions {
  font?: string;
  color?: number;
  /** Integer scale (2 = each font pixel becomes 2x2). */
  scale?: number;
  /** Word-wrap width in screen pixels. */
  maxWidth?: number;
  /** 0 = left, 0.5 = centre, 1 = right (horizontal origin). */
  originX?: number;
  originY?: number;
}

export function text(scene: Phaser.Scene, x: number, y: number, str: string, o: TextOptions = {}): Phaser.GameObjects.BitmapText {
  const scale = o.scale ?? 1;
  const t = scene.add.bitmapText(x, y, o.font ?? FONT_UI, str).setTint(o.color ?? INK).setScale(scale);
  if (o.maxWidth) t.setMaxWidth(Math.floor(o.maxWidth / scale));
  // Align via a rounded top-left corner instead of a fractional origin, so glyphs stay on whole pixels.
  t.setPosition(Math.round(x - t.width * (o.originX ?? 0)), Math.round(y - t.height * (o.originY ?? 0)));
  return t;
}

/** Width in font pixels of `str` (unscaled). */
export function measure(scene: Phaser.Scene, font: string, str: string): number {
  const data = scene.cache.bitmapFont.get(font)?.data as { chars: Record<number, { xAdvance: number }> } | undefined;
  if (!data) return str.length * 4;
  let w = 0;
  for (const ch of str) w += data.chars[ch.codePointAt(0)!]?.xAdvance ?? 0;
  return Math.max(0, w - 1); // no trailing spacing
}

/** Cuts `str` so it fits `maxWidth` font pixels. */
export function fit(scene: Phaser.Scene, font: string, str: string, maxWidth: number): string {
  let s = str;
  while (s.length && measure(scene, font, s) > maxWidth) s = s.slice(0, -1);
  return s.trimEnd();
}

/** 1px (or thicker) rectangle outline made of filled rects, so it stays pixel-crisp. */
export function border(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: number, t = 1, alpha = 1) {
  g.fillStyle(color, alpha);
  g.fillRect(x, y, w, t);
  g.fillRect(x, y + h - t, w, t);
  g.fillRect(x, y + t, t, h - 2 * t);
  g.fillRect(x + w - t, y + t, t, h - 2 * t);
}
