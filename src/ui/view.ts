import Phaser from "phaser";

import { worldZoom } from "./prefs.ts";

/** Native resolution: the duel screen, deck editor, lobby and loading screen are laid out in it. */
export const WIDTH = 640, HEIGHT = 360;

/**
 * "fixed": the 640x360 layout, scaled up as far as the window allows (whole numbers from 2x on, so every game pixel
 * stays square). "world" (the overworld): drawn at the world menu's ZOOM (2x by default, `worldZoom()`), and a bigger
 * window shows more of the map instead of bigger sprites; the view also takes the window's shape (no bars at the
 * sides of a wide phone).
 */
export type ViewMode = "fixed" | "world";
let mode: ViewMode = "fixed";

/**
 * The game size and zoom (CSS pixels per game pixel) for the window. Windows too small for 2x get a fractional, still
 * nearest-neighbour, fit, and below 1x too (a phone in landscape with the browser bar showing can be under 360 CSS
 * pixels tall), so the whole layout is always visible. From 2x on the zoom is a whole number of physical pixels
 * (`devicePixelRatio`: at 125% Windows display scaling a plain 2x would be 2.5 screen pixels, some game pixels 2
 * wide and some 3). A ZOOM bigger than the window has room for gets the biggest that fits.
 */
export function viewSize(m: ViewMode) {
  const w = window.innerWidth, h = window.innerHeight, dpr = window.devicePixelRatio || 1;
  const fit = Math.min(w / WIDTH, h / HEIGHT), fitted = Math.floor(fit * dpr);
  const chosen = m === "fixed" ? "auto" : worldZoom();
  const zoom = fit < 2 ? fit : Math.max(1, chosen === "auto" ? fitted : Math.min(Math.floor(chosen * dpr), fitted)) / dpr;
  if (m === "fixed") return { width: WIDTH, height: HEIGHT, zoom };
  // Never under the native size (the overworld's HUD is laid out for at least that much).
  return { width: Math.max(WIDTH, Math.floor(w / zoom + 1e-6)), height: Math.max(HEIGHT, Math.floor(h / zoom + 1e-6)), zoom };
}

/** Fits the game to the window in the current mode (window resizes, phone rotations, a mode change). */
export function fitView(game: Phaser.Game) {
  const { width, height, zoom } = viewSize(mode);
  if (zoom !== game.scale.zoom) game.scale.setZoom(zoom);
  if (width !== game.scale.width || height !== game.scale.height) game.scale.resize(width, height);
}

/** Each scene picks its mode when it starts (the Overworld "world", the others "fixed"). */
export function setViewMode(game: Phaser.Game, m: ViewMode) {
  if (m === mode) return;
  mode = m;
  fitView(game);
}

/** `fn(width, height)` whenever the game size changes, until the scene shuts down. */
export function onViewResize(scene: Phaser.Scene, fn: (width: number, height: number) => void) {
  const handler = (size: Phaser.Structs.Size) => fn(size.width, size.height);
  scene.scale.on(Phaser.Scale.Events.RESIZE, handler);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.scale.off(Phaser.Scale.Events.RESIZE, handler));
}
