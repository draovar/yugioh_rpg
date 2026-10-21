import Phaser from "phaser";
import { DECKS, type DeckName } from "../duel/decks.ts";
import { DialogBox } from "../ui/DialogBox.ts";
import { WHITE, text } from "../ui/pixel.ts";
import { chosenDeck } from "../ui/prefs.ts";
import { DPAD, TouchPad, X_BUTTON } from "../ui/TouchPad.ts";
import { TOUCH } from "../ui/touch.ts";
import type { DuelSceneData } from "./DuelScene.ts";
import type { WorldMenu } from "./WorldMenu.ts";

const MAP = "overworld-map", TILES = "overworld-tiles", PLAYER = "overworld-player", NPC_SHEET = "overworld-npcs";
/** Which map to show: `&map=NAME` (data/maps/NAME.tmj, e.g. `maze`) until maps link to each other. */
const MAP_NAME = new URLSearchParams(location.search).get("map")?.replace(/[^\w-]/g, "") || "overworld";

/** Called from Boot. The map and its tiles come from `npm run build-tiles` (public/maps/, gitignored). */
export function loadOverworld(load: Phaser.Loader.LoaderPlugin) {
  load.tilemapTiledJSON(MAP, `maps/${MAP_NAME}.json`);
  load.image(TILES, `maps/${MAP_NAME}.png`);
  load.spritesheet(PLAYER, "assets/overworld/player.png", { frameWidth: 32, frameHeight: 32 });
  // One frame per character: Yugi, Kaiba, Joey, Bonz.
  load.spritesheet(NPC_SHEET, "assets/overworld/npcs.png", { frameWidth: 32, frameHeight: 32 });
}

interface NpcDef {
  name: string;
  /** Frame in npcs.png. */
  frame: number;
  x: number;
  y: number;
  text: string;
  deck: DeckName;
}

// Placeholder text until real dialog is written. They stand on the overworld map only.
const NPCS: NpcDef[] = MAP_NAME !== "overworld" ? [] : [
  { name: "Yugi", frame: 0, x: 500, y: 440, text: "Hey! Do you want to duel?", deck: "yugi" },
  { name: "Kaiba", frame: 1, x: 680, y: 440, text: "Hmph. Do you think you can beat me?", deck: "kaiba" },
  { name: "Joey", frame: 2, x: 160, y: 690, text: "Yo! Wanna see my Red-Eyes?", deck: "dragonsRoar" },
  { name: "Bonz", frame: 3, x: 120, y: 150, text: "Heh heh... care for a shadow game?", deck: "zombieMadness" },
];

const TALK_DISTANCE = 56, SPEED = 100;
type Facing = "down" | "side" | "up";
const IDLE_FRAME: Record<Facing, number> = { down: 2, side: 5, up: 8 };

/** Where the player stood when they left for a duel or the lobby, and who they were dueling. */
let saved: { x: number; y: number; facing: Facing; flipX: boolean; opponent?: string } | null = null;

/**
 * The overworld: a Tiled map, the player (arrow keys) and NPCs to talk to (X). Saying yes to an NPC starts a duel
 * with their deck; afterwards you're back on the same spot. Settings live in the WorldMenu overlay scene.
 */
export class Overworld extends Phaser.Scene {
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private npcs!: Phaser.Physics.Arcade.StaticGroup;
  private walls!: Phaser.Tilemaps.TilemapLayer;
  /** The map's hidden "collision" layer, if it has one. */
  private blockers: Phaser.Tilemaps.TilemapLayer | null = null;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  /** On-screen D-pad and X on touch devices. */
  private pad: TouchPad | null = null;
  private dialog!: DialogBox;
  private talkHint!: Phaser.GameObjects.BitmapText;
  private facing: Facing = "down";
  private duelResult: { won: boolean } | undefined;
  /** Chips (placeholder: nothing earns or spends them yet). */
  private chips = 2;

  constructor() {
    super({ key: "Overworld", physics: { default: "arcade", arcade: {} } });
  }

  init(data: { duelResult?: { won: boolean } }) {
    this.duelResult = data?.duelResult;
  }

