import Phaser from "phaser";
import { DECKS, type DeckName } from "../duel/decks/decks.ts";
import { DialogBox } from "./DialogBox.ts";
import { WHITE, text } from "../ui/pixel.ts";
import { PLAYER_LOOKS, chosenDeck, playerLook } from "../ui/prefs.ts";
import { DPAD, TouchPad, X_BUTTON } from "./TouchPad.ts";
import { TOUCH } from "../ui/touch.ts";
import type { DuelSceneData } from "../duel-screen/DuelScene.ts";
import type { WorldMenu } from "./WorldMenu.ts";
import { CHARACTERS, frameOf, loadCharacters, walkAnim, type Facing } from "./characters.ts";
import { NPCS, type NpcDef } from "./npcs.ts";
import { bake, buildSortedWalls, depthForY } from "./sortedWalls.ts";
import { Ambushes, loadAmbushes } from "./ambush.ts";
import { transitionTo, transitioning } from "../ui/Transition.ts";

const mapKey = (name: string) => `map-${name}`, tilesKey = (name: string) => `tiles-${name}`;

/**
 * The map the player is on (data/maps/NAME.tmj). Starts on `&map=NAME` (e.g. `maze`), else in the island's main city
 * (the map with its `spawn`, as generate-world reports it).
 */
let currentMap = new URLSearchParams(location.search).get("map")?.replace(/[^\w-]/g, "") || "main-city";

/** A map and its tiles, from `npm run build-tiles` (public/maps/, gitignored). Loaded once, on first visit. */
function loadMap(load: Phaser.Loader.LoaderPlugin, name: string) {
  if (load.cacheManager.tilemap.exists(mapKey(name))) return;
  load.tilemapTiledJSON(mapKey(name), `maps/${name}.json`);
  load.image(tilesKey(name), `maps/${name}.png`);
}

/** A map's place in a Tiled world (data/maps/*.world, exported by build-tiles): its rectangle there, in pixels. */
type Placement = { world: string; x: number; y: number; width: number; height: number };
const placements = (cache: Phaser.Cache.CacheManager) => (cache.json.get("worlds") ?? {}) as Record<string, Placement>;

/** Called from Boot: the characters, the world placements and the first map. */
export function loadOverworld(load: Phaser.Loader.LoaderPlugin) {
  loadMap(load, currentMap);
  load.json("worlds", "maps/worlds.json");
  loadCharacters(load);
  loadAmbushes(load);
}

const TALK_DISTANCE = 56, SPEED = 70, FADE_MS = 200;
/** How far in front of the player's feet box a sign can be read. */
const READ_REACH = 8;
/** Holding Z runs: this much faster, with the look's run frames. */
const RUN_SPEED = 1.5;

/** Where the player stood when they left for a duel or the lobby, and who they were dueling. */
let saved: { x: number; y: number; facing: Facing; flipX: boolean; opponent?: string } | null = null;
/**
 * Set when walking through a warp: the point to arrive at, and the height to keep (maps placed side by side). Walking
 * across the edge into a neighbouring map of the same world gives the exact spot there instead (`x` and `y`).
 */
