import Phaser from "phaser";
import { TYPE, type CardRecord } from "../duel/engine/cardData.ts";
import { attributeNames, raceNames } from "../duel/engine/text.ts";
import { spellTrapKind } from "../duel-screen/CardInfo.ts";
import { INK, WHITE, text } from "../ui/pixel.ts";

/** Colour strip on a list row by frame (the card frames' main colours). */
const KIND_COLOR = { normal: 0xd8b04a, effect: 0xc8692c, ritual: 0x4f78c8, fusion: 0x8a54a8, spell: 0x2a9a7a, trap: 0xb04a8a };
export function kindColor(r: CardRecord): number {
  if (r.type & TYPE.SPELL) return KIND_COLOR.spell;
  if (r.type & TYPE.TRAP) return KIND_COLOR.trap;
  if (r.type & TYPE.FUSION) return KIND_COLOR.fusion;
  if (r.type & TYPE.RITUAL) return KIND_COLOR.ritual;
  if (r.type & TYPE.EFFECT) return KIND_COLOR.effect;
  return KIND_COLOR.normal;
}

/** A list row's second and third lines: "LV4 DARK SPELLCASTER" / "ATK 2500  DEF 2100", or "SPELL - QUICK-PLAY". */
export function describe(r: CardRecord): [string, string] {
  if (r.type & TYPE.MONSTER) {
    const stat = (v: number) => (v < 0 ? "?" : String(v));
    return [`LV${r.level & 0xff} ${attributeNames(r.attribute)} ${raceNames(BigInt(r.race))}`, `ATK ${stat(r.atk)}  DEF ${stat(r.def)}`];
  }
  return [`${r.type & TYPE.SPELL ? "SPELL" : "TRAP"} - ${spellTrapKind(r.type)}`, ""];
}

/**
 * Eye shown over a hovered list row's art (2x, dark outline, semi-transparent): clicking the art opens the card.
 * w = white, k = pupil, h = glint.
 */
const EYE = ["...wwwww...", ".ww.....ww.", "w...kkk...w", "w..kkhkk..w", "w...kkk...w", ".ww.....ww.", "...wwwww..."];
const EYE_COLOR: Record<string, number> = { w: 0xffffff, k: 0x1a1a2a, h: 0xffffff };

/** The eye over a hovered row's art (top-left of the art at x, y): the art dimmed a little, the eye at 2x in the middle. */
export function eyeIcon(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.3).fillRect(x, y, 32, 32);
  const ex = x + Math.floor((32 - EYE[0].length * 2) / 2), ey = y + Math.floor((32 - EYE.length * 2) / 2);
  // Screen pixels of the 2x eye, then a 1px dark outline around them (each pixel drawn once: alpha mustn't stack).
  const lit = new Map<string, number>();
  EYE.forEach((row, iy) => [...row].forEach((ch, ix) => {
    if (ch === ".") return;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) lit.set(`${ix * 2 + dx},${iy * 2 + dy}`, EYE_COLOR[ch]);
  }));
  const outline = new Set<string>();
  for (const key of lit.keys()) {
    const [px, py] = key.split(",").map(Number);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const k = `${px + dx},${py + dy}`;
      if (!lit.has(k)) outline.add(k);
    }
  }
  for (const k of outline) {
    const [px, py] = k.split(",").map(Number);
    g.fillStyle(0x000000, 0.6).fillRect(ex + px, ey + py, 1, 1);
  }
  for (const [k, color] of lit) {
    const [px, py] = k.split(",").map(Number);
    g.fillStyle(color, 0.85).fillRect(ex + px, ey + py, 1, 1);
  }
  return g;
}

/** Banlist badge colours by limit: Forbidden red, Limited orange, Semi-Limited yellow (card info, not themed). */
const LIMIT_COLOR = [0xd62020, 0xe07a1f, 0xe8c547];
/** A 9x9 disc, as [y, first x, last x] spans: the dark rim, then the colour inside it. */
const DISC_RIM = [[0, 2, 6], [1, 1, 7], [2, 0, 8], [3, 0, 8], [4, 0, 8], [5, 0, 8], [6, 0, 8], [7, 1, 7], [8, 2, 6]];
const DISC_FILL = [[1, 2, 6], [2, 1, 7], [3, 1, 7], [4, 1, 7], [5, 1, 7], [6, 1, 7], [7, 2, 6]];

/** The banlist mark on a list row's art (its top-left at x, y): the copies allowed (0/1/2) in a coloured disc, like the printed icon. */
export function limitBadge(scene: Phaser.Scene, x: number, y: number, limit: number): Phaser.GameObjects.Container {
  const g = scene.add.graphics();
  g.fillStyle(INK);
  for (const [dy, x0, x1] of DISC_RIM) g.fillRect(x + x0, y + dy, x1 - x0 + 1, 1);
  g.fillStyle(LIMIT_COLOR[limit]);
  for (const [dy, x0, x1] of DISC_FILL) g.fillRect(x + x0, y + dy, x1 - x0 + 1, 1);
  const digit = text(scene, x + 3, y + 2, String(limit), { color: limit === 2 ? INK : WHITE });
  return scene.add.container(0, 0, [g, digit]);
}
