import Phaser from "phaser";
import { WHITE, border, text } from "./pixel.ts";

const BG = 0x10102a, NAME = 0xffd75e, OPTION_OFF = 0x8888aa;
const MARGIN = 8, PAD = 10, H = 76, SCALE = 2;

/**
 * Overworld dialog box: speaker name, text and options (Yes / No, or just OK). It sits at the bottom of the camera's
 * view, or at the top when it would cover `avoid` (the player). Left/Right picks an option, X / Enter / Space
 * confirms, or click one. The scene forwards keydown events to `handleKey()` while the box is open.
 */
export class DialogBox {
  isOpen = false;
  private readonly container: Phaser.GameObjects.Container;
  private items: Phaser.GameObjects.GameObject[] = [];
  private options: string[] = [];
  private selected = 0;
  private optionTexts: Phaser.GameObjects.BitmapText[] = [];
  private cursor: Phaser.GameObjects.BitmapText | null = null;
  private onChoice: ((option: string) => void) | null = null;

  private readonly scene: Phaser.Scene;
  private readonly camera: Phaser.Cameras.Scene2D.Camera;

  constructor(scene: Phaser.Scene, camera: Phaser.Cameras.Scene2D.Camera) {
    this.scene = scene;
    this.camera = camera;
    this.container = scene.add.container(0, 0).setScrollFactor(0).setDepth(200).setVisible(false);
  }

  /** `onChoice(option)` runs after the box closes. */
  open(name: string, body: string, options: string[], onChoice: (option: string) => void, avoid?: Phaser.GameObjects.Sprite) {
    for (const o of this.items) o.destroy();
    const w = this.camera.width - MARGIN * 2;
    const bg = this.scene.add.graphics().fillStyle(BG, 0.92).fillRect(0, 0, w, H);
    border(bg, 0, 0, w, H, WHITE, 2);
    const nameText = text(this.scene, PAD, PAD, name.toUpperCase(), { color: NAME, scale: SCALE });
    const bodyText = text(this.scene, PAD, PAD + 16, body.toUpperCase(), { color: WHITE, scale: SCALE, maxWidth: w - PAD * 2 });
    const optY = H - PAD - 5 * SCALE;
    this.options = options;
    this.optionTexts = options.map((label, i) => {
      const t = text(this.scene, w - PAD - (options.length - i) * 64 + 14, optY, label.toUpperCase(), { color: WHITE, scale: SCALE });
      t.setInteractive({ useHandCursor: true })
        .on("pointerover", () => { this.selected = i; this.updateCursor(); })
        .on("pointerup", () => this.choose());
      return t;
    });
    this.cursor = text(this.scene, 0, optY, ">", { color: NAME, scale: SCALE });
    this.items = [bg, nameText, bodyText, ...this.optionTexts, this.cursor];
    // Input hit tests read each child's own scroll factor, not the container's.
    for (const o of this.items) (o as unknown as Phaser.GameObjects.Components.ScrollFactor).setScrollFactor(0);
    this.container.add(this.items);

    this.onChoice = onChoice;
    this.selected = 0;
    this.updateCursor();
    const bottom = this.camera.height - H - MARGIN;
    const avoidBottom = avoid ? avoid.getBounds().bottom - this.camera.worldView.y : 0;
    this.container.setPosition(this.camera.x + MARGIN, this.camera.y + (avoidBottom > bottom ? MARGIN : bottom)).setVisible(true);
    this.isOpen = true;
  }

  close() {
    this.container.setVisible(false);
    this.isOpen = false;
  }

  handleKey(event: KeyboardEvent) {
    switch (event.code) {
      case "ArrowLeft":
        this.selected = Math.max(0, this.selected - 1);
        this.updateCursor();
        break;
      case "ArrowRight":
        this.selected = Math.min(this.options.length - 1, this.selected + 1);
        this.updateCursor();
        break;
      case "KeyX":
      case "Enter":
      case "Space":
        this.choose();
        break;
    }
  }

  private choose() {
    if (!this.isOpen) return;
    this.close();
    this.onChoice?.(this.options[this.selected]);
  }

  private updateCursor() {
    const opt = this.optionTexts[this.selected];
    this.cursor!.x = opt.x - 4 * SCALE;
    this.optionTexts.forEach((t, i) => t.setTint(i === this.selected ? WHITE : OPTION_OFF));
  }
}
