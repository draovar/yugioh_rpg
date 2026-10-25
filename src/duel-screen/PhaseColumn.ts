import Phaser from "phaser";
import type { OcgResponse } from "ocgcore-wasm";
import type { PhaseAction } from "./duelPrompts.ts";
import { PHASE_COL } from "./layout.ts";
import { text } from "../ui/pixel.ts";
import { THEME, ui, type PhaseState } from "../ui/theme.ts";

/** Phase column boxes, top to bottom, with the engine phase bits each one covers. */
const PHASES = [
  { label: "DRAW", bits: 0x1 },
  { label: "STANDBY", bits: 0x2 },
  { label: "MAIN 1", bits: 0x4 },
  { label: "BATTLE", bits: 0x8 | 0x10 | 0x20 | 0x40 | 0x80 },
  { label: "MAIN 2", bits: 0x100 },
  { label: "END", bits: 0x200 },
] as const;
const PHASE_ACTION: Partial<Record<number, PhaseAction>> = { 3: "bp", 4: "m2", 5: "ep" };

export interface PhaseColumnHost {
  readonly phase: number;
  /** Whose turn it is colours the current phase. */
  readonly myTurn: boolean;
  /** BATTLE / MAIN 2 / END P. answers for the pending prompt; those boxes are clickable. */
  phaseActions: Map<PhaseAction, OcgResponse>;
  answer(response: OcgResponse): void;
}

/** The six phase boxes left of the field; the current phase is lit, offered phase changes are buttons. */
export class PhaseColumn {
  private scene: Phaser.Scene;
  private host: PhaseColumnHost;
  private gfx: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene, host: PhaseColumnHost) {
    this.scene = scene;
    this.host = host;
    this.gfx = scene.add.container(0, 0);
  }

  draw() {
    const scene = this.scene, host = this.host;
    this.gfx.removeAll(true);
    PHASES.forEach((p, i) => {
      const x = PHASE_COL.x, y = PHASE_COL.top + i * PHASE_COL.pitch;
      const action = PHASE_ACTION[i];
      const clickable = !!action && host.phaseActions.has(action);
      let state: PhaseState = clickable ? "clickable" : "idle";
      if ((host.phase & p.bits) !== 0) state = "current";
      const look = THEME.phase[state];
      const box = scene.add.nineslice(x, y, ui(`phase-${state}`), undefined, PHASE_COL.w, PHASE_COL.h, ...look.slice).setOrigin(0);
      this.gfx.add(box);
      // Letters stacked vertically, centred on the button face.
      const color = state === "current" ? (host.myTurn ? THEME.turnText.mine : THEME.turnText.theirs) : look.text;
      const letters = [...p.label];
      const top = y + Math.floor((PHASE_COL.h - letters.length * 6 + 1) / 2) + look.textDy;
      const glyphs = letters.flatMap((ch, j) => (ch === " " ? [] : [text(scene, x + PHASE_COL.w / 2, top + j * 6, ch, { color, originX: 0.5 })]));
      this.gfx.add(glyphs);
      if (clickable) {
        // Press feedback: swap to the pressed frame while the pointer is down.
        const pressed = THEME.phase.idle;
        const hit = scene.add.zone(x, y, PHASE_COL.w, PHASE_COL.h).setOrigin(0).setInteractive({ useHandCursor: true });
        hit.on("pointerdown", () => {
          box.setTexture(ui("phase-idle")).setSlices(PHASE_COL.w, PHASE_COL.h, ...pressed.slice);
          for (const g of glyphs) g.y += pressed.textDy - look.textDy;
        });
        hit.on("pointerout", () => this.draw());
        hit.on("pointerup", () => { const r = host.phaseActions.get(action!); if (r) host.answer(r); });
        this.gfx.add(hit);
      }
    });
  }
}
