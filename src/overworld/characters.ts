import Phaser from "phaser";

/** Every character, from `npm run build-characters` (data/characters/); names in characters.json, picks in docs/characters.png. */
export const CHARACTERS = "overworld-characters";

export type Facing = "down" | "side" | "up";
const FACINGS: Facing[] = ["down", "side", "up"];

export function loadCharacters(load: Phaser.Loader.LoaderPlugin) {
  load.spritesheet(CHARACTERS, "assets/overworld/characters.png", { frameWidth: 32, frameHeight: 32 });
  load.json(CHARACTERS, "assets/overworld/characters.json");
}

/** A character's frame in characters.png: 9 per character, down / side (facing right) / up × stand, step, step. */
export function frameOf(scene: Phaser.Scene, name: string, facing: Facing, step = 0): number {
  const index = (scene.cache.json.get(CHARACTERS) as { names: string[] }).names.indexOf(name);
  if (index < 0) throw new Error(`no character "${name}" in characters.json`);
  return index * 9 + FACINGS.indexOf(facing) * 3 + step;
}

/** The character's walk animation for a facing (step, stand, other step, stand), created on first use. */
export function walkAnim(scene: Phaser.Scene, name: string, facing: Facing, frameRate = 8): string {
  const key = `${name}-walk-${facing}`;
  if (!scene.anims.exists(key)) {
    const frames = [1, 0, 2, 0].map((step) => ({ key: CHARACTERS, frame: frameOf(scene, name, facing, step) }));
    scene.anims.create({ key, frames, frameRate, repeat: -1 });
  }
  return key;
}
