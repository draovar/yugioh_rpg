import Phaser from "phaser";
import { CHARACTERS, frameOf, type Facing } from "./characters.ts";
import { AMBUSHERS, type AmbushDef } from "./npcs.ts";
import { depthForY } from "./sortedWalls.ts";

/** Ambush sheet of a character (`npm run build-characters`, tools/art/build-ambush.mjs): 10 frames of 32x32. */
const sheetKey = (sprite: string) => `ambush-${sprite}`;
const HOLLOW = 0, EYES = 1, GLANCE = 2, HEAD_OUT = 3, CROUCH = 4, LEAP = 5, LAND = 6, LEAVES = [7, 8], SIDE_LEAP = 9;
const BALLOONS = "overworld-balloons";
/** The "!" balloon's frames in balloons.png (row 2 of 6, see balloons.json). */
const EXCLAIM = [12, 13, 14, 15, 16];

/**
 * Chance per tile walked (any direction) that an ambush gets ready; it then happens at the next spot that fits.
 * 1/150 at walking speed (~4.4 tiles a second) = about 35 s.
 */
const CHANCE = 1 / 150;
/** Walking distance (px) after an ambush before the next can get ready: 2450 = about 35 s at walking speed. */
const COOLDOWN = 2450;
/** `&ambush` (dev): the first ambush on a map is ready at once; later ones as usual. */
const FORCE = new URLSearchParams(location.search).has("ambush");
const TILE = 16;
/** How far ahead of the player (px) the ambusher comes out: walking sideways, walking up or down (sprites are tall). */
const AHEAD = 48, AHEAD_VERTICAL = 64;

/**
 * Maze hedge tiles (tools/maps/hedge-maze.mjs: sheet columns 18-23 of Modern Exteriors) as ids in the full tileset
 * (the `sheetId` tile property build-tiles keeps), plain and flowered (14 rows lower):
 *  - FACE_TOP / FACE_BOTTOM: the two rows of a horizontal hedge's front face (FACE)
 *  - WEST_EDGE / EAST_EDGE: the sides of a vertical hedge (SURFACE "v" edges), facing a path on that side
 */
const sheetId = (col: number, row: number) => row * 352 + col;
const FACE_TOP = new Set<number>(), FACE_BOTTOM = new Set<number>(), WEST_EDGE = new Set<number>(), EAST_EDGE = new Set<number>();
for (const flower of [0, 14]) {
  for (const [col, row] of [[20, 428], [21, 428], [18, 434], [23, 434]]) FACE_TOP.add(sheetId(col, row + flower));
  for (const [col, row] of [[20, 429], [21, 429], [18, 435], [23, 435]]) FACE_BOTTOM.add(sheetId(col, row + flower));
  for (const row of [428, 429]) {
    WEST_EDGE.add(sheetId(18, row + flower));
    EAST_EDGE.add(sheetId(23, row + flower));
  }
}

export function loadAmbushes(load: Phaser.Loader.LoaderPlugin) {
  const sprites = new Set(Object.values(AMBUSHERS).flat().map((d) => d.sprite));
  for (const sprite of sprites) load.spritesheet(sheetKey(sprite), `assets/overworld/ambush/${sprite}.png`, { frameWidth: 32, frameHeight: 32 });
  load.spritesheet(BALLOONS, "assets/overworld/balloons.png", { frameWidth: 16, frameHeight: 16 });
}

/**
 * Where an ambusher jumps out: "front" = a hedge face 3 tiles wide ahead of a player walking sideways; "side" = a
 * vertical hedge beside the path ahead of a player walking up or down. Points are a sprite's bottom centre.
 */
interface Spot {
  kind: "front" | "side";
  /** The hedge tiles that shake. */
  hedge: { col: number; row: number; w: number; h: number };
  from: { x: number; y: number };
  land: { x: number; y: number };
}

export interface AmbushHooks {
  /** Turns the player (the scene keeps its facing). */
  turnPlayer(facing: Facing, flipX: boolean): void;
  /** The ambusher has landed in front of the player; call `retreat` to send them back into the hedge. */
  challenge(def: AmbushDef, npc: Phaser.GameObjects.Sprite, retreat: () => void): void;
}

/**
 * Random hedge ambushes on a map (npcs.ts AMBUSHERS). Walking sideways along a hedge, the hedge ahead shakes, a dark
 * hollow with eyes opens in it, then the NPC pushes their head out and leaps in front of the player. Walking up or
 * down, a hedge beside the path ahead shakes and the NPC leaps out of it sideways. While `busy` the scene keeps the
 * player still.
 */
