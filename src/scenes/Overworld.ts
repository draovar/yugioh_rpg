import Phaser from "phaser";
import { DECKS, type DeckName } from "../duel/decks.ts";
import { WHITE, text } from "../ui/pixel.ts";
import { chosenDeck, setChosenDeck } from "../ui/prefs.ts";
import { makeButton, type Button } from "../ui/widgets.ts";

const TILE = 16;
/** Bottom menu bar (testing aids until the real menus exist). */
const BAR = { top: 330, h: 30, deckW: 64, mpW: 84 };
const BUTTON_COLOR = 0x2d4a7a, PICKED_COLOR = 0x3f7a3a;

/** Placeholder overworld: grid movement, and an "NPC" that starts a duel when you bump into it. */
export class Overworld extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private npc!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private moving = false;
  private deckButtons: Button[] = [];

  constructor() {
    super("Overworld");
  }

  create() {
    this.add.grid(320, 180, 640, 360, TILE, TILE, 0x1d3b1d, 1, 0x2a4f2a, 1);
    this.player = this.add.rectangle(TILE * 10 + 8, TILE * 10 + 8, TILE - 2, TILE - 2, 0x4fa3ff);
    this.npc = this.add.rectangle(TILE * 20 + 8, TILE * 10 + 8, TILE - 2, TILE - 2, 0xff5555);
    text(this, 8, 8, "ARROW KEYS TO MOVE. WALK INTO THE RED DUELIST TO CHALLENGE THEM.", { color: WHITE });
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.input.keyboard!.once("keydown-M", () => this.scene.start("Lobby"));
    this.createMenu();
  }

  /** Bottom bar: your deck (used against the Rival and in multiplayer) and the multiplayer lobby (also M). */
  private createMenu() {
    const y = BAR.top + BAR.h / 2;
    this.add.rectangle(0, BAR.top, 640, BAR.h, 0x000000, 0.65).setOrigin(0);
    text(this, 8, y, "YOUR DECK:", { color: WHITE, originY: 0.5 });
    const names = Object.keys(DECKS) as DeckName[];
    const drawDecks = () => {
      for (const b of this.deckButtons) b.destroy();
      const picked = chosenDeck();
      this.deckButtons = names.map((name, i) => makeButton(this, 92 + i * (BAR.deckW + 6), y, BAR.deckW, 14, DECKS[name].label.toUpperCase(),
        () => { setChosenDeck(name); drawDecks(); }, name === picked ? PICKED_COLOR : BUTTON_COLOR));
    };
    drawDecks();
    makeButton(this, 640 - 8 - BAR.mpW / 2, y, BAR.mpW, 14, "MULTIPLAYER (M)", () => this.scene.start("Lobby"));
  }

  update() {
    if (this.moving) return;
    const dir = this.cursors.left.isDown ? [-1, 0] : this.cursors.right.isDown ? [1, 0]
      : this.cursors.up.isDown ? [0, -1] : this.cursors.down.isDown ? [0, 1] : null;
    if (!dir) return;
    const tx = this.player.x + dir[0] * TILE, ty = this.player.y + dir[1] * TILE;
    if (tx === this.npc.x && ty === this.npc.y) {
      this.scene.start("Duel", { opponentName: "Rival", playerDeck: DECKS[chosenDeck()].deck, opponentDeck: DECKS.kaiba.deck });
      return;
    }
    this.moving = true;
    this.tweens.add({ targets: this.player, x: tx, y: ty, duration: 140, onComplete: () => (this.moving = false) });
  }
}
