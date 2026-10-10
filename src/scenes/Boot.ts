import Phaser from "phaser";
import { loadEngine } from "../duel/loadEngine.ts";

export class Boot extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  preload() {
    // Overworld art goes here. Note: Modern_Exteriors_Complete_Tileset_32x32.png is 5632x16448,
    // above the 16384px WebGL texture limit — use the split sheets from the pack instead.
  }

  create() {
    const label = this.add.text(640, 360, "Loading duel engine…", { fontSize: "24px", color: "#ffffff" }).setOrigin(0.5);
    loadEngine()
      .then(() => this.scene.start("Overworld"))
      .catch((e) => {
        console.error(e);
        label.setText(`Engine failed to load:\n${e}`).setColor("#ff6666");
      });
  }
}
