// The duel field, drawn once under everything else, in the theme's template:
//   mat  – a felt playmat in a thin frame (the theme's plate sprite) on the table (Runewood: dark green felt
//          on planks the info panel's cream paper colour); zones are card-sized slots outlined in the line
//          colour, monster zones faintly tinted
//   open – no mat: each zone is a card-sized plate sprite straight on the table (Hologram: slots on a grid)
// A sideways defence card fits in the 20px gap between zones. Empty piles are labelled FIELD / EXTRA / GY /
// DECK (cards cover the labels).
import Phaser from "phaser";
import { FONT_CARD, text } from "../pixel.ts";
import { THEME, ui } from "../theme.ts";
import { CARD, FIELD, INSET, ROWS, slotXY, type Slot } from "./layout.ts";

/** From the mat frame's outer edge to the outermost zones, on every side (global). */
const MAT_EDGE = INSET.matEdge;

const MAIN = [0, 1, 2, 3, 4];
const PILES: [Slot, string][] = [
  [{ kind: "szone", seq: 5 }, "FIELD"], [{ kind: "extra" }, "EXTRA"], [{ kind: "grave" }, "GY"], [{ kind: "deck" }, "DECK"],
];

export function drawField(scene: Phaser.Scene, layer: Phaser.GameObjects.Container) {
  const parts = scene.make.container({}, false);
  drawTable(scene, parts);
  if (THEME.template === "open") drawOpenZones(scene, parts);
  else drawMat(scene, parts);
  for (const side of [0, 1] as const) {
    for (const [slot, str] of PILES) {
      const { x, y } = slotXY(side, slot);
      parts.add(text(scene, x, y - 1, str, { font: FONT_CARD, color: THEME.field.label, originX: 0.5 }));
    }
  }
  // Baked into one texture: the field never changes, and redrawing its ~1500 Graphics commands every frame kept
  // phones busy (and hot) even while nothing moved.
  const baked = scene.add.renderTexture(0, 0, 640, 360).setOrigin(0);
  baked.draw(parts).render();
  parts.destroy();
  layer.add(baked);
}

/** Every zone of one side: main monster and spell/trap zones, then the piles. */
function zoneSlots(): Slot[] {
  return [...MAIN.map((seq) => ({ kind: "mzone", seq }) as Slot), ...MAIN.map((seq) => ({ kind: "szone", seq }) as Slot), ...PILES.map(([s]) => s)];
}

/** "open" layout: a card-sized sprite per zone; monster zones "zone-monster", the rest the plate sprite. */
function drawOpenZones(scene: Phaser.Scene, layer: Phaser.GameObjects.Container) {
  const rim = THEME.plate.slice; // the plate sprite's nine-slice border
  for (const side of [0, 1] as const) {
    for (const slot of zoneSlots()) {
      const { x, y } = slotXY(side, slot);
      const key = ui(slot.kind === "mzone" ? "zone-monster" : "menu-back");
      layer.add(scene.add.nineslice(x - CARD.w / 2, y - CARD.h / 2, key, undefined, CARD.w, CARD.h, rim, rim, rim, rim).setOrigin(0));
    }
  }
}

/** "mat" layout: framed felt with outlined zones. */
function drawMat(scene: Phaser.Scene, layer: Phaser.GameObjects.Container) {
  const rim = THEME.plate.slice; // the frame's nine-slice border
  const top = ROWS.oppBack - CARD.h / 2 - MAT_EDGE, bottom = ROWS.myBack + CARD.h / 2 + MAT_EDGE;
  const left = slotXY(0, { kind: "extra" }).x - CARD.w / 2 - MAT_EDGE;
  const right = slotXY(0, { kind: "deck" }).x + CARD.w / 2 + MAT_EDGE;
  layer.add(scene.add.nineslice(left, top, ui("menu-back"), undefined, right - left, bottom - top, rim, rim, rim, rim).setOrigin(0));

  const m = scene.add.graphics();
  m.fillStyle(THEME.field.felt).fillRect(left + rim, top + rim, right - left - 2 * rim, bottom - top - 2 * rim);
  for (const side of [0, 1] as const) {
    for (const slot of zoneSlots()) {
      const { x, y } = slotXY(side, slot);
      const l = x - CARD.w / 2, t = y - CARD.h / 2;
      if (slot.kind === "mzone") m.fillStyle(THEME.field.monster).fillRect(l, t, CARD.w, CARD.h);
      m.lineStyle(1, THEME.field.line).strokeRect(l + 0.5, t + 0.5, CARD.w - 1, CARD.h - 1);
    }
  }
  layer.add(m);
}

/**
 * The table (whole screen; in the duel the info panel covers its left part): planks or a blueprint grid, the pattern
 * from `from` (x) on.
 */
export function drawTable(scene: Phaser.Scene, layer: Phaser.GameObjects.Container, from = FIELD.left - 4) {
  const g = scene.add.graphics();
  g.fillStyle(THEME.field.table).fillRect(0, 0, 640, 360);
  g.fillStyle(THEME.field.seam);
  if (THEME.field.pattern === "grid") {
    // 1px lines every 8px, like the hologram frames' inner grid.
    for (let x = from; x < 640; x += 8) g.fillRect(x, 0, 1, 360);
    for (let y = 4; y < 360; y += 8) g.fillRect(from, y, 640, 1);
  } else {
    // Horizontal planks, seams staggered so it doesn't read as stripes.
    for (let y = 14, i = 0; y < 360; y += 29, i++) {
      g.fillRect(from, y, 640, 1);
      for (let x = from + 4 + (i % 2 ? 60 : 130); x < 640; x += 150) g.fillRect(x, y - 28, 1, 28);
    }
  }
  layer.add(g);
}
