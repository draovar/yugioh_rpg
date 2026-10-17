import Phaser from "phaser";
import { Boot } from "./scenes/Boot.ts";
import { Overworld } from "./scenes/Overworld.ts";
import { WorldMenu } from "./scenes/WorldMenu.ts";
import { DuelScene } from "./scenes/DuelScene.ts";
import { Lobby } from "./scenes/Lobby.ts";

/**
 * Native resolution. The canvas is scaled up by whole numbers (2x = 1280x720, 3x = 1920x1080) so
 * every game pixel stays square. Windows too small for 2x get a fractional, still nearest-neighbour,
 * fit instead of a tiny 1x canvas.
 */
const WIDTH = 640, HEIGHT = 360;
const integerZoom = () => {
  const fit = Math.min(window.innerWidth / WIDTH, window.innerHeight / HEIGHT);
  return fit >= 2 ? Math.floor(fit) : Math.max(1, fit);
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
  scene: [Boot, Overworld, WorldMenu, Lobby, DuelScene],
  scale: { mode: Phaser.Scale.NONE, zoom: integerZoom(), autoCenter: Phaser.Scale.CENTER_BOTH },
  // Dev: `&timeout` keeps the game loop running in a hidden/background tab (rAF pauses there),
  // which automated browser testing needs.
  fps: { forceSetTimeOut: import.meta.env.DEV && new URLSearchParams(location.search).has("timeout") },
});

window.addEventListener("resize", () => game.scale.setZoom(integerZoom()));

// Dev: console access to the game and the frame-capture helper (src/dev/capture.ts).
if (import.meta.env.DEV) {
  (window as unknown as { game: Phaser.Game }).game = game;
  void import("./dev/capture.ts");
}
