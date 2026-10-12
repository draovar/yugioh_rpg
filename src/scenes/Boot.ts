import Phaser from "phaser";
import { deckByName } from "../duel/decks.ts";
import { loadEngine } from "../duel/loadEngine.ts";
import { ART_ATLAS, ATTRIBUTE_SHEET, CARD_BACK, FRAMES, SPELL_SHEET, frameKey } from "../ui/duel/CardSprite.ts";
import { FONT_CARD, FONT_UI, WHITE, text } from "../ui/pixel.ts";
import { loadThemeSprites } from "../ui/theme.ts";

export class Boot extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  preload() {
    this.load.bitmapFont(FONT_UI, "assets/fonts/tiny5.png", "assets/fonts/tiny5.xml");
    this.load.bitmapFont(FONT_CARD, "assets/fonts/nerds3.png", "assets/fonts/nerds3.xml");
    for (const f of FRAMES) this.load.image(frameKey(f), `assets/cards/frames/${f}.png`);
    this.load.image(CARD_BACK, "assets/cards/back.png");
    this.load.spritesheet(ATTRIBUTE_SHEET, "assets/cards/attributes.png", { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet(SPELL_SHEET, "assets/cards/spells.png", { frameWidth: 16, frameHeight: 16 });
    loadThemeSprites(this.load);
    // Built by `npm run build-art`; cards without art fall back to a grey box.
    this.load.atlas(ART_ATLAS, "cards/art32.png", "cards/art32.json");
  }

  create() {
    this.cameras.main.setBackgroundColor(0x040218);
    const label = text(this, 320, 176, "LOADING DUEL ENGINE...", { color: WHITE, originX: 0.5 });
    loadEngine()
      .then(() => {
        // Dev shortcut: /?duel jumps straight into a duel; &lp=1000 for a short one, &seed=N to replay one,
        // &setup=NAME to start from a test board (devSetups.ts), &deck=NAME / &opp=NAME pick the decks (decks.ts).
        const params = new URLSearchParams(location.search);
        const lp = Number(params.get("lp")) || undefined;
        const seed = params.has("seed") ? Number(params.get("seed")) : undefined;
        const setup = params.get("setup") ?? undefined;
        // Invite link from a multiplayer host: ?join=CODE (dropped from the address so a reload doesn't rejoin).
        const join = params.get("join");
        if (join) {
          params.delete("join");
          history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
          this.scene.start("Lobby", { join });
        } else if (params.has("mp")) this.scene.start("Lobby");
        else if (params.has("duel")) {
          this.scene.start("Duel", {
            opponentName: "Test Opponent", startingLP: lp, seed, setup,
            playerDeck: deckByName(params.get("deck"), "yugi"), opponentDeck: deckByName(params.get("opp"), "kaiba"),
          });
        }
        else this.scene.start("Overworld");
      })
      .catch((e) => {
        console.error(e);
        label.setText(`ENGINE FAILED TO LOAD: ${e}`).setTint(0xff6666);
      });
  }
}
