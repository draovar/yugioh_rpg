import Phaser from "phaser";
import { WHITE, border, text } from "../ui/pixel.ts";
import {
  aiDeck, chosenDeck, deckEntries, playerLook, revealAiCards, setAiDeck, setChosenDeck, setIntegerScale, setPlayerLook,
  setRevealAiCards, setWorldZoom,
} from "../ui/prefs.ts";
import { THEME, THEMES, setTheme } from "../ui/theme.ts";
import { enterFullscreen } from "../ui/touch.ts";
import { transitionTo, transitioning } from "../ui/Transition.ts";
import { makeButton, makeDropDown, type Button } from "../ui/widgets.ts";
import { HEIGHT, WIDTH, fitView, integerScaling, scaleWithView, viewScale, worldSpriteScale } from "../ui/view.ts";
import type { Overworld } from "./Overworld.ts";

/** ACTION_COLOR: buttons that leave the overworld (DECK EDITOR, MULTIPLAYER, QUICK DUEL), a lighter blue than the settings. */
const BUTTON_COLOR = 0x2d4a7a, PICKED_COLOR = 0x3f7a3a, ACTION_COLOR = 0x4a72b0;
/**
 * The settings panel: centred, one row per setting; labels on the left, controls in a column from `controlX` on, all
 * `controlW` wide (a pair of buttons with the `gap` between them included). `h` counts the ZOOM row.
 */
const PANEL = { w: 230, h: 272, row: 22, controlX: 100, controlW: 120, gap: 6 };

/** The prebuilt decks and your custom decks as drop-down choices. */
const deckOptions = () => deckEntries().map((e) => ({ value: e.key, label: e.label }));

/**
 * Overlay on the Overworld (its own scene, so it doesn't scroll with the map camera): a MENU button at the top right
 * that opens the settings panel (also M): the player character (boy / girl), your deck, the quick duel's AI deck (NPCs
 * bring their own decks), whether the AI's hand and set cards are shown, the duel UI theme, integer SCALING or FIT,
 * the overworld's ZOOM; then DECK EDITOR, MULTIPLAYER, QUICK DUEL and FULL SCREEN.
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
    // Laid out in 640x360, scaled up with the overworld's full-detail game.
    scaleWithView(this);
    makeButton(this, WIDTH - 8 - 28, 8 + 7, 56, 14, "MENU (M)", () => this.toggle());
    this.input.keyboard!.on("keydown-M", () => this.toggle());
    // A resized window may offer other ZOOM sizes: an open panel is built again.
    const rebuild = () => {
      if (!this.isOpen) return;
      this.close();
      this.open();
    };
    this.scale.on(Phaser.Scale.Events.RESIZE, rebuild);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, rebuild));
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
    // ZOOM only where there's a choice: windows from 1280x720 on.
    const most = viewScale();
    const h = PANEL.h + (fullscreen ? PANEL.row : 0) - (most >= 2 ? 0 : PANEL.row);
    const left = Math.round((WIDTH - PANEL.w) / 2), top = Math.round((HEIGHT - h) / 2);
    // Full-screen shade that also swallows clicks meant for the map.
    const shade = this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x000000, 0.45).setOrigin(0).setInteractive();
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
    /**
     * Buttons side by side filling the control column (one choice each), rebuilt after a pick. Edges on whole pixels:
     * widths differ by a pixel where the column doesn't split evenly.
     */
    const choices = (rowY: number, labels: string[], picked: () => number, onPick: (i: number) => void) => {
      const step = (PANEL.controlW + PANEL.gap) / labels.length;
      let buttons: Button[] = [];
      const draw = () => {
        for (const b of buttons) b.destroy();
        buttons = labels.map((label, i) => {
          const l = Math.round(i * step), w = Math.round((i + 1) * step - PANEL.gap) - l;
          return add(makeButton(this, cx + l + Math.floor(w / 2), rowY, w, 14,
            label, () => { onPick(i); draw(); }, i === picked() ? PICKED_COLOR : BUTTON_COLOR));
        });
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
    // Applied once the click is done: the game may change size or zoom (the panel is then built again for it, the
    // resize handler above), the overworld's camera zooms.
    const refit = () => this.time.delayedCall(0, () => {
      fitView(this.game);
      (this.scene.get("Overworld") as Overworld).layoutView();
    });
    // Whole screen pixels only (borders around), or the whole window filled at any scale (src/ui/view.ts).
    choices(row("SCALING:"), ["INTEGER", "FIT"], () => (integerScaling() ? 0 : 1), (i) => {
      setIntegerScale(i === 0);
      refit();
    });
    // The sprite size, 1X up to the window's scale: the map shows as much more as the sprites are smaller.
    if (most >= 2) {
      const sizes = Array.from({ length: most }, (_, i) => i + 1);
      choices(row("ZOOM:"), sizes.map((s) => `${s}X`), () => worldSpriteScale() - 1, (i) => {
        setWorldZoom(sizes[i]);
        refit();
      });
    }

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

  /**
   * Leaves the overworld for the deck editor, the lobby or a quick duel behind the card wave; the player comes back to
   * the same spot.
   */
  private leave(scene: string, data?: object) {
    if (this.loadingTheme || transitioning(this.game)) return;
    const overworld = this.scene.get("Overworld") as Overworld;
    overworld.savePosition();
    void transitionTo(overworld, scene, data, { onCovered: () => this.scene.stop() });
  }
}
