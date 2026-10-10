import Phaser from "phaser";
import { OcgMessageType } from "ocgcore-wasm";
import { loadEngine } from "../duel/loadEngine.ts";
import { DuelSession } from "../duel/DuelSession.ts";
import { autoRespond } from "../duel/autoBot.ts";

/** Engine smoke test in the browser: two auto-bots duel, the message log scrolls by. Replace with the real duel UI. */
export class DuelTest extends Phaser.Scene {
  constructor() {
    super("DuelTest");
  }

  async create() {
    const log = this.add.text(16, 16, "", { fontFamily: "monospace", fontSize: "14px", color: "#d0ffd0" });
    const lines: string[] = [];
    const push = (s: string) => {
      lines.push(s);
      log.setText(lines.slice(-44).join("\n"));
    };

    const { core, cards, readScript } = await loadEngine();
    const pool = [...cards.records.keys()];
    const main = [...pool, ...pool].slice(0, 40);
    const duel = new DuelSession({ core, cards, readScript, decks: [{ main }, { main }] });

    const tick = () => {
      const step = duel.advance();
      for (const m of step.messages) {
        if (m.type === OcgMessageType.NEW_TURN) push(`--- new turn (P${m.player}) ---`);
        else if (m.type === OcgMessageType.SUMMONING) push(`P${m.controller} summons ${cards.name(m.code)}`);
        else if (m.type === OcgMessageType.CHAINING) push(`P${m.controller} activates ${cards.name(m.code)}`);
        else if (m.type === OcgMessageType.DAMAGE) push(`P${m.player} takes ${m.amount} damage`);
        else if (m.type === OcgMessageType.WIN) push(`=== P${m.player} wins ===`);
      }
      if (step.ended) {
        duel.destroy();
        push("Press SPACE to return to the overworld.");
        this.input.keyboard!.once("keydown-SPACE", () => this.scene.start("Overworld"));
        return;
      }
      duel.respond(autoRespond(step.prompt!));
      this.time.delayedCall(30, tick);
    };
    tick();
  }
}
