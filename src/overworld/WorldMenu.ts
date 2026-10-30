import Phaser from "phaser";
import { WHITE, border, text } from "../ui/pixel.ts";
import {
  WORLD_ZOOMS, aiDeck, chosenDeck, deckEntries, playerLook, revealAiCards, setAiDeck, setChosenDeck, setPlayerLook,
  setRevealAiCards, setWorldZoom, worldZoom,
} from "../ui/prefs.ts";
import { THEME, THEMES, setTheme } from "../ui/theme.ts";
import { enterFullscreen } from "../ui/touch.ts";
import { makeButton, makeDropDown, type Button } from "../ui/widgets.ts";
import { fitView, onViewResize } from "../ui/view.ts";
import type { Overworld } from "./Overworld.ts";

/** ACTION_COLOR: buttons that leave the overworld (DECK EDITOR, MULTIPLAYER, QUICK DUEL), a lighter blue than the settings. */
const BUTTON_COLOR = 0x2d4a7a, PICKED_COLOR = 0x3f7a3a, ACTION_COLOR = 0x4a72b0;
/**
 * The settings panel: centred, one row per setting; labels on the left, controls in a column from `controlX` on, all
 * `controlW` wide (a pair of buttons with the `gap` between them included).
 */
const PANEL = { w: 230, h: 250, row: 22, controlX: 100, controlW: 120, gap: 6 };

/** The prebuilt decks and your custom decks as drop-down choices. */
const deckOptions = () => deckEntries().map((e) => ({ value: e.key, label: e.label }));

/**
 * Overlay on the Overworld (its own scene, so it doesn't scroll with the map camera): a MENU button at the top right
 * that opens the settings panel (also M): the player character (boy / girl), your deck, the quick duel's AI deck (NPCs bring their own decks), whether
 * the AI's hand and set cards are shown, the duel UI theme, the overworld's zoom; then DECK EDITOR, MULTIPLAYER, QUICK DUEL and FULL SCREEN.
 */
export class WorldMenu extends Phaser.Scene {
  isOpen = false;
  private panel: Phaser.GameObjects.Container | null = null;
  /** The new theme's sprites are loading: no duel or lobby until they're in. */
  private loadingTheme = false;

  constructor() {
    super("WorldMenu");
  }

  create() {
    this.isOpen = false;
    this.panel = null;
    const menu = makeButton(this, this.scale.width - 8 - 28, 8 + 7, 56, 14, "MENU (M)", () => this.toggle());
    this.input.keyboard!.on("keydown-M", () => this.toggle());
    // The overworld's view follows the window's size: the button stays top right, an open panel centred.
    onViewResize(this, (w) => {
      menu.setX(w - 8 - 28);
      if (this.isOpen) {
        this.close();
        this.open();
      }
    });
  }

  private toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  private close() {
    this.panel?.destroy();
    this.panel = null;
    this.isOpen = false;
  }

