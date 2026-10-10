import Phaser from "phaser";

const TILE = 32;

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
    this.add.grid(640, 360, 1280, 720, TILE, TILE, 0x1d3b1d, 1, 0x2a4f2a, 1);
    this.player = this.add.rectangle(TILE * 5 + 16, TILE * 5 + 16, TILE - 4, TILE - 4, 0x4fa3ff);
    this.npc = this.add.rectangle(TILE * 12 + 16, TILE * 5 + 16, TILE - 4, TILE - 4, 0xff5555);
    this.add.text(16, 16, "Arrow keys to move. Walk into the red duelist to start a (bot vs bot) duel.", { color: "#ffffff" });
    this.cursors = this.input.keyboard!.createCursorKeys();
  }

  update() {
    if (this.moving) return;
    const dir = this.cursors.left.isDown ? [-1, 0] : this.cursors.right.isDown ? [1, 0]
      : this.cursors.up.isDown ? [0, -1] : this.cursors.down.isDown ? [0, 1] : null;
    if (!dir) return;
    const tx = this.player.x + dir[0] * TILE, ty = this.player.y + dir[1] * TILE;
    if (tx === this.npc.x && ty === this.npc.y) {
      this.scene.start("DuelTest");
      return;
    }
    this.moving = true;
    this.tweens.add({ targets: this.player, x: tx, y: ty, duration: 140, onComplete: () => (this.moving = false) });
  }
}