let arrival: { spawn?: string; x?: number; y?: number; facing: Facing; flipX: boolean } | null = null;

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
  private runKey!: Phaser.Input.Keyboard.Key;
  /** On-screen D-pad and X on touch devices. */
  private pad: TouchPad | null = null;
  private dialog!: DialogBox;
  private talkHint!: Phaser.GameObjects.BitmapText;
  /** Readable spots: rectangles named "sign" (layer "objects"). */
  private signs: { area: Phaser.Geom.Rectangle; title: string; text: string }[] = [];
  private facing: Facing = "down";
  /** The player's walk and run sprites (world menu: PLAYER). */
  private look = PLAYER_LOOKS[playerLook()];
  private duelResult: { won: boolean } | undefined;
  /** Fading out towards another map: no second warp, no movement. */
  private warping = false;
  /** Chips (placeholder: nothing earns or spends them yet). */
  private chips = 2;
  /** Random hedge ambushes (maps with AMBUSHERS). */
  private ambushes: Ambushes | null = null;
  /** The map's place in its world (null: a map on its own). */
  private placement: Placement | null = null;
  private mapSize = { width: 0, height: 0 };

  constructor() {
    super({ key: "Overworld", physics: { default: "arcade", arcade: {} } });
  }

  init(data: { duelResult?: { won: boolean } }) {
    this.duelResult = data?.duelResult;
    this.warping = false;
  }

  /** A map visited for the first time (through a warp or a world edge) loads here. */
  preload() {
    loadMap(this.load, currentMap);
  }

  create() {
    this.scene.launch("WorldMenu");
    if (import.meta.env.DEV) (window as unknown as { overworld: Overworld }).overworld = this;
    if (!this.cache.tilemap.exists(mapKey(currentMap))) {
      text(this, 320, 170, "NO MAP: RUN NPM RUN BUILD-TILES (NEEDS VENDOR/PAID)", { color: WHITE, originX: 0.5 });
      return;
    }
    const map = this.make.tilemap({ key: mapKey(currentMap) });
    const tileset = map.addTilesetImage("world", tilesKey(currentMap))!;

    // Ground layers (ground, ground2, ground3...): no collision, always under everything.
    const grounds = map.layers.filter((l) => l.name.startsWith("ground")).map((l) => map.createLayer(l.name, tileset, 0, 0)!);
    bake(this, grounds, 0);

    // Optional hidden "collision" layer: every tile in it blocks, whatever it shows (a map's exact footprints).
    this.blockers = map.getLayerIndex("collision") === null ? null
      : (map.createLayer("collision", tileset, 0, 0) as Phaser.Tilemaps.TilemapLayer).setVisible(false).setCollisionByExclusion([-1]);

    // Walls layers (walls, walls2...) are only used for collision and are not drawn: their tiles are redrawn in
    // y-sorted layers.
    this.walls = map.layers.filter((l) => l.name.startsWith("walls")).map((l) =>
      (map.createLayer(l.name, tileset, 0, 0) as Phaser.Tilemaps.TilemapLayer).setVisible(false).setCollisionByProperty({ collision: true }));
    buildSortedWalls(this, map, tileset, this.walls, this.blockers);

    // Maps placed side by side in a world: walking past an edge goes on in the neighbouring map (crossEdge).
    this.placement = placements(this.cache)[currentMap] ?? null;
    this.mapSize = { width: map.widthInPixels, height: map.heightInPixels };

    // The 32px character frames are drawn at 2x. Body size/offset are in frame pixels and scale with the sprite.
    // Start: back from a duel on the same spot, through a warp at its arrival point (layer "objects"), else at the
    // map's point named "spawn".
    const point = (name: string) => map.findObject("objects", (o) => o.name === name);
    const at = arrival?.spawn ? point(arrival.spawn) : arrival ? null : point("spawn");
    const x = saved?.x ?? arrival?.x ?? at?.x ?? 400;
    let y = saved?.y ?? arrival?.y ?? at?.y ?? 520;
    const crossed = arrival?.x !== undefined;
    if (!saved && !crossed) y = this.freeY(x, y);
    this.look = PLAYER_LOOKS[playerLook()];
    this.player = this.physics.add.sprite(x, y, CHARACTERS, frameOf(this, this.look.walk, "down")).setScale(2);
    this.player.body.setSize(16, 16, false).setOffset(8, 16);
    // Snapped like the (unscaled) map, which "safeAuto" would skip at 2x: no half-pixel shimmer against the ground.
    this.player.vertexRoundMode = "fullAuto";
    // In a world the player may step past the edges (crossEdge keeps them in where no map follows).
    this.player.setCollideWorldBounds(!this.placement);
    const facing = saved ?? arrival;
    if (facing) {
      this.facing = facing.facing;
      this.player.setFlipX(facing.flipX);
    }
    arrival = null;
    this.player.setFrame(frameOf(this, this.look.walk, this.facing));
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

    this.ambushes = new Ambushes(this, currentMap, this.walls, this.blockers, {
      turnPlayer: (facing, flipX) => {
        this.facing = facing;
        this.player.setFrame(frameOf(this, this.look.walk, facing)).setFlipX(flipX);
      },
      // No way out: they say their line, then the duel starts with one of their decks at random.
      challenge: (def) => this.dialog.open(def.name, def.text, ["OK"], () => {
        this.ambushes!.leaveForDuel();
        this.startDuel(def.name, Phaser.Utils.Array.GetRandom(def.decks));
      }),
    });

    // Signs: rectangles named "sign" (layer "objects") with properties text and title (the dialog's header, "SIGN"
    // if empty); read by facing them and pressing X.
    this.signs = [];
    for (const o of map.getObjectLayer("objects")?.objects ?? []) {
      if (o.name !== "sign") continue;
      const prop = (name: string) => (o.properties as { name: string; value: unknown }[] | undefined)?.find((p) => p.name === name)?.value;
      this.signs.push({ area: new Phaser.Geom.Rectangle(o.x!, o.y!, o.width!, o.height!), title: String(prop("title") || "Sign"), text: String(prop("text") ?? "") });
    }

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
    // Coming back from a duel the card wave uncovers the map instead.
    if (!transitioning(this.game)) this.cameras.main.fadeIn(FADE_MS);
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.runKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Z);

    const opponent = saved?.opponent;
    saved = null;
    // An ambusher stays until their line about the result is closed, then leaps back into the hedge.
    const ambusherLeaves = this.ambushes.backFromDuel() ?? (() => {});
    if (this.duelResult && opponent) {
      const won = this.duelResult.won;
      this.dialog.open(opponent, won ? "Not bad... you got me this time." : "Better luck next time!", ["OK"], ambusherLeaves);
    } else ambusherLeaves();
  }

  /** Warps to the target map's arrival point. */
  private warp(mapName: string, spawn: string, keepY: boolean) {
    this.goTo(mapName, { spawn, y: keepY ? Math.round(this.player.y) : undefined, facing: this.facing, flipX: this.player.flipX });
  }

  /** Fades out and starts another map where `to` says. */
  private goTo(mapName: string, to: NonNullable<typeof arrival>) {
    if (this.warping) return;
    this.warping = true;
    this.player.setVelocity(0, 0);
    arrival = to;
    this.cameras.main.fadeOut(FADE_MS);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      currentMap = mapName;
      this.scene.restart();
    });
  }

  /**
   * Once the player's feet box is centred past this map's edge, the map of the world there takes over, the player on
   * the same spot of the world (like a warp, with a fade). Where no map follows (open sea), they're kept in.
   */
  private crossEdge() {
    const me = this.placement;
    if (!me || this.warping) return;
    // From the sprite, like the arrival below (the body is a physics step ahead in update()): its feet box centre.
    const x = this.player.x, y = this.player.y + this.player.body.halfHeight;
    if (x >= 0 && y >= 0 && x < this.mapSize.width && y < this.mapSize.height) return;
    const wx = x + me.x, wy = y + me.y;
    const next = Object.entries(placements(this.cache)).find(([, p]) => p.world === me.world
      && wx >= p.x && wy >= p.y && wx < p.x + p.width && wy < p.y + p.height);
    if (!next) {
      const body = this.player.body;
      this.player.setPosition(Phaser.Math.Clamp(x, 0, this.mapSize.width - 1), Phaser.Math.Clamp(y, 0, this.mapSize.height - 1) - body.halfHeight);
      body.updateFromGameObject();
      return;
    }
    const [name, p] = next;
    // Not rounded: the feet stay just past the edge, inside the new map (rounded, they could land on its edge and
    // count as outside it, sending the player straight back).
    this.goTo(name, { x: this.player.x + me.x - p.x, y: this.player.y + me.y - p.y, facing: this.facing, flipX: this.player.flipX });
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

  /** A key press, or the touch pad's: answers the open dialog, else X / Enter / Space talks to the nearest NPC. */
  private handleKey(code: string) {
    if (this.menuOpen() || transitioning(this.game)) return;
    if (this.dialog.isOpen) this.dialog.handleKey(code);
    else if (code === "KeyX" || code === "Enter" || code === "Space") {
      // A sign the player faces wins over an NPC standing nearby.
      const sign = this.facedSign(), npc = sign ? null : this.nearestNpc();
      if (sign) this.dialog.open(sign.title, sign.text, ["OK"], () => {});
      else if (npc) this.talkTo(npc);
    }
  }

  /** Remembers where the player stands, so coming back from a duel or the lobby puts them on the same spot. */
  savePosition(opponent?: string) {
    if (!this.player) return;
    saved = { x: Math.round(this.player.x), y: Math.round(this.player.y), facing: this.facing, flipX: this.player.flipX, opponent };
  }

  private sortByFeet(sprite: Phaser.GameObjects.Sprite) {
    sprite.setDepth(depthForY(sprite.getBounds().bottom));
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

  /** The sign right in front of the player, in the direction they face. */
  private facedSign() {
    const b = this.player.body;
    const ahead = { up: [0, -1], down: [0, 1], side: [this.player.flipX ? -1 : 1, 0] }[this.facing];
    const x = b.center.x + ahead[0] * (b.halfWidth + READ_REACH), y = b.center.y + ahead[1] * (b.halfHeight + READ_REACH);
    return this.signs.find((s) => s.area.contains(x, y)) ?? null;
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
    if (Math.abs(dx) > Math.abs(dy)) this.face(npc, dx > 0 ? "side" : "left");
    else this.face(npc, dy > 0 ? "down" : "up");
    this.dialog.open(def.name, def.text, ["Yes", "No"], (choice) => {
      this.face(npc, def.facing ?? "down");
      if (choice === "Yes") this.startDuel(def.name, def.deck);
    });
  }

  /** A duel against `opponent` with that deck, behind the card-wave transition; afterwards the player is back here. */
  private startDuel(opponent: string, deck: DeckName) {
    this.savePosition(opponent);
    const data: DuelSceneData = { opponentName: opponent, playerDeck: chosenDeck().deck, opponentDeck: DECKS[deck].deck };
    void transitionTo(this, "Duel", data, { onCovered: () => this.scene.stop("WorldMenu") });
  }

  update() {
    if (!this.player) return;
    if (this.warping || transitioning(this.game)) {
      this.player.setVelocity(0, 0);
      return;
    }
    if (this.ambushes?.busy && !this.dialog.isOpen) {
      this.player.setVelocity(0, 0);
      this.talkHint.setVisible(false);
      return;
    }
    if (this.dialog.isOpen || this.menuOpen()) {
      this.look = PLAYER_LOOKS[playerLook()];
      this.player.setVelocity(0, 0);
      this.player.anims.stop();
      this.player.setFrame(frameOf(this, this.look.walk, this.facing));
      this.talkHint.setVisible(false);
      return;
    }

    const sign = this.facedSign(), npc = sign ? null : this.nearestNpc();
    const hintAt = sign ? { x: sign.area.centerX, top: sign.area.top } : npc ? { x: npc.x, top: npc.getBounds().top } : null;
    this.talkHint.setVisible(!!hintAt);
    if (hintAt) this.talkHint.setPosition(Math.round(hintAt.x - this.talkHint.width / 2), Math.round(hintAt.top - 2 - this.talkHint.height));

    let vx = 0, vy = 0;
    if (this.cursors.left.isDown || this.pad?.x === -1) vx = -SPEED;
    if (this.cursors.right.isDown || this.pad?.x === 1) vx = SPEED;
    if (this.cursors.up.isDown || this.pad?.y === -1) vy = -SPEED;
    if (this.cursors.down.isDown || this.pad?.y === 1) vy = SPEED;
    const running = this.runKey.isDown;
    this.player.setVelocity(vx, vy);
    this.player.body.velocity.normalize().scale(running ? SPEED * RUN_SPEED : SPEED); // same speed on diagonals

    // Horizontal wins when moving diagonally.
    if (vx !== 0) {
      this.facing = "side";
      this.player.setFlipX(vx < 0);
    } else if (vy < 0) this.facing = "up";
    else if (vy > 0) this.facing = "down";

    if (vx !== 0 || vy !== 0) this.player.play(walkAnim(this, running ? this.look.run : this.look.walk, this.facing, running ? 6 : 4), true);
    else {
      this.player.anims.stop();
      this.player.setFrame(frameOf(this, this.look.walk, this.facing));
    }
    this.sortByFeet(this.player);
    this.crossEdge();
    if (vx !== 0 || vy !== 0) this.ambushes?.walk(this.player, this.player.body.speed * this.game.loop.delta / 1000, this.facing);
  }
}