  private open() {
    this.isOpen = true;
    // FULL SCREEN only where the browser can do it (not on iPhones: there the home-screen app has no browser bar).
    const fullscreen = this.scale.fullscreen.available;
    const h = PANEL.h + (fullscreen ? PANEL.row : 0);
    const { width, height } = this.scale;
    const left = Math.round((width - PANEL.w) / 2), top = Math.round((height - h) / 2);
    // Full-screen shade that also swallows clicks meant for the map.
    const shade = this.add.rectangle(0, 0, width, height, 0x000000, 0.45).setOrigin(0).setInteractive();
    const bg = this.add.graphics().fillStyle(0x000000, 0.85).fillRect(left, top, PANEL.w, h);
    border(bg, left, top, PANEL.w, h, WHITE);
    const panel = this.add.container(0, 0, [shade, bg]).setDepth(500);
    this.panel = panel;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => { panel.add(o); return o; };

    add(text(this, left + PANEL.w / 2, top + 8, "MENU", { color: WHITE, originX: 0.5 }));
    const x = left + 10, cx = left + PANEL.controlX, mid = cx + PANEL.controlW / 2;
    let y = top + 30;
    const row = (label: string) => {
      if (label) add(text(this, x, y, label, { color: WHITE, originY: 0.5 }));
      const at = y;
      y += PANEL.row;
      return at;
    };
    /** Buttons side by side filling the control column (one choice each), rebuilt after a pick. */
    const choices = (rowY: number, labels: string[], picked: () => number, onPick: (i: number) => void) => {
      const bw = (PANEL.controlW - PANEL.gap * (labels.length - 1)) / labels.length;
      let buttons: Button[] = [];
      const draw = () => {
        for (const b of buttons) b.destroy();
        buttons = labels.map((label, i) => add(makeButton(this, cx + Math.floor(bw / 2) + i * (bw + PANEL.gap), rowY, bw, 14,
          label, () => { onPick(i); draw(); }, i === picked() ? PICKED_COLOR : BUTTON_COLOR)));
      };
      draw();
    };

    // The overworld re-reads it while the menu is open, so the player changes at once.
    choices(row("PLAYER:"), ["BOY", "GIRL"], () => (playerLook() === "girl" ? 1 : 0), (i) => setPlayerLook(i === 1 ? "girl" : "boy"));
    add(makeDropDown(this, mid, row("YOUR DECK:"), PANEL.controlW, 14, deckOptions(), chosenDeck().key, setChosenDeck, BUTTON_COLOR, PICKED_COLOR));
    add(makeDropDown(this, mid, row("AI DECK:"), PANEL.controlW, 14, deckOptions(), aiDeck().key, setAiDeck, BUTTON_COLOR, PICKED_COLOR));
    choices(row("AI CARDS:"), ["HIDDEN", "SHOWN"], () => (revealAiCards() ? 1 : 0), (i) => setRevealAiCards(i === 1));
    // Duel UI theme: switched in place (nothing themed is on screen here).
    const themes = Object.keys(THEMES) as [string, string];
    choices(row("THEME:"), [themes[0].toUpperCase(), themes[1].toUpperCase()], () => themes.indexOf(THEME.name), (i) => {
      if (themes[i] === THEME.name || this.loadingTheme) return;
      this.loadingTheme = true;
      void setTheme(this, themes[i]).then(() => (this.loadingTheme = false));
    });
    // Applied once this click is done: the new size lays the panel out again (onViewResize above).
    choices(row("ZOOM:"), WORLD_ZOOMS.map((z) => String(z).toUpperCase() + (z === "auto" ? "" : "X")),
      () => WORLD_ZOOMS.indexOf(worldZoom()), (i) => {
        setWorldZoom(WORLD_ZOOMS[i]);
        this.time.delayedCall(0, () => fitView(this.game));
      });

    y += 4;
    add(makeButton(this, mid, row(""), PANEL.controlW, 14, "DECK EDITOR", () => this.leave("DeckEditor"), ACTION_COLOR));
    add(makeButton(this, mid, row(""), PANEL.controlW, 14, "MULTIPLAYER", () => this.leave("Lobby"), ACTION_COLOR));
    add(makeButton(this, mid, row(""), PANEL.controlW, 14, "QUICK DUEL (AI DECK)", () => this.leave("Duel", {
      opponentName: "Rival", playerDeck: chosenDeck().deck, opponentDeck: aiDeck().deck,
    }), ACTION_COLOR));

    if (fullscreen) {
      const on = this.scale.isFullscreen;
      add(makeButton(this, mid, row(""), PANEL.controlW, 14, on ? "EXIT FULL SCREEN" : "FULL SCREEN", () => {
        if (on) this.scale.stopFullscreen();
        else enterFullscreen(this.game);
        this.close();
      }, ACTION_COLOR));
    }

    y += 4;
    add(makeButton(this, mid, row(""), PANEL.controlW, 14, "CLOSE (M)", () => this.close()));
  }

  /** Leaves the overworld for the deck editor, the lobby or a quick duel; the player comes back to the same spot. */
  private leave(scene: string, data?: object) {
    if (this.loadingTheme) return;
    (this.scene.get("Overworld") as Overworld).savePosition();
    this.scene.stop("Overworld");
    this.scene.start(scene, data);
  }
}
