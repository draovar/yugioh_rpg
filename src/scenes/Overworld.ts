import Phaser from "phaser";
import { DECKS, type DeckName } from "../duel/decks.ts";
import { WHITE, text } from "../ui/pixel.ts";
import { aiDeck, chosenDeck, revealAiCards, setAiDeck, setChosenDeck, setRevealAiCards } from "../ui/prefs.ts";
import { THEME, THEMES, setTheme } from "../ui/theme.ts";
import { makeButton, type Button } from "../ui/widgets.ts";

const TILE = 16;
/** Bottom menu bar (testing aids until the real menus exist). */
/** `groupX`: the second group's labels (THEME / AI CARDS); its buttons are centred from `groupX + groupButtons` on. */
const BAR = { top: 308, h: 52, row: 22, deckW: 64, groupX: 286, groupButtons: 76, themeW: 64, mpW: 84 };
const BUTTON_COLOR = 0x2d4a7a, PICKED_COLOR = 0x3f7a3a;

/** Placeholder overworld: grid movement, and an "NPC" that starts a duel when you bump into it. */
export class Overworld extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private npc!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private moving = false;
  private deckButtons: Button[] = [];
  private aiDeckButtons: Button[] = [];
  private revealButton: Button | null = null;
  private themeButtons: Button[] = [];
  /** The new theme's sprites are loading: no duel or lobby until they're in. */
  private loadingTheme = false;

  constructor() {
    super("Overworld");
  }

  create() {
    // Ground, then 2px grid lines on the tile edges. (Phaser 4's Grid centres 1px strokes on the edges and its cell
    // fills skip the top row, so the fill is a plain rectangle and the stroke is widened to v3's 2px look.)
    this.add.rectangle(0, 0, 640, 360, 0x1d3b1d).setOrigin(0);
    this.add.grid(320, 180, 640, 360, TILE, TILE).setFillStyle().setStrokeStyle(2, 0x2a4f2a);
    this.player = this.add.rectangle(TILE * 10 + 8, TILE * 10 + 8, TILE - 2, TILE - 2, 0x4fa3ff);
    this.npc = this.add.rectangle(TILE * 20 + 8, TILE * 10 + 8, TILE - 2, TILE - 2, 0xff5555);
    text(this, 8, 8, "ARROW KEYS TO MOVE. WALK INTO THE RED DUELIST TO CHALLENGE THEM.", { color: WHITE });
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.input.keyboard!.on("keydown-M", () => this.openLobby());
    this.createMenu();
  }

  /**
   * Bottom bar. Row 1: your deck (used against the Rival and in multiplayer), the duel UI theme, the multiplayer lobby
   * (also M). Row 2 (testing aids): the Rival's deck, and whether its hand and set cards are shown during duels.
   */
  private createMenu() {
    const y = BAR.top + BAR.h / 2 - BAR.row / 2;
    this.add.rectangle(0, BAR.top, 640, BAR.h, 0x000000, 0.65).setOrigin(0);
    this.createAiRow(y + BAR.row);
    text(this, 8, y, "YOUR DECK:", { color: WHITE, originY: 0.5 });
    const names = Object.keys(DECKS) as DeckName[];
    const drawDecks = () => {
      for (const b of this.deckButtons) b.destroy();
      const picked = chosenDeck();
      this.deckButtons = names.map((name, i) => makeButton(this, 92 + i * (BAR.deckW + 6), y, BAR.deckW, 14, DECKS[name].label.toUpperCase(),
        () => { setChosenDeck(name); drawDecks(); }, name === picked ? PICKED_COLOR : BUTTON_COLOR));
    };
    drawDecks();
    // Duel UI theme: switched in place (nothing themed is on screen here).
    text(this, BAR.groupX, y, "THEME:", { color: WHITE, originY: 0.5 });
    const drawThemes = () => {
      for (const b of this.themeButtons) b.destroy();
      this.themeButtons = Object.keys(THEMES).map((name, i) => makeButton(this, BAR.groupX + BAR.groupButtons + i * (BAR.themeW + 6), y, BAR.themeW, 14,
        name.toUpperCase(), () => {
          if (name === THEME.name || this.loadingTheme) return;
          this.loadingTheme = true;
          void setTheme(this, name).then(() => (this.loadingTheme = false));
          drawThemes();
        }, name === THEME.name ? PICKED_COLOR : BUTTON_COLOR));
    };
    drawThemes();
    makeButton(this, 640 - 8 - BAR.mpW / 2, y, BAR.mpW, 14, "MULTIPLAYER (M)", () => this.openLobby());
  }

  private createAiRow(y: number) {
    text(this, 8, y, "AI DECK:", { color: WHITE, originY: 0.5 });
    const names = Object.keys(DECKS) as DeckName[];
    const drawDecks = () => {
      for (const b of this.aiDeckButtons) b.destroy();
      const picked = aiDeck();
      this.aiDeckButtons = names.map((name, i) => makeButton(this, 92 + i * (BAR.deckW + 6), y, BAR.deckW, 14, DECKS[name].label.toUpperCase(),
        () => { setAiDeck(name); drawDecks(); }, name === picked ? PICKED_COLOR : BUTTON_COLOR));
    };
    drawDecks();
    text(this, BAR.groupX, y, "AI CARDS:", { color: WHITE, originY: 0.5 });
    const drawReveal = () => {
      this.revealButton?.destroy();
      const on = revealAiCards();
      this.revealButton = makeButton(this, BAR.groupX + BAR.groupButtons, y, BAR.themeW, 14, on ? "SHOWN" : "HIDDEN",
        () => { setRevealAiCards(!on); drawReveal(); }, on ? PICKED_COLOR : BUTTON_COLOR);
    };
    drawReveal();
  }

  private openLobby() {
    if (!this.loadingTheme) this.scene.start("Lobby");
  }

  update() {
    if (this.moving || this.loadingTheme) return;
    const dir = this.cursors.left.isDown ? [-1, 0] : this.cursors.right.isDown ? [1, 0]
      : this.cursors.up.isDown ? [0, -1] : this.cursors.down.isDown ? [0, 1] : null;
    if (!dir) return;
    const tx = this.player.x + dir[0] * TILE, ty = this.player.y + dir[1] * TILE;
    if (tx === this.npc.x && ty === this.npc.y) {
      this.scene.start("Duel", { opponentName: "Rival", playerDeck: DECKS[chosenDeck()].deck, opponentDeck: DECKS[aiDeck()].deck });
      return;
    }
    this.moving = true;
    this.tweens.add({ targets: this.player, x: tx, y: ty, duration: 140, onComplete: () => (this.moving = false) });
  }
}
