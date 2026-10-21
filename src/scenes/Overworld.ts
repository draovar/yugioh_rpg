import Phaser from "phaser";
import { DECKS, type DeckName } from "../duel/decks.ts";
import { DialogBox } from "../ui/DialogBox.ts";
import { WHITE, text } from "../ui/pixel.ts";
import { chosenDeck } from "../ui/prefs.ts";
import { DPAD, TouchPad, X_BUTTON } from "../ui/TouchPad.ts";
import { TOUCH } from "../ui/touch.ts";
import type { DuelSceneData } from "./DuelScene.ts";
import type { WorldMenu } from "./WorldMenu.ts";

const CHARACTERS = "overworld-characters";
const mapKey = (name: string) => `map-${name}`, tilesKey = (name: string) => `tiles-${name}`;

/** The map the player is on (data/maps/NAME.tmj). Starts on `&map=NAME` (e.g. `maze`), else the town. */
let currentMap = new URLSearchParams(location.search).get("map")?.replace(/[^\w-]/g, "") || "overworld";

/** A map and its tiles, from `npm run build-tiles` (public/maps/, gitignored). Loaded once, on first visit. */
function loadMap(load: Phaser.Loader.LoaderPlugin, name: string) {
  if (load.cacheManager.tilemap.exists(mapKey(name))) return;
  load.tilemapTiledJSON(mapKey(name), `maps/${name}.json`);
  load.image(tilesKey(name), `maps/${name}.png`);
}

/** Called from Boot: the characters and the first map. */
export function loadOverworld(load: Phaser.Loader.LoaderPlugin) {
  loadMap(load, currentMap);
  // Every character, from `npm run build-characters` (data/characters/); names in characters.json, picks in
  // docs/characters.png.
  load.spritesheet(CHARACTERS, "assets/overworld/characters.png", { frameWidth: 32, frameHeight: 32 });
  load.json(CHARACTERS, "assets/overworld/characters.json");
}

type Facing = "down" | "side" | "up";
const FACINGS: Facing[] = ["down", "side", "up"];

/** A character's frame in characters.png: 9 per character, down / side (facing right) / up × stand, step, step. */
function frameOf(scene: Phaser.Scene, name: string, facing: Facing, step = 0): number {
  const index = (scene.cache.json.get(CHARACTERS) as { names: string[] }).names.indexOf(name);
  if (index < 0) throw new Error(`no character "${name}" in characters.json`);
  return index * 9 + FACINGS.indexOf(facing) * 3 + step;
}

/** The character's walk animation for a facing (step, stand, other step, stand), created on first use. */
function walkAnim(scene: Phaser.Scene, name: string, facing: Facing): string {
  const key = `${name}-walk-${facing}`;
  if (!scene.anims.exists(key)) {
    const frames = [1, 0, 2, 0].map((step) => ({ key: CHARACTERS, frame: frameOf(scene, name, facing, step) }));
    scene.anims.create({ key, frames, frameRate: 8, repeat: -1 });
  }
  return key;
}

interface NpcDef {
  name: string;
  /** Character in characters.json (docs/characters.png shows them all). */
  sprite: string;
  /** Where they look while nobody talks to them (default down; side = right, left = side flipped). */
  facing?: Facing | "left";
  x: number;
  y: number;
  text: string;
  deck: DeckName;
}

// NPCs by map. Placeholder text until real dialog is written.
const NPCS: Record<string, NpcDef[]> = {
  overworld: [
    { name: "Yugi", sprite: "yugi", x: 500, y: 440, text: "Hey! Do you want to duel?", deck: "yugi" },
    { name: "Kaiba", sprite: "kaiba", x: 680, y: 440, text: "Hmph. Do you think you can beat me?", deck: "kaiba" },
    { name: "Joey", sprite: "joey", x: 160, y: 690, text: "Yo! Wanna see my Red-Eyes?", deck: "dragonsRoar" },
    { name: "Bonz", sprite: "bonz", x: 120, y: 150, text: "Heh heh... care for a shadow game?", deck: "zombieMadness" },
  ],
};

const TALK_DISTANCE = 56, SPEED = 100, FADE_MS = 200;

/** Where the player stood when they left for a duel or the lobby, and who they were dueling. */
let saved: { x: number; y: number; facing: Facing; flipX: boolean; opponent?: string } | null = null;
/** Set when walking through a warp: the point to arrive at, and the height to keep (maps placed side by side). */
let arrival: { spawn: string; y?: number; facing: Facing; flipX: boolean } | null = null;

