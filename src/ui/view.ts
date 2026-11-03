import Phaser from "phaser";

import { integerScale, worldZoom } from "./prefs.ts";
import { TOUCH } from "./touch.ts";

/** Native resolution: every scene is laid out in it, always 16:9. */
export const WIDTH = 640, HEIGHT = 360;

/** How many times the 640x360 view fits the window, in CSS pixels. */
const cssFit = () => Math.min(window.innerWidth / WIDTH, window.innerHeight / HEIGHT);

/**
 * The same in physical pixels (`devicePixelRatio`: Windows display scaling, phones' full resolution). A hair over, so
 * 125% scaling's 1536x864 CSS pixels still count as 1920x1080.
 */
const physicalFit = () => cssFit() * (window.devicePixelRatio || 1) + 1e-6;

/** Whole screen pixels per layout pixel: 1 up to 1279x719, 2 from 1280x720, 3 from 1920x1080... (0: under 640x360). */
export const viewScale = () => Math.floor(physicalFit());

/**
 * Whole numbers of screen pixels only (world menu: SCALING): chosen, else on by default except on phones and tablets,
 * where FIT fills the screen (the browser bar showing makes a landscape phone 2x with wide borders, portrait 1x).
 */
export const integerScaling = () => integerScale() ?? !TOUCH;

/**
 * The overworld's sprite size in screen pixels per game pixel (world menu: ZOOM, 1X up to the window's `viewScale`):
 * the chosen one, or the biggest the window fits if that's smaller or none was chosen. The map then shows 640x360
 * times viewScale / this of game pixels: on a 1920x1080 screen 3X = 640x360, 2X = 960x540, 1X = 1920x1080.
 */
export function worldSpriteScale() {
  const most = Math.max(1, viewScale());
  return Math.min(worldZoom() ?? most, most);
}

/**
 * "fixed": the 640x360 layout, scaled up by the biggest whole number of screen pixels the window fits; the rest is
 * border (a 1000x600 window stays at 1x), only a window under 640x360 gets a fractional, still nearest-neighbour, fit.
 * "world" (the overworld): the same at the biggest ZOOM; a smaller one makes the game as big as that 16:9 area in
 * screen pixels (1280x720 at 2x, 1920x1080 at 3x), drawn at full detail with the camera zoomed to the sprite size.
 * Its HUD and overlays, laid out in 640x360, are scaled up to it (`layoutScale`).
 * Without integer scaling, either is then stretched (nearest-neighbour) to fill the window, still 16:9.
 */
export type ViewMode = "fixed" | "world";
let mode: ViewMode = "fixed";

/** The game size and zoom (CSS pixels per game pixel) for the window. */
export function viewSize(m: ViewMode) {
  const scale = viewScale(), big = m === "world" && worldSpriteScale() < scale ? scale : 1;
  const fit = scale && integerScaling() ? scale / (window.devicePixelRatio || 1) : cssFit();
  return { width: WIDTH * big, height: HEIGHT * big, zoom: fit / big };
}

/** Fits the game to the window in the current mode (window resizes, phone rotations, a mode or ZOOM change). */
export function fitView(game: Phaser.Game) {
  const { width, height, zoom } = viewSize(mode), scale = game.scale;
  if (width === scale.width && height === scale.height && zoom === scale.zoom) return;
  if (width !== scale.width || height !== scale.height) scale.resize(width, height);
  // After the resize: Phaser's resize leaves the canvas's CSS size alone when it equals the new game size (the full
  // detail game at zoom 1), setZoom always sets it.
  scale.setZoom(zoom);
}

/** Each scene picks its mode when it starts (the Overworld "world", the others "fixed"). */
export function setViewMode(game: Phaser.Game, m: ViewMode) {
  if (m === mode) return;
  mode = m;
  fitView(game);
}

/** Game pixels per 640x360 layout pixel: 1, or the window's scale while the overworld draws at full detail. */
export const layoutScale = (scene: Phaser.Scene) => scene.scale.width / WIDTH;

/**
 * Overlay scenes laid out in 640x360 (WorldMenu, Transition) cover the overworld's bigger full-detail game too: their
 * camera scales them up to the game's size, now and after every resize.
 */
export function scaleWithView(scene: Phaser.Scene) {
  const fit = () => scene.cameras.main.setOrigin(0, 0).setZoom(layoutScale(scene));
  fit();
  scene.scale.on(Phaser.Scale.Events.RESIZE, fit);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.scale.off(Phaser.Scale.Events.RESIZE, fit));
}
