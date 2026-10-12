import Phaser from "phaser";
import { WHITE, text } from "../ui/pixel.ts";

const TILE = 16;

/** Placeholder overworld: grid movement, and an "NPC" that starts a duel when you bump into it. */
export class Overworld extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private npc!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private moving = false;

  constructor() {
    super("Overworld");
  }

  create() {
    this.add.grid(320, 180, 640, 360, TILE, TILE, 0x1d3b1d, 1, 0x2a4f2a, 1);
    this.player = this.add.rectangle(TILE * 10 + 8, TILE * 10 + 8, TILE - 2, TILE - 2, 0x4fa3ff);
    this.npc = this.add.rectangle(TILE * 20 + 8, TILE * 10 + 8, TILE - 2, TILE - 2, 0xff5555);
    text(this, 8, 8, "ARROW KEYS TO MOVE. WALK INTO THE RED DUELIST TO CHALLENGE THEM.", { color: WHITE });
    text(this, 8, 16, "PRESS M TO DUEL A FRIEND (MULTIPLAYER).", { color: WHITE });
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.input.keyboard!.once("keydown-M", () => this.scene.start("Lobby"));
  }

  update() {
    if (this.moving) return;
    const dir = this.cursors.left.isDown ? [-1, 0] : this.cursors.right.isDown ? [1, 0]
      : this.cursors.up.isDown ? [0, -1] : this.cursors.down.isDown ? [0, 1] : null;
    if (!dir) return;
    const tx = this.player.x + dir[0] * TILE, ty = this.player.y + dir[1] * TILE;
    if (tx === this.npc.x && ty === this.npc.y) {
      this.scene.start("Duel", { opponentName: "Rival" });
      return;
    }
    this.moving = true;
    this.tweens.add({ targets: this.player, x: tx, y: ty, duration: 140, onComplete: () => (this.moving = false) });
  }
}