/**
 * The overworld: a Tiled map, the player (arrow keys) and NPCs to talk to (X). Saying yes to an NPC starts a duel
 * with their deck; afterwards you're back on the same spot. Settings live in the WorldMenu overlay scene.
 */
export class Overworld extends Phaser.Scene {
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private npcs!: Phaser.Physics.Arcade.StaticGroup;
  private walls: Phaser.Tilemaps.TilemapLayer[] = [];
  /** The map's hidden "collision" layer, if it has one. */
  private blockers: Phaser.Tilemaps.TilemapLayer | null = null;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  /** On-screen D-pad and X on touch devices. */
  private pad: TouchPad | null = null;
  private dialog!: DialogBox;
  private talkHint!: Phaser.GameObjects.BitmapText;
  private facing: Facing = "down";
  private duelResult: { won: boolean } | undefined;
  /** Fading out towards another map: no second warp, no movement. */
  private warping = false;
  /** Chips (placeholder: nothing earns or spends them yet). */
  private chips = 2;

  constructor() {
    super({ key: "Overworld", physics: { default: "arcade", arcade: {} } });
  }

  init(data: { duelResult?: { won: boolean } }) {
    this.duelResult = data?.duelResult;
    this.warping = false;
  }

  /** A map visited for the first time (through a warp) loads here. */
  preload() {
    loadMap(this.load, currentMap);
  }

