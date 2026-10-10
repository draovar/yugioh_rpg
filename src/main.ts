import Phaser from "phaser";
import { Boot } from "./scenes/Boot.ts";
import { Overworld } from "./scenes/Overworld.ts";
import { DuelScene } from "./scenes/DuelScene.ts";

new Phaser.Game({
  type: Phaser.AUTO,
  title: "Yu-Gi-Oh RPG",
  parent: "game-container",
  width: 1280,
  height: 720,
  backgroundColor: "#000000",
  pixelArt: false,
  scene: [Boot, Overworld, DuelScene],
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  // Dev: `&timeout` keeps the game loop running in a hidden/background tab (rAF pauses there),
  // which automated browser testing needs.
  fps: { forceSetTimeOut: import.meta.env.DEV && new URLSearchParams(location.search).has("timeout") },
});
