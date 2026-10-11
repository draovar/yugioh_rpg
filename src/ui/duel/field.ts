// The duel field: a dark green felt playmat in a thin dark wood frame (Runewood Frame01a, CC BY 4.0) on a
// cream plank table (the info panel's paper colour), so the wood UI and the cards stand out. Zones are
// plain card-sized slots outlined in light green (a sideways defence card fits in the 20px gap between
// zones), monster zones faintly tinted; empty piles are labelled FIELD / EXTRA / GY / DECK (cards cover
// the labels). Drawn once, under everything else.
import Phaser from "phaser";
import { FONT_CARD, text } from "../pixel.ts";
import { CARD, FIELD, ROWS, slotXY, type Slot } from "./layout.ts";

const TABLE = {
  wood: 0xf0d2af, // the info panel's cream paper
  seam: 0xcfae86, // 1px seams between planks (the paper's own shade line)
};

const MAT = {
  felt: 0x1d4636,
  line: 0x4f8a6c, // zone outlines
  monster: 0x225240, // faint tint inside monster zones
  label: 0x6fa88a,
};

/** From the frame's outer edge to the outermost zones, on every side (3px rim + 1px of felt). */
const MAT_EDGE = 4;

const MAIN = [0, 1, 2, 3, 4];
const PILES: [Slot, string][] = [
  [{ kind: "szone", seq: 5 }, "FIELD"], [{ kind: "extra" }, "EXTRA"], [{ kind: "grave" }, "GY"], [{ kind: "deck" }, "DECK"],
];

export function drawField(scene: Phaser.Scene, layer: Phaser.GameObjects.Container) {
  drawTable(scene, layer);

  const top = ROWS.oppBack - CARD.h / 2 - MAT_EDGE, bottom = ROWS.myBack + CARD.h / 2 + MAT_EDGE;
  const left = slotXY(0, { kind: "extra" }).x - CARD.w / 2 - MAT_EDGE;
  const right = slotXY(0, { kind: "deck" }).x + CARD.w / 2 + MAT_EDGE;
  layer.add(scene.add.nineslice(left, top, "ui-menu-back", undefined, right - left, bottom - top, 3, 3, 3, 3).setOrigin(0));

  const m = scene.add.graphics();
  m.fillStyle(MAT.felt).fillRect(left + 3, top + 3, right - left - 6, bottom - top - 6);
  for (const side of [0, 1] as const) {
    const slots: Slot[] = [
      ...MAIN.map((seq) => ({ kind: "mzone", seq }) as Slot), ...MAIN.map((seq) => ({ kind: "szone", seq }) as Slot), ...PILES.map(([s]) => s),
    ];
    for (const slot of slots) {
      const { x, y } = slotXY(side, slot);
      const l = x - CARD.w / 2, t = y - CARD.h / 2;
      if (slot.kind === "mzone") m.fillStyle(MAT.monster).fillRect(l, t, CARD.w, CARD.h);
      m.lineStyle(1, MAT.line).strokeRect(l + 0.5, t + 0.5, CARD.w - 1, CARD.h - 1);
    }
  }
  layer.add(m);

  for (const side of [0, 1] as const) {
    for (const [slot, str] of PILES) {
      const { x, y } = slotXY(side, slot);
      layer.add(text(scene, x, y - 1, str, { font: FONT_CARD, color: MAT.label, originX: 0.5 }));
    }
  }
}

/** The plank table (whole screen; the info panel covers its left part). */
function drawTable(scene: Phaser.Scene, layer: Phaser.GameObjects.Container) {
  const g = scene.add.graphics();
  g.fillStyle(TABLE.wood).fillRect(0, 0, 640, 360);
  // Horizontal planks, seams staggered so it doesn't read as stripes.
  g.fillStyle(TABLE.seam);
  for (let y = 14, i = 0; y < 360; y += 29, i++) {
    g.fillRect(FIELD.left - 4, y, 640, 1);
    for (let x = FIELD.left + (i % 2 ? 60 : 130); x < 640; x += 150) g.fillRect(x, y - 28, 1, 28);
  }
  layer.add(g);
}
