import Phaser from "phaser";
import { loadEngine } from "../duel/loadEngine.ts";
import { CARD_BACK, cardTexture } from "../ui/duel/CardSprite.ts";

export class Boot extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  create() {
    const label = this.add.text(640, 360, "Loading duel engine…", { fontSize: "24px", color: "#ffffff" }).setOrigin(0.5);
    this.makeCardBack();
    loadEngine()
      .then(({ cards }) => {
        label.setText("Loading cards…");
        // Card images come from `npm run fetch-art`; missing ones fall back to a drawn frame.
        for (const code of cards.records.keys()) this.load.image(cardTexture(code), `cards/${code}.jpg`);
        // Dev shortcut: /?duel jumps straight into a duel; &lp=1000 for a short one, &seed=N to replay one.
        const params = new URLSearchParams(location.search);
        const lp = Number(params.get("lp")) || undefined;
        const seed = params.has("seed") ? Number(params.get("seed")) : undefined;
        this.load.once(Phaser.Loader.Events.COMPLETE, () =>
          params.has("duel") ? this.scene.start("Duel", { opponentName: "Test Opponent", startingLP: lp, seed }) : this.scene.start("Overworld"));
        this.load.start();
      })
      .catch((e) => {
        console.error(e);
        label.setText(`Engine failed to load:\n${e}`).setColor("#ff6666");
      });
  }

  private makeCardBack() {
    const w = 128, h = 186;
    const g = this.make.graphics({}, false);
    g.fillStyle(0x3b2414).fillRoundedRect(0, 0, w, h, 8);
    g.fillStyle(0x6b3f1d).fillRoundedRect(6, 6, w - 12, h - 12, 6);
    g.fillStyle(0x1a0f08).fillEllipse(w / 2, h / 2, w * 0.62, h * 0.5);
    g.lineStyle(3, 0xd8a24a).strokeEllipse(w / 2, h / 2, w * 0.62, h * 0.5);
    g.generateTexture(CARD_BACK, w, h);
    g.destroy();
  }
}
