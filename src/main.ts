import Phaser from "phaser";
import { Boot } from "./scenes/Boot.ts";
import { Overworld } from "./scenes/Overworld.ts";
import { DuelTest } from "./scenes/DuelTest.ts";

new Phaser.Game({
  type: Phaser.AUTO,
  title: "Yu-Gi-Oh RPG",
  parent: "game-container",
  width: 1280,
  height: 720,
  backgroundColor: "#000000",
  pixelArt: true,
  scene: [Boot, Overworld, DuelTest],
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
});