  create() {
    this.scene.launch("WorldMenu");
    if (!this.cache.tilemap.exists(MAP)) {
      text(this, 320, 170, "NO MAP: RUN NPM RUN BUILD-TILES (NEEDS VENDOR/PAID)", { color: WHITE, originX: 0.5 });
      return;
    }
    const map = this.make.tilemap({ key: MAP });
    const tileset = map.addTilesetImage("world", TILES)!;

    // Ground layers (ground, ground2, ground3...): no collision, always under everything.
    const grounds = map.layers.filter((l) => l.name.startsWith("ground")).map((l) => map.createLayer(l.name, tileset, 0, 0)!);
    this.bake(grounds).setDepth(0);

    // Optional hidden "collision" layer: every tile in it blocks, whatever it shows (a map's exact footprints).
    this.blockers = map.getLayerIndex("collision") === null ? null
      : (map.createLayer("collision", tileset, 0, 0) as Phaser.Tilemaps.TilemapLayer).setVisible(false).setCollisionByExclusion([-1]);

    // The walls layer is only used for collision and is not drawn: its tiles are redrawn in y-sorted layers.
    this.walls = (map.createLayer("walls", tileset, 0, 0) as Phaser.Tilemaps.TilemapLayer).setVisible(false);
    this.walls.setCollisionByProperty({ collision: true });
    this.buildSortedWalls(map, tileset, this.walls);

    const walk = (key: string, start: number, end: number, frameRate: number) => {
      if (!this.anims.exists(key)) {
        this.anims.create({ key, frames: this.anims.generateFrameNumbers(PLAYER, { start, end }), frameRate, repeat: -1 });
      }
    };
    walk("walk-down", 0, 1, 4);
    walk("walk-side", 3, 5, 6);
    walk("walk-up", 6, 7, 4);

    // The 32px character frames are drawn at 2x. Body size/offset are in frame pixels and scale with the sprite.
    // A map can place the start with a point object named "spawn" (layer "objects").
    const spawn = map.findObject("objects", (o) => o.name === "spawn");
    this.player = this.physics.add.sprite(saved?.x ?? spawn?.x ?? 400, saved?.y ?? spawn?.y ?? 520, PLAYER).setScale(2);
    this.player.body.setSize(16, 16, false).setOffset(8, 16);
    // Snapped like the (unscaled) map, which "safeAuto" would skip at 2x: no half-pixel shimmer against the ground.
    this.player.vertexRoundMode = "fullAuto";
    this.player.setCollideWorldBounds(true);
    if (saved) {
      this.facing = saved.facing;
      this.player.setFlipX(saved.flipX);
    }
    this.player.setFrame(IDLE_FRAME[this.facing]);
    this.physics.add.collider(this.player, this.walls);
    if (this.blockers) this.physics.add.collider(this.player, this.blockers);
    this.sortByFeet(this.player);

    // NPCs are y-sorted against the player and the walls, see sortByFeet().
    this.npcs = this.physics.add.staticGroup();
    for (const def of NPCS) {
      const npc = (this.npcs.create(def.x, def.y, NPC_SHEET, def.frame) as Phaser.Physics.Arcade.Sprite).setScale(2).refreshBody();
      // Static bodies use world pixels: a 32x32 box at the feet, like the player's.
      npc.body!.setSize(32, 32, false).setOffset(16, 32);
      npc.setData("def", def);
      npc.vertexRoundMode = "fullAuto";
      this.sortByFeet(npc);
    }
    this.physics.add.collider(this.player, this.npcs);

    text(this, 8, 8, `CHIPS: ${this.chips}`, { color: WHITE, scale: 2 }).setScrollFactor(0).setDepth(100);
    this.talkHint = text(this, 0, 0, "X", { color: 0xffd75e, scale: 2 }).setDepth(150).setVisible(false);
    // On touch devices the dialog sits between the D-pad and the X button.
    this.pad = TOUCH ? new TouchPad(this, (code) => this.handleKey(code)) : null;
    this.dialog = new DialogBox(this, this.cameras.main, TOUCH
      ? { left: DPAD.x + DPAD.r + 8, right: 640 - (X_BUTTON.x - X_BUTTON.r) + 8 } : undefined);

    // Key events rather than JustDown polling, so quick taps are never missed.
    this.input.keyboard!.on("keydown", (event: KeyboardEvent) => this.handleKey(event.code));

    // roundPixels: startFollow's default (false) would switch off the game's pixel snapping for this camera, and at
    // half-pixel scrolls the baked wall strips then leave 1px seams.
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels).startFollow(this.player, true);
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cursors = this.input.keyboard!.createCursorKeys();