export class Ambushes {
  busy = false;
  private readonly scene: Phaser.Scene;
  private readonly defs: AmbushDef[];
  private readonly walls: Phaser.Tilemaps.TilemapLayer[];
  private readonly blockers: Phaser.Tilemaps.TilemapLayer | null;
  private readonly hooks: AmbushHooks;
  /** Distance walked since the last roll / the last ambush. */
  private walked = 0;
  private cooldown = 0;
  /** An ambush is ready: it happens at the next spot that fits. */
  private ready = FORCE;

  constructor(scene: Phaser.Scene, map: string, walls: Phaser.Tilemaps.TilemapLayer[],
    blockers: Phaser.Tilemaps.TilemapLayer | null, hooks: AmbushHooks) {
    this.scene = scene;
    this.defs = AMBUSHERS[map] ?? [];
    this.walls = walls;
    this.blockers = blockers;
    this.hooks = hooks;
  }

  /** Called every frame the player walks `distance` px; may start an ambush. */
  walk(player: Phaser.Physics.Arcade.Sprite, distance: number, facing: Facing) {
    if (this.busy || !this.defs.length) return;
    this.cooldown -= distance;
    this.walked += distance;
    if (this.walked < TILE) return;
    this.walked = 0;
    if (!this.ready && this.cooldown <= 0 && Math.random() < CHANCE) this.ready = true;
    if (!this.ready) return;
    const spot = facing === "side" ? this.frontSpot(player) : this.sideSpot(player, facing);
    if (!spot) return;
    this.ready = false;
    const def = Phaser.Utils.Array.GetRandom(this.defs);
    void (spot.kind === "front" ? this.playFront(def, spot, player) : this.playSide(def, spot, player, facing));
  }

  private tileIn(col: number, row: number, set: Set<number>) {
    return this.walls.some((l) => set.has((l.getTileAt(col, row)?.properties as { sheetId?: number } | undefined)?.sheetId ?? -1));
  }

  private solidTile(col: number, row: number) {
    return [...this.walls, ...(this.blockers ? [this.blockers] : [])].some((l) => !!l.getTileAt(col, row)?.collides);
  }

  private solid(x: number, y: number, w: number, h: number) {
    return [...this.walls, ...(this.blockers ? [this.blockers] : [])]
      .some((l) => l.getTilesWithinWorldXY(x, y, w, h, { isColliding: true }).length > 0);
  }

  /** A 3-tile hedge face straight above the corridor ahead, with room to land between it and the player's row. */
  private frontSpot(player: Phaser.Physics.Arcade.Sprite): Spot | null {
    const body = player.body as Phaser.Physics.Arcade.Body;
    const col = Math.floor((body.center.x + (player.flipX ? -AHEAD : AHEAD)) / TILE);
    const feetRow = Math.floor((body.bottom - 1) / TILE);
    for (let row = feetRow - 1; row >= feetRow - 4; row--) {
      if (!this.tileIn(col, row, FACE_BOTTOM)) continue;
      const wide = [col - 1, col, col + 1].every((c) => this.tileIn(c, row, FACE_BOTTOM) && this.tileIn(c, row - 1, FACE_TOP));
      const x = col * TILE + TILE / 2;
      if (!wide || this.solid(x - 15, body.top + 1, 30, body.height - 2)) return null;
      return { kind: "front", hedge: { col: col - 1, row: row - 1, w: 3, h: 2 }, from: { x, y: (row + 1) * TILE },
        land: { x, y: Math.round(player.getBounds().bottom) } };
    }
    return null;
  }

  /**
   * A vertical hedge beside the path, level with the spot ahead (3 tiles of its side tall), with a clear way from the
   * player to that spot.
   */
  private sideSpot(player: Phaser.Physics.Arcade.Sprite, facing: Facing): Spot | null {
    const body = player.body as Phaser.Physics.Arcade.Body;
    const dir = facing === "up" ? -1 : 1;
    const x = Math.round(body.center.x), landY = Math.round(body.bottom + dir * AHEAD_VERTICAL);
    const top = Math.min(body.top, landY - body.height), bottom = Math.max(body.bottom, landY);
    if (this.solid(x - 15, top + 1, 30, bottom - top - 2)) return null;
    const row = Math.floor((landY - 1) / TILE), playerCol = Math.floor(x / TILE);
    for (const side of Phaser.Utils.Array.Shuffle([1, -1])) {
      // A hedge on the right shows its west edge to the path, one on the left its east edge.
      const edge = side === 1 ? WEST_EDGE : EAST_EDGE;
      for (let k = 1; k <= 3; k++) {
        const col = playerCol + side * k;
        if (!this.solidTile(col, row)) continue;
        if ([row - 1, row, row + 1].every((r) => this.tileIn(col, r, edge))) {
          const left = side === 1 ? col : col - 1;
          return { kind: "side", hedge: { col: left, row: row - 1, w: 2, h: 3 }, from: { x: (left + 1) * TILE, y: landY },
            land: { x, y: landY } };
        }
        break;
      }
    }
    return null;
  }

