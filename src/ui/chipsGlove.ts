// The chip count: a red glove with the number on the back of the hand and three stars on the cuff that fill in gold
// with it. Sheet and font built by tools/art/build-chips-glove.mjs (from data/ui/chips-glove.png).
import Phaser from "phaser";
import { WHITE, measure, text } from "./pixel.ts";

const CHIPS_GLOVE = "chips-glove";
const FONT_GLOVE = "glove-digits";
/** The most chips a player can hold: the glove has room for two digits. */
const MAX_CHIPS = 99;
/** Chips per star on the cuff: 10-19 the left one, 20-29 the centre one too, 30 and up all three. */
const STAR_STEP = 10;
/**
 * A frame of the sheet: the glove, cut out of its 64x64 drawing at 10,3 and placed at 1,1, with a 1px light outline
 * and a shadow 2px down-right (to stand out from the map).
 */
const FRAME = { w: 45, h: 62 };
/** The number's centre in a frame: under the middle of the four knuckles, halfway down the back of the hand. */
const NUMBER = { x: 23, y: 26 };
const DIGIT_H = 8;

export function loadChipsGlove(load: Phaser.Loader.LoaderPlugin) {
  load.spritesheet(CHIPS_GLOVE, "assets/ui/chips-glove.png", { frameWidth: FRAME.w, frameHeight: FRAME.h });
  load.bitmapFont(FONT_GLOVE, "assets/fonts/glove-digits.png", "assets/fonts/glove-digits.xml");
}

/** The glove with its top-left at x, y, in `parent` if given (e.g. a screen-fixed HUD container). */
export class ChipsGlove {
  private readonly scene: Phaser.Scene;
  private readonly x: number;
  private readonly y: number;
  private readonly glove: Phaser.GameObjects.Image;
  private readonly count: Phaser.GameObjects.BitmapText;

  constructor(scene: Phaser.Scene, x: number, y: number, chips: number, parent?: Phaser.GameObjects.Container) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.glove = scene.add.image(x, y, CHIPS_GLOVE, 0).setOrigin(0).setScrollFactor(0);
    // The digits carry their own colours: drawn untinted.
    this.count = text(scene, x, y, "", { font: FONT_GLOVE, color: WHITE }).setScrollFactor(0);
    parent?.add([this.glove, this.count]);
    this.set(chips);
  }

  set(chips: number) {
    const n = Phaser.Math.Clamp(Math.floor(chips), 0, MAX_CHIPS), str = String(n);
    this.glove.setFrame(Math.min(3, Math.floor(n / STAR_STEP)));
    this.count.setText(str).setPosition(
      this.x + Math.round(NUMBER.x - measure(this.scene, FONT_GLOVE, str) / 2),
      this.y + Math.round(NUMBER.y - DIGIT_H / 2));
  }
}
