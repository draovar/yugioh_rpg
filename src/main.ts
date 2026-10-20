import Phaser from "phaser";
import { Boot } from "./scenes/Boot.ts";
import { Overworld } from "./scenes/Overworld.ts";
import { WorldMenu } from "./scenes/WorldMenu.ts";
import { DuelScene } from "./scenes/DuelScene.ts";
import { Lobby } from "./scenes/Lobby.ts";
import { DeckEditor } from "./scenes/DeckEditor.ts";
import { fullscreenOnFirstTap } from "./ui/touch.ts";

/**
 * Native resolution. The canvas is scaled up by whole numbers (2x = 1280x720, 3x = 1920x1080) so
 * every game pixel stays square. Windows too small for 2x get a fractional, still nearest-neighbour,
 * fit instead of a tiny 1x canvas, and below 1x too (a phone in landscape with the browser bar showing
 * can be under 360 CSS pixels tall), so the whole screen is always visible.
 */
const WIDTH = 640, HEIGHT = 360;
const integerZoom = () => {
  const fit = Math.min(window.innerWidth / WIDTH, window.innerHeight / HEIGHT);
  return fit >= 2 ? Math.floor(fit) : fit;
};

const game = new Phaser.Game({
  type: Phaser.AUTO,
  title: "Yu-Gi-Oh RPG",
  parent: "game-container",
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: "#000000",
  pixelArt: true,
  roundPixels: true,
  scene: [Boot, Overworld, WorldMenu, Lobby, DuelScene, DeckEditor],
  scale: { mode: Phaser.Scale.NONE, zoom: integerZoom(), autoCenter: Phaser.Scale.CENTER_BOTH },
  // About 60 frames a second at most: phones with 90/120 Hz screens would otherwise draw up to twice as often (heat).
  // 65, not 60, so a 60 Hz screen's slightly early frames aren't skipped.
  // Dev: `&timeout` keeps the game loop running in a hidden/background tab (rAF pauses there),
  // which automated browser testing needs.
  fps: { limit: 65, forceSetTimeOut: import.meta.env.DEV && new URLSearchParams(location.search).has("timeout") },
});

const fit = () => game.scale.setZoom(integerZoom());
window.addEventListener("resize", fit);
// Phones: the browser bar showing/hiding and rotations change the visible area without always firing "resize".
window.visualViewport?.addEventListener("resize", fit);
fullscreenOnFirstTap(game);

// Dev: console access to the game and the frame-capture helper (src/dev/capture.ts).
if (import.meta.env.DEV) {
  (window as unknown as { game: Phaser.Game }).game = game;
  void import("./dev/capture.ts");
}
