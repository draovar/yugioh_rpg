import Phaser from "phaser";
import { Boot } from "./Boot.ts";
import { Overworld } from "./overworld/Overworld.ts";
import { WorldMenu } from "./overworld/WorldMenu.ts";
import { DuelScene } from "./duel-screen/DuelScene.ts";
import { Lobby } from "./lobby/Lobby.ts";
import { DeckEditor } from "./deck-editor/DeckEditor.ts";
import { fullscreenOnFirstTap } from "./ui/touch.ts";
import { Transition } from "./ui/Transition.ts";
import { HEIGHT, WIDTH, fitView, viewSize } from "./ui/view.ts";

// Size and zoom: src/ui/view.ts (fixed 640x360 for duels and menus, a view that grows with the window for the overworld).
const game = new Phaser.Game({
  type: Phaser.AUTO,
  title: "Yu-Gi-Oh RPG",
  parent: "game-container",
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: "#000000",
  pixelArt: true,
  roundPixels: true,
  scene: [Boot, Overworld, WorldMenu, Lobby, DuelScene, DeckEditor, Transition],
  scale: { mode: Phaser.Scale.NONE, zoom: viewSize("fixed").zoom, autoCenter: Phaser.Scale.CENTER_BOTH },
  // About 60 frames a second at most: phones with 90/120 Hz screens would otherwise draw up to twice as often (heat).
  // 65, not 60, so a 60 Hz screen's slightly early frames aren't skipped.
  // Dev: `&timeout` keeps the game loop running in a hidden/background tab (rAF pauses there),
  // which automated browser testing needs.
  fps: { limit: 65, forceSetTimeOut: import.meta.env.DEV && new URLSearchParams(location.search).has("timeout") },
});

const fit = () => fitView(game);
window.addEventListener("resize", fit);
// Phones: the browser bar showing/hiding and rotations change the visible area without always firing "resize".
window.visualViewport?.addEventListener("resize", fit);
fullscreenOnFirstTap(game);

// Dev: console access to the game and the frame-capture helper (src/dev/capture.ts).
if (import.meta.env.DEV) {
  (window as unknown as { game: Phaser.Game }).game = game;
  void import("./dev/capture.ts");
}