  private wait(ms: number) {
    return new Promise<void>((resolve) => this.scene.time.delayedCall(ms, resolve));
  }

  private tween(config: Phaser.Types.Tweens.TweenBuilderConfig) {
    return new Promise<void>((resolve) => this.scene.tweens.add({ ...config, onComplete: () => resolve() }));
  }

  /**
   * A copy of the spot's hedge tiles over the real ones, shaking (`shake.px` pixels either way) with a leaf falling
   * now and then; `stop()` removes it.
   */
  private shakeHedge(spot: Spot, rustle: (n: number) => void) {
    const { col, row, w, h } = spot.hedge, x = col * TILE, y = row * TILE;
    const rt = this.scene.add.renderTexture(x, y, w * TILE, h * TILE).setOrigin(0);
    for (const l of this.walls) l.setVisible(true);
    rt.draw(this.walls, -x, -y).render();
    for (const l of this.walls) l.setVisible(false);
    rt.setDepth(depthForY((row + h) * TILE - 0.5) + 1e-6);
    const shake = { px: 1, depth: rt.depth };
    const jiggle = this.scene.time.addEvent({ delay: 70, loop: true, callback: () => {
      rt.x = x + (rt.x === x ? Phaser.Math.Between(-shake.px, shake.px) : 0);
      if (Math.random() < 0.15) rustle(1);
    } });
    return Object.assign(shake, { stop: () => { jiggle.remove(); rt.destroy(); } });
  }

  /** Falling leaves torn from the spot's hedge. */
  private leaves(key: string, spot: Spot) {
    const leaves = this.scene.add.particles(0, 0, key, {
      frame: LEAVES, scale: 2, speed: { min: 30, max: 90 }, angle: { min: 200, max: 340 }, gravityY: 260,
      lifespan: { min: 400, max: 700 }, alpha: { start: 1, end: 0 }, emitting: false,
    }).setDepth(depthForY(Math.max(spot.from.y, spot.land.y)) + 1e-5);
    const { col, row, w, h } = spot.hedge;
    const rustle = (n: number) => leaves.explode(n, Phaser.Math.Between(col * TILE + 4, (col + w) * TILE - 4),
      Phaser.Math.Between(row * TILE + 4, (row + h) * TILE - 8));
    return { leaves, rustle };
  }

  private start(player: Phaser.Physics.Arcade.Sprite) {
    this.busy = true;
    player.setVelocity(0, 0);
    player.anims.stop();
  }

  /** Front: the hedge face shakes, a dark hollow with eyes opens, the head comes out, then the leap down. */
  private async playFront(def: AmbushDef, spot: Spot, player: Phaser.Physics.Arcade.Sprite) {
    const scene = this.scene, key = sheetKey(def.sprite);
    this.start(player);
    this.hooks.turnPlayer("side", player.flipX);
    const { leaves, rustle } = this.leaves(key, spot);
    const hedge = this.shakeHedge(spot, rustle);

    // A dark hollow opens in it, then eyes show; the player turns to look.
    const npc = scene.add.sprite(spot.from.x, spot.from.y, key, HOLLOW).setOrigin(0.5, 1).setScale(2).setAlpha(0)
      .setDepth(hedge.depth + 1e-6);
    npc.vertexRoundMode = "fullAuto";
    void this.tween({ targets: npc, alpha: 1, duration: 800 });
    await this.wait(1000);
    npc.setFrame(EYES);
    const blink = scene.time.addEvent({ delay: 380, loop: true, callback: () => npc.setFrame(npc.frame.name === String(EYES) ? GLANCE : EYES) });
    await this.wait(300);
    this.hooks.turnPlayer("up", false);
    this.exclaim(player);
    await this.wait(900);

    // The head comes out through the leaves, then he crouches in front of the hedge and leaps.
    blink.remove();
    hedge.px = 2;
    npc.setFrame(HEAD_OUT);
    rustle(6);
    await this.wait(600);
    hedge.stop();
    npc.setFrame(CROUCH);
    rustle(8);
    await this.wait(180);
    npc.setFrame(LEAP);
    await this.arc(npc, spot.from, spot.land, 28, 420);
    npc.setFrame(LAND);
    scene.cameras.main.shake(120, 0.004);
    await this.wait(140);

    // Face each other.
    const fromLeft = player.x < npc.x;
    npc.setTexture(CHARACTERS, frameOf(scene, def.sprite, "side")).setFlipX(fromLeft);
    this.hooks.turnPlayer("side", !fromLeft);
    await this.wait(250);
    this.hooks.challenge(def, npc, () => void this.retreat(npc, spot, key, leaves));
  }