    const opponent = saved?.opponent;
    saved = null;
    if (this.duelResult && opponent) {
      const won = this.duelResult.won;
      // A frame later: the camera only moves to the player on the first render, and the box avoids the player.
      this.time.delayedCall(0, () => this.dialog.open(opponent, won ? "Not bad... you got me this time." : "Better luck next time!",
        ["OK"], () => {}, this.player));
    }
  }

  private menuOpen() {
    return (this.scene.get("WorldMenu") as WorldMenu).isOpen;
  }

  /** Remembers where the player stands, so coming back from a duel or the lobby puts them on the same spot. */
  /** A key press, or the touch pad's: answers the open dialog, else X / Enter / Space talks to the nearest NPC. */
  private handleKey(code: string) {
    if (this.menuOpen()) return;
    if (this.dialog.isOpen) this.dialog.handleKey(code);
    else if (code === "KeyX" || code === "Enter" || code === "Space") {
      const npc = this.nearestNpc();
      if (npc) this.talkTo(npc);
    }
  }

  savePosition(opponent?: string) {
    if (!this.player) return;
    saved = { x: Math.round(this.player.x), y: Math.round(this.player.y), facing: this.facing, flipX: this.player.flipX, opponent };
  }

  /**
   * For every wall tile, the y its "base" sits on. A tile is drawn behind a character when its base is above the
   * character's feet.
   *  - collision tiles use their own bottom edge
   *  - non-collision tiles (tree tops, roofs) use the bottom of the collision tiles below them in the same column,
   *    so a whole tree sorts by its trunk
   *  - if there is none in that column (edge of a tree crown), the lowest collision tile of the connected group
   *  - purely decorative groups with no collision use their own bottom edge
   * A cell of the "collision" layer counts as a collision tile, with or without a wall tile on it (a tree whose trunk
   * is drawn on a ground layer still sorts by it).
   */
  private wallBaseY(layer: Phaser.Tilemaps.TilemapLayer): Map<Phaser.Tilemaps.Tile, number> {
    const { width: w, height: h } = layer.layer;
    const tileH = layer.tilemap.tileHeight;
    const get = (x: number, y: number) => {
      const t = layer.getTileAt(x, y);
      return t && t.index !== -1 ? t : null;
    };
    const blocked = (x: number, y: number) => !!this.blockers?.hasTileAt(x, y);
    const collides = (t: Phaser.Tilemaps.Tile) => !!(t.properties as { collision?: boolean })?.collision || blocked(t.x, t.y);
    const solid = (x: number, y: number) => { const t = get(x, y); return t ? collides(t) : blocked(x, y); };

    const groupBase = new Map<Phaser.Tilemaps.Tile, number>();
    const seen = new Set<Phaser.Tilemaps.Tile>();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const start = get(x, y);
        if (!start || seen.has(start)) continue;
        // Flood fill one group of touching wall tiles.
        const group: Phaser.Tilemaps.Tile[] = [];
        const stack = [start];
        seen.add(start);
        let base = -1;
        while (stack.length) {
          const t = stack.pop()!;
          group.push(t);
          if (collides(t)) base = Math.max(base, t.bottom);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = get(t.x + dx, t.y + dy);
            if (n && !seen.has(n)) { seen.add(n); stack.push(n); }
          }
        }
        for (const t of group) groupBase.set(t, base);
      }
    }

    const baseYs = new Map<Phaser.Tilemaps.Tile, number>();
    layer.forEachTile((tile) => {
      if (tile.index === -1) return;
      let baseY = tile.bottom;
      if (!collides(tile)) {
        // Walk down the column to the first collision tile, then to the end of that run.
        let y = tile.y + 1;
        while (y < h && get(tile.x, y) && !solid(tile.x, y)) y++;
        if (y < h && solid(tile.x, y)) {
          while (y < h && solid(tile.x, y)) baseY = (++y) * tileH;
        } else {
          const group = groupBase.get(tile) ?? -1;
          baseY = group >= 0 ? group : tile.bottom;
        }
      }
      baseYs.set(tile, baseY);
    });
    return baseYs;
  }

  /**
   * Wall tiles that share a base y go into one layer, whose depth comes from the base y the same way characters get
   * theirs from their feet. So walls, the player and NPCs all sort together. Each layer only covers its tiles' rows.
   */
  private buildSortedWalls(map: Phaser.Tilemaps.Tilemap, tileset: Phaser.Tilemaps.Tileset, layer: Phaser.Tilemaps.TilemapLayer) {
    const byBase = new Map<number, Phaser.Tilemaps.Tile[]>();
    for (const [tile, baseY] of this.wallBaseY(layer)) {
      if (!byBase.has(baseY)) byBase.set(baseY, []);
      byBase.get(baseY)!.push(tile);
    }
    for (const [baseY, tiles] of byBase) {
      const top = Math.min(...tiles.map((t) => t.y));
      const bottom = Math.max(...tiles.map((t) => t.y));
      const sorted = map.createBlankLayer(`walls_${baseY}`, tileset, 0, top * map.tileHeight, map.width, bottom - top + 1)!;
      for (const t of tiles) sorted.putTileAt(t.index, t.x, t.y - top);
      // -0.5 so a character standing exactly on the base is drawn in front.
      this.bake([sorted]).setDepth(this.depthForY(baseY - 0.5));
    }
  }

  /**
   * Static tile layers drawn once into a texture, which replaces them: a tilemap layer re-culls and re-submits every
   * visible tile each frame, which kept phones busy (and hot) while nothing moved. All layers share the first's area.
   */
  private bake(layers: (Phaser.Tilemaps.TilemapLayer | Phaser.Tilemaps.TilemapGPULayer)[]): Phaser.GameObjects.RenderTexture {
    const { x, y, width, height } = layers[0];
    const rt = this.add.renderTexture(x, y, width, height).setOrigin(0);
    rt.draw(layers, -x, -y).render();
    for (const l of layers) l.destroy();
    return rt;
  }

  /** Everything y-sorted lives in depth 2..3: lower on screen = drawn later. */
  private depthForY(y: number) {
    return 2 + y / 100000;
  }

  private sortByFeet(sprite: Phaser.GameObjects.Sprite) {
    sprite.setDepth(this.depthForY(sprite.getBounds().bottom));
  }

  private nearestNpc(): Phaser.Physics.Arcade.Sprite | null {
    let best: Phaser.Physics.Arcade.Sprite | null = null;
    let bestDist = TALK_DISTANCE;
    const p = this.player.body.center;
    for (const npc of this.npcs.getChildren() as Phaser.Physics.Arcade.Sprite[]) {
      const d = Phaser.Math.Distance.BetweenPoints(p, npc.body!.center);
      if (d < bestDist) { best = npc; bestDist = d; }
    }
    return best;
  }

  private talkTo(npc: Phaser.Physics.Arcade.Sprite) {
    const def = npc.getData("def") as NpcDef;
    this.dialog.open(def.name, def.text, ["Yes", "No"], (choice) => {
      if (choice !== "Yes") return;
      this.savePosition(def.name);
      const data: DuelSceneData = { opponentName: def.name, playerDeck: chosenDeck().deck, opponentDeck: DECKS[def.deck].deck };
      this.scene.stop("WorldMenu");
      this.scene.start("Duel", data);
    }, this.player);
  }

  update() {
    if (!this.player) return;
    if (this.dialog.isOpen || this.menuOpen()) {
      this.player.setVelocity(0, 0);
      this.player.anims.stop();
      this.player.setFrame(IDLE_FRAME[this.facing]);
      this.talkHint.setVisible(false);
      return;
    }

    const npc = this.nearestNpc();
    this.talkHint.setVisible(!!npc);
    if (npc) this.talkHint.setPosition(Math.round(npc.x - this.talkHint.width / 2), Math.round(npc.getBounds().top - 2 - this.talkHint.height));

    let vx = 0, vy = 0;
    if (this.cursors.left.isDown || this.pad?.x === -1) vx = -SPEED;
    if (this.cursors.right.isDown || this.pad?.x === 1) vx = SPEED;
    if (this.cursors.up.isDown || this.pad?.y === -1) vy = -SPEED;
    if (this.cursors.down.isDown || this.pad?.y === 1) vy = SPEED;
    this.player.setVelocity(vx, vy);
    this.player.body.velocity.normalize().scale(SPEED); // same speed on diagonals

    // Horizontal wins when moving diagonally.
    if (vx !== 0) {
      this.facing = "side";
      this.player.setFlipX(vx < 0);
    } else if (vy < 0) this.facing = "up";
    else if (vy > 0) this.facing = "down";

    if (vx !== 0 || vy !== 0) this.player.play(`walk-${this.facing}`, true);
    else {
      this.player.anims.stop();
      this.player.setFrame(IDLE_FRAME[this.facing]);
    }
    this.sortByFeet(this.player);
  }
}
