import Phaser from "phaser";
import { WHITE, text } from "./pixel.ts";

const FILL = 0xffffff, ALPHA = 0.25, PRESSED = 0.55, OUTLINE = 0x000000;
/** D-pad: a cross centred at (x, y), arms `r` from the centre and `w` wide. Steering keeps working when the finger slides off. */
export const DPAD = { x: 60, y: 296, r: 38, w: 24 };
/** The X (talk / confirm) button. */
export const X_BUTTON = { x: 594, y: 300, r: 24 };
/** Finger this close to the D-pad's centre = no direction. */
const DEAD_ZONE = 8;

/**
 * Semi-transparent on-screen D-pad and X button for touch devices (fixed to the screen). `x` / `y` hold the steered
 * direction (-1, 0, 1 per axis, diagonals allowed); `onPress` gets a key code when a direction starts ("ArrowLeft",
 * ...) or X is tapped ("KeyX"), so dialogs can be answered like with the keyboard.
 */
export class TouchPad {
  x = 0;
  y = 0;
  private readonly pad: Phaser.GameObjects.Graphics;
  private readonly button: Phaser.GameObjects.Graphics;
  private padPointer: number | null = null;
  private buttonDown = false;

  constructor(scene: Phaser.Scene, onPress: (code: string) => void) {
    // A finger on the D-pad and one on X at the same time.
    scene.input.addPointer(Math.max(0, 3 - scene.input.manager.pointersTotal));
    this.pad = scene.add.graphics().setScrollFactor(0).setDepth(150);
    this.button = scene.add.graphics().setScrollFactor(0).setDepth(150);
    text(scene, X_BUTTON.x, X_BUTTON.y, "X", { color: WHITE, scale: 2, originX: 0.5, originY: 0.5 }).setScrollFactor(0).setDepth(151);

    const size = (DPAD.r + 10) * 2;
    const padZone = scene.add.zone(DPAD.x, DPAD.y, size, size).setScrollFactor(0).setInteractive();
    padZone.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.padPointer = p.id;
      this.steer(p, onPress);
    });
    scene.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (p.id === this.padPointer && p.isDown) this.steer(p, onPress);
    });
    const lift = (p: Phaser.Input.Pointer) => {
      if (p.id !== this.padPointer) return;
      this.padPointer = null;
      this.x = this.y = 0;
      this.drawPad();
    };
    // "outside" = the finger was lifted off the canvas (e.g. on the letterbox bars).
    scene.input.on("pointerup", lift).on("pointerupoutside", lift);

    const buttonZone = scene.add.zone(X_BUTTON.x, X_BUTTON.y, X_BUTTON.r * 2 + 8, X_BUTTON.r * 2 + 8).setScrollFactor(0).setInteractive();
    buttonZone.on("pointerdown", () => {
      this.buttonDown = true;
      this.drawButton();
      onPress("KeyX");
    });
    const release = () => {
      this.buttonDown = false;
      this.drawButton();
    };
    buttonZone.on("pointerup", release).on("pointerout", release);

    this.drawPad();
    this.drawButton();
  }

  private steer(p: Phaser.Input.Pointer, onPress: (code: string) => void) {
    const dx = p.x - DPAD.x, dy = p.y - DPAD.y;
    const axis = (d: number, other: number) => (Math.abs(d) > DEAD_ZONE && Math.abs(d) > Math.abs(other) * 0.5 ? Math.sign(d) : 0);
    const x = axis(dx, dy), y = axis(dy, dx);
    if (x !== 0 && x !== this.x) onPress(x < 0 ? "ArrowLeft" : "ArrowRight");
    if (y !== 0 && y !== this.y) onPress(y < 0 ? "ArrowUp" : "ArrowDown");
    if (x === this.x && y === this.y) return;
    this.x = x;
    this.y = y;
    this.drawPad();
  }

  private drawPad() {
    const { x, y, r, w } = DPAD, h = Math.floor(w / 2);
    const g = this.pad.clear();
    // Outline first (1px bigger), then the cross, then the held arms brighter.
    g.fillStyle(OUTLINE, ALPHA).fillRect(x - r - 1, y - h - 1, r * 2 + 2, w + 2).fillRect(x - h - 1, y - r - 1, w + 2, r * 2 + 2);
    g.fillStyle(FILL, ALPHA).fillRect(x - r, y - h, r * 2, w).fillRect(x - h, y - r, w, r * 2);
    g.fillStyle(FILL, PRESSED - ALPHA);
    if (this.x < 0) g.fillRect(x - r, y - h, r - h, w);
    if (this.x > 0) g.fillRect(x + h, y - h, r - h, w);
    if (this.y < 0) g.fillRect(x - h, y - r, w, r - h);
    if (this.y > 0) g.fillRect(x - h, y + h, w, r - h);
  }

  private drawButton() {
    const { x, y, r } = X_BUTTON;
    this.button.clear()
      .fillStyle(OUTLINE, ALPHA).fillCircle(x, y, r + 1)
      .fillStyle(FILL, this.buttonDown ? PRESSED : ALPHA).fillCircle(x, y, r);
  }
}