  create() {
    this.scene.launch("WorldMenu");
    if (!this.cache.tilemap.exists(mapKey(currentMap))) {
      text(this, 320, 170, "NO MAP: RUN NPM RUN BUILD-TILES (NEEDS VENDOR/PAID)", { color: WHITE, originX: 0.5 });
      return;
    }
    const map = this.make.tilemap({ key: mapKey(currentMap) });
    const tileset = map.addTilesetImage("world", tilesKey(currentMap))!;

    // Ground layers (ground, ground2, ground3...): no collision, always under everything.
    const grounds = map.layers.filter((l) => l.name.startsWith("ground")).map((l) => map.createLayer(l.name, tileset, 0, 0)!);
    this.bake(grounds).setDepth(0);

    // Optional hidden "collision" layer: every tile in it blocks, whatever it shows (a map's exact footprints).
    this.blockers = map.getLayerIndex("collision") === null ? null
      : (map.createLayer("collision", tileset, 0, 0) as Phaser.Tilemaps.TilemapLayer).setVisible(false).setCollisionByExclusion([-1]);

    // Walls layers (walls, walls2...) are only used for collision and are not drawn: their tiles are redrawn in
    // y-sorted layers.
    this.walls = map.layers.filter((l) => l.name.startsWith("walls")).map((l) =>
      (map.createLayer(l.name, tileset, 0, 0) as Phaser.Tilemaps.TilemapLayer).setVisible(false).setCollisionByProperty({ collision: true }));
    this.buildSortedWalls(map, tileset, this.walls);

    // The 32px character frames are drawn at 2x. Body size/offset are in frame pixels and scale with the sprite.
    // Start: back from a duel on the same spot, through a warp at its arrival point (layer "objects"), else at the
    // map's point named "spawn".
    const point = (name: string) => map.findObject("objects", (o) => o.name === name);
    const at = arrival ? point(arrival.spawn) : point("spawn");
    const x = saved?.x ?? at?.x ?? 400;
    let y = saved?.y ?? arrival?.y ?? at?.y ?? 520;
    if (!saved) y = this.freeY(x, y);
    this.player = this.physics.add.sprite(x, y, CHARACTERS, frameOf(this, "player", "down")).setScale(2);
    this.player.body.setSize(16, 16, false).setOffset(8, 16);
    // Snapped like the (unscaled) map, which "safeAuto" would skip at 2x: no half-pixel shimmer against the ground.
    this.player.vertexRoundMode = "fullAuto";
    this.player.setCollideWorldBounds(true);
    const facing = saved ?? arrival;
    if (facing) {
      this.facing = facing.facing;
      this.player.setFlipX(facing.flipX);
    }
    arrival = null;
    this.player.setFrame(frameOf(this, "player", this.facing));
    for (const walls of this.walls) this.physics.add.collider(this.player, walls);
    if (this.blockers) this.physics.add.collider(this.player, this.blockers);
    this.sortByFeet(this.player);

    // NPCs are y-sorted against the player and the walls, see sortByFeet().
    this.npcs = this.physics.add.staticGroup();
    for (const def of NPCS[currentMap] ?? []) {
      const npc = (this.npcs.create(def.x, def.y, CHARACTERS) as Phaser.Physics.Arcade.Sprite).setScale(2).refreshBody();
      npc.setData("def", def);
      this.face(npc, def.facing ?? "down");
      // Static bodies use world pixels: a 32x32 box at the feet, like the player's.
      npc.body!.setSize(32, 32, false).setOffset(16, 32);
      npc.vertexRoundMode = "fullAuto";
      this.sortByFeet(npc);
    }
    this.physics.add.collider(this.player, this.npcs);

    // Warps: rectangles named "warp" (layer "objects") with properties map (target map) and spawn (the point to
    // arrive at there); keepY keeps the player's height, for maps placed side by side with their tops aligned.
    for (const o of map.getObjectLayer("objects")?.objects ?? []) {
      if (o.name !== "warp") continue;
      const prop = (name: string) => (o.properties as { name: string; value: unknown }[] | undefined)?.find((p) => p.name === name)?.value;
      const zone = this.add.zone(o.x! + o.width! / 2, o.y! + o.height! / 2, o.width!, o.height!);
      this.physics.add.existing(zone, true);
      this.physics.add.overlap(this.player, zone, () =>
        this.warp(String(prop("map")), String(prop("spawn")), prop("keepY") === true));
    }

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
    this.cameras.main.fadeIn(FADE_MS);
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

  /** Fades out and starts the target map at its arrival point. */
  private warp(mapName: string, spawn: string, keepY: boolean) {
    if (this.warping) return;
    this.warping = true;
    this.player.setVelocity(0, 0);
    arrival = { spawn, y: keepY ? Math.round(this.player.y) : undefined, facing: this.facing, flipX: this.player.flipX };
    this.cameras.main.fadeOut(FADE_MS);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      currentMap = mapName;
      this.scene.restart();
    });
  }

  /**
   * The nearest y (stepping a tile at a time, up to 10) where the player's feet box at x is clear of walls, for arrival
   * points that may land on something solid (a warp keeping the height across maps).
   */
  private freeY(x: number, y: number): number {
    const clear = (yy: number) => [...this.walls, ...(this.blockers ? [this.blockers] : [])]
      .every((l) => l.getTilesWithinWorldXY(x - 15, yy + 1, 30, 30, { isColliding: true }).length === 0);
    for (let d = 0; d <= 160; d += 16) {
      if (clear(y + d)) return y + d;
      if (clear(y - d)) return y - d;
    }
    return y;
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
   * is drawn on a ground layer still sorts by it). All walls layers count together: a crown on walls2 sorts by the
   * trunk below it on walls.
   */
  private wallBaseY(layers: Phaser.Tilemaps.TilemapLayer[]): Map<Phaser.Tilemaps.Tile, number> {
    const { width: w, height: h } = layers[0].layer;
    const tileH = layers[0].tilemap.tileHeight;
    const tilesAt = (x: number, y: number) => layers.map((l) => l.getTileAt(x, y)).filter((t): t is Phaser.Tilemaps.Tile => !!t && t.index !== -1);
    const blocked = (x: number, y: number) => !!this.blockers?.hasTileAt(x, y);
    const collides = (t: Phaser.Tilemaps.Tile) => !!(t.properties as { collision?: boolean })?.collision || blocked(t.x, t.y);
    const occupied = (x: number, y: number) => tilesAt(x, y).length > 0;
    const solid = (x: number, y: number) => blocked(x, y) || tilesAt(x, y).some(collides);

    // Groups of touching wall cells (any walls layer): the lowest collision bottom of each.
    const groupBase = new Int32Array(w * h).fill(-1);
    const seen = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (seen[y * w + x] || !occupied(x, y)) continue;
        const group: number[] = [];
        const stack = [y * w + x];
        seen[y * w + x] = 1;
        let base = -1;
        while (stack.length) {
          const k = stack.pop()!, cx = k % w, cy = (k - cx) / w;
          group.push(k);
          if (solid(cx, cy)) base = Math.max(base, (cy + 1) * tileH);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || !occupied(nx, ny)) continue;
            seen[ny * w + nx] = 1;
            stack.push(ny * w + nx);
          }
        }
        for (const k of group) groupBase[k] = base;
      }
    }

    const baseYs = new Map<Phaser.Tilemaps.Tile, number>();
    for (const layer of layers) {
      layer.forEachTile((tile) => {
        if (tile.index === -1) return;
        let baseY = tile.bottom;
        if (!collides(tile)) {
          // Walk down the column to the first collision tile, then to the end of that run.
          let y = tile.y + 1;
          while (y < h && occupied(tile.x, y) && !solid(tile.x, y)) y++;
          if (y < h && solid(tile.x, y)) {
            while (y < h && solid(tile.x, y)) baseY = (++y) * tileH;
          } else {
            const group = groupBase[tile.y * w + tile.x];
            baseY = group >= 0 ? group : tile.bottom;
          }
        }
        baseYs.set(tile, baseY);
      });
    }
    return baseYs;
  }

  /**
   * Wall tiles that share a base y go into one layer, whose depth comes from the base y the same way characters get
   * theirs from their feet. So walls, the player and NPCs all sort together. Each layer only covers its tiles' rows.
   * Every walls layer gets its own strips (two layers can fill the same cell); a later layer is drawn over an earlier
   * one on the same base.
   */
  private buildSortedWalls(map: Phaser.Tilemaps.Tilemap, tileset: Phaser.Tilemaps.Tileset, layers: Phaser.Tilemaps.TilemapLayer[]) {
    const strips = new Map<string, { order: number; baseY: number; tiles: Phaser.Tilemaps.Tile[] }>();
    for (const [tile, baseY] of this.wallBaseY(layers)) {
      const order = layers.indexOf(tile.tilemapLayer as Phaser.Tilemaps.TilemapLayer), key = `${order}:${baseY}`;
      if (!strips.has(key)) strips.set(key, { order, baseY, tiles: [] });
      strips.get(key)!.tiles.push(tile);
    }
    for (const [key, { order, baseY, tiles }] of strips) {
      const top = Math.min(...tiles.map((t) => t.y));
      const bottom = Math.max(...tiles.map((t) => t.y));
      const sorted = map.createBlankLayer(`walls_${key}`, tileset, 0, top * map.tileHeight, map.width, bottom - top + 1)!;
      for (const t of tiles) sorted.putTileAt(t.index, t.x, t.y - top);
      // -0.5 so a character standing exactly on the base is drawn in front.
      this.bake([sorted]).setDepth(this.depthForY(baseY - 0.5) + order * 1e-7);
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

  /** Shows an NPC's standing frame for a facing ("left" = the side view flipped). */
  private face(npc: Phaser.Physics.Arcade.Sprite, facing: Facing | "left") {
    const def = npc.getData("def") as NpcDef | undefined;
    npc.setFrame(frameOf(this, def?.sprite ?? "", facing === "left" ? "side" : facing)).setFlipX(facing === "left");
  }

  private talkTo(npc: Phaser.Physics.Arcade.Sprite) {
    const def = npc.getData("def") as NpcDef;
    // The NPC turns to the player while talking (the larger offset decides), then back.
    const dx = this.player.x - npc.x, dy = this.player.y - npc.y;
    this.face(npc, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "side" : "left") : dy > 0 ? "down" : "up");
    this.dialog.open(def.name, def.text, ["Yes", "No"], (choice) => {
      this.face(npc, def.facing ?? "down");
      if (choice !== "Yes") return;
      this.savePosition(def.name);
      const data: DuelSceneData = { opponentName: def.name, playerDeck: chosenDeck().deck, opponentDeck: DECKS[def.deck].deck };
      this.scene.stop("WorldMenu");
      this.scene.start("Duel", data);
    }, this.player);
  }

  update() {
    if (!this.player) return;
    if (this.warping) {
      this.player.setVelocity(0, 0);
      return;
    }
    if (this.dialog.isOpen || this.menuOpen()) {
      this.player.setVelocity(0, 0);
      this.player.anims.stop();
      this.player.setFrame(frameOf(this, "player", this.facing));
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

    if (vx !== 0 || vy !== 0) this.player.play(walkAnim(this, "player", this.facing), true);
    else {
      this.player.anims.stop();
      this.player.setFrame(frameOf(this, "player", this.facing));
    }
    this.sortByFeet(this.player);
  }
}
