import Phaser from "phaser";
import { isBrainName } from "./duel/ai/brains.ts";
import { deckByName } from "./duel/decks/decks.ts";
import { loadEngine } from "./duel/engine/loadEngine.ts";
import { ART_ATLAS, ATTRIBUTE_SHEET, CARD_BACK, CHAIN_MARK, FRAMES, SPELL_SHEET, frameKey } from "./duel-screen/CardSprite.ts";
import { COIN_SHEET, DICE_SHEET } from "./duel-screen/DuelAnimator.ts";
import { RPS_SHEET } from "./duel-screen/RpsIntro.ts";
import { loadOverworld } from "./overworld/Overworld.ts";
import { FONT_CARD, FONT_UI, WHITE, text } from "./ui/pixel.ts";
import { loadThemeSprites } from "./ui/theme.ts";

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
    this.load.spritesheet(COIN_SHEET, "assets/duel/coin_flip.png", { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet(DICE_SHEET, "assets/duel/dice.png", { frameWidth: 16, frameHeight: 16 });
    this.load.image(CHAIN_MARK, "assets/duel/chain.png");
    this.load.spritesheet(RPS_SHEET, "assets/duel/rps.png", { frameWidth: 32, frameHeight: 32 });
    loadThemeSprites(this.load);
    loadOverworld(this.load);
    // Built by `npm run build-art`; cards without art fall back to a grey box.
    this.load.atlas(ART_ATLAS, "cards/art32.png", "cards/art32.json");
  }

  create() {
    this.cameras.main.setBackgroundColor(0x040218);
    const label = text(this, 320, 176, "LOADING DUEL ENGINE...", { color: WHITE, originX: 0.5 });
    loadEngine()
      .then(() => {
        // Dev shortcut: /?duel jumps straight into a duel; &lp=1000 for a short one, &seed=N to replay one,
        // &setup=NAME to start from a test board (devSetups.ts), &deck=NAME / &opp=NAME pick the decks (decks.ts),
        // &first=you / &first=opp skip rock-paper-scissors (a replay with &seed goes first unless &first=opp),
        // &ai=NAME picks the opponent's brain (ai/brains.ts).
        const params = new URLSearchParams(location.search);
        const lp = Number(params.get("lp")) || undefined;
        const seed = params.has("seed") ? Number(params.get("seed")) : undefined;
        const setup = params.get("setup") ?? undefined;
        const first = params.get("first");
        let goFirst: boolean | undefined;
        if (first === "opp") goFirst = false;
        else if (first === "you" || seed !== undefined) goFirst = true;
        const ai = params.get("ai") ?? "";
        // Card-wave transitions between scenes (ui/Transition.ts): runs on top for the whole game.
        this.scene.launch("Transition");
        // Invite link from a multiplayer host: ?join=CODE (dropped from the address so a reload doesn't rejoin).
        const join = params.get("join");
        if (join) {
          params.delete("join");
          history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
          this.scene.start("Lobby", { join });
        } else if (params.has("mp")) this.scene.start("Lobby");
        else if (params.has("duel")) {
          this.scene.start("Duel", {
            opponentName: "Test Opponent", startingLP: lp, seed, setup, goFirst, ai: isBrainName(ai) ? ai : undefined,
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