  /** Side: the hedge beside the path shakes, then the NPC leaps out of it onto the path ahead. */
  private async playSide(def: AmbushDef, spot: Spot, player: Phaser.Physics.Arcade.Sprite, facing: Facing) {
    const scene = this.scene, key = sheetKey(def.sprite);
    this.start(player);
    this.hooks.turnPlayer(facing, false);
    const { leaves, rustle } = this.leaves(key, spot);
    const hedge = this.shakeHedge(spot, rustle);
    await this.wait(700);
    hedge.px = 2;
    await this.wait(400);

    hedge.stop();
    rustle(10);
    const npc = scene.add.sprite(spot.from.x, spot.from.y, key, SIDE_LEAP).setOrigin(0.5, 1).setScale(2)
      .setFlipX(spot.land.x < spot.from.x);
    npc.vertexRoundMode = "fullAuto";
    await this.arc(npc, spot.from, spot.land, 16, 360);
    scene.cameras.main.shake(120, 0.004);

    // He faces the player, who startles.
    npc.setTexture(CHARACTERS, frameOf(scene, def.sprite, facing === "up" ? "down" : "up")).setFlipX(false);
    this.exclaim(player);
    await this.wait(700);
    this.hooks.challenge(def, npc, () => void this.retreat(npc, spot, key, leaves));
  }

  /** Leaps back into the hedge and is gone. */
  private async retreat(npc: Phaser.GameObjects.Sprite, spot: Spot, key: string, leaves: Phaser.GameObjects.Particles.ParticleEmitter) {
    if (spot.kind === "front") {
      npc.setTexture(key, CROUCH).setFlipX(false);
      await this.wait(150);
      npc.setFrame(LEAP);
      await this.arc(npc, npc, spot.from, 28, 380);
      npc.setFrame(HEAD_OUT).setDepth(depthForY(spot.from.y - 0.5) + 2e-6);
    } else {
      npc.setTexture(key, SIDE_LEAP).setFlipX(spot.from.x < npc.x);
      await this.arc(npc, npc, spot.from, 16, 340);
    }
    leaves.explode(10, spot.from.x, spot.from.y - 20);
    await this.wait(spot.kind === "front" ? 200 : 0);
    npc.destroy();
    await this.wait(800);
    leaves.destroy();
    this.cooldown = COOLDOWN;
    this.busy = false;
  }

  /** A jump between two points, `height` px above the straight line at its middle, in front of everything it passes. */
  private arc(sprite: Phaser.GameObjects.Sprite, from: { x: number; y: number }, to: { x: number; y: number }, height: number, duration: number) {
    const p = { t: 0 }, { x: x0, y: y0 } = from, { x: x1, y: y1 } = to;
    sprite.setDepth(depthForY(Math.max(y0, y1)) + 1e-5);
    return this.tween({ targets: p, t: 1, duration, onUpdate: () => sprite.setPosition(
      Math.round(Phaser.Math.Linear(x0, x1, p.t)), Math.round(Phaser.Math.Linear(y0, y1, p.t) - Math.sin(Math.PI * p.t) * height)) });
  }

  /** The "!" balloon over the player's head. */
  private exclaim(player: Phaser.GameObjects.Sprite) {
    const anim = "balloon-exclaim";
    if (!this.scene.anims.exists(anim)) {
      this.scene.anims.create({ key: anim, frames: EXCLAIM.map((frame) => ({ key: BALLOONS, frame })), frameRate: 14 });
    }
    const b = this.scene.add.sprite(Math.round(player.x), Math.round(player.getBounds().top + 4), BALLOONS, EXCLAIM[0])
      .setOrigin(0.5, 1).setScale(2).setDepth(150).play(anim);
    this.scene.time.delayedCall(1100, () => b.destroy());
  }
}
