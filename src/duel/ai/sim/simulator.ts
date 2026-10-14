// One-move simulation: lay the board out as a fresh duel (world.ts), play one of the AI's options there, let the card
// scripts resolve it, and score the board before and after. The engine knows what every card does, so this judges
// Heavy Storm, Raigeki, Monster Reborn... without card-specific rules.
//
// Inside the copy the AI answers its own follow-up prompts (zones, targets, costs) with the generic brain; the
// opponent's stand-ins never respond (it passes every chain). What the copy can't hold: once-per-turn uses, equip
// links, counters, declared names, the turn number; moves that depend on them may not be found in the copy (null).
import {
  OcgMessageType,
  OcgResponseType,
  SelectIdleCMDAction,
  type OcgCardLocActive,
  type OcgCoreSync,
  type OcgMessage,
  type OcgResponse,
} from "ocgcore-wasm";
import { autoRespond } from "../../autoBot.ts";
import type { CardDb } from "../../cardData.ts";
import { DuelSession, type DuelSeed, type FieldSnapshot } from "../../DuelSession.ts";
import { fnv1a } from "../../hash.ts";
import { AiSeat, type AiView } from "../AiSeat.ts";
import { evaluate } from "../board.ts";
import { createGenericBrain } from "../generic/index.ts";
import { formatTrace } from "../trace.ts";
import { layoutFrom, withBlankScripts, withBlanks } from "./world.ts";

/** The rules engine (not a duel): what the simulator needs to build copies. Holds no hidden information. */
export interface SimEngine {
  core: OcgCoreSync;
  cards: CardDb;
  readScript: (name: string) => string | null;
}

export interface SimOutcome {
  /** Board value after minus before, from the AI's side, in cards. */
  delta: number;
  /** Engine prompts the move took to resolve. */
  steps: number;
}

type IdleMessage = Extract<OcgMessage, { type: OcgMessageType.SELECT_IDLECMD }>;

/** ocgcore duel mode flag: the first turn may attack (the copy always starts on turn 1). */
const ATTACK_FIRST_TURN = 0x2n;
const SIM_SEED: DuelSeed = [0x51n, 0x4dn, 0x5en, 0xedn];
/** A move that takes more prompts than this to resolve is abandoned. */
const MAX_STEPS = 200;

export class Simulator {
  /** Debugging: receives every decision made inside the copies (arena `--sim-trace`). */
  static debug: ((line: string) => void) | null = null;
  private readonly core: OcgCoreSync;
  private readonly cards: CardDb;
  private readonly readScript: (name: string) => string | null;
  private readonly cache = new Map<number, SimOutcome | null>();
  /** Copies built so far (for the arena's statistics). */
  builds = 0;

  constructor(engine: SimEngine) {
    this.core = engine.core;
    this.cards = withBlanks(engine.cards);
    this.readScript = withBlankScripts(engine.readScript);
  }

  /** The board change of activating `prompt.activates[index]` in the main phase, or null if the copy can't play it. */
  activation(view: AiView, prompt: IdleMessage, index: number): SimOutcome | null {
    const option = prompt.activates[index];
    const layout = layoutFrom(view);
    const key = fnv1a(JSON.stringify([layout, option.code, option.location, option.sequence, option.description],
      (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    if (this.cache.has(key)) return this.cache.get(key)!;
    if (this.cache.size > 2000) this.cache.clear();
    const outcome = this.play(layout, option);
    this.cache.set(key, outcome);
    return outcome;
  }

  private play(layout: ReturnType<typeof layoutFrom>, option: OcgCardLocActive): SimOutcome | null {
    this.builds++;
    const duel = new DuelSession({
      core: this.core, cards: this.cards, readScript: this.readScript, decks: layout.decks, startingLP: layout.lp,
      draws: { opening: 0, perTurn: 0 }, extraFlags: ATTACK_FIRST_TURN, seed: SIM_SEED, onCoreLog: () => {},
    });
    try {
      const debug = Simulator.debug;
      const ai = new AiSeat({ seat: 0, brain: createGenericBrain(), duel, onTrace: debug ? (e) => debug(`    (copy) ${formatTrace(e)}`) : undefined });
      const view = (): AiView => ({
        seat: 0, board: duel.snapshot(0), memory: ai.memory, cards: this.cards, hint: null, rng: () => 0.5, deckList: null,
      });
      const step = () => {
        const s = duel.advance();
        ai.observe(s.messages);
        return s;
      };

      // Through the draw/standby phase windows to our main phase.
      let s = step();
      for (let n = 0; !s.ended; n++) {
        const p = s.prompt as OcgMessage & { player: number };
        if (p.type === OcgMessageType.SELECT_IDLECMD && p.player === 0) break;
        if (n > 20) return null;
        duel.respond(this.passive(p));
        s = step();
      }
      if (s.ended) return null;
      const idle = s.prompt as IdleMessage;
      const j = findSame(idle.activates, option);
      if (j < 0) return null;

      const before = evaluate(view());
      const boardBefore = debug ? this.describe(duel) : "";
      duel.respond({ type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index: j });
      let steps = 0;
      for (s = step(); !s.ended; s = step()) {
        const p = s.prompt as OcgMessage & { player: number };
        if (p.player === 0 && (p.type === OcgMessageType.SELECT_IDLECMD || p.type === OcgMessageType.SELECT_BATTLECMD)) break;
        if (++steps > MAX_STEPS) return null;
        duel.respond(p.player === 0 ? ai.decide(p) : this.passive(p));
      }
      const after = s.ended ? (s.winner === 0 ? 1000 : s.winner === 1 ? -1000 : 0) : evaluate(view());
      debug?.(`    (copy) ${this.cards.name(option.code)}: ${before.toFixed(2)} -> ${after.toFixed(2)}
` +
        `      before ${boardBefore}
      after  ${this.describe(duel)}`);
      return { delta: after - before, steps };
    } catch {
      return null; // the copy couldn't play it (e.g. RETRY): judge the move without simulation
    } finally {
      duel.destroy();
    }
  }

  /** The copy's monsters, hand sizes and LP in one line (debug output). */
  private describe(duel: DuelSession): string {
    const side = (p: FieldSnapshot["players"][number]) =>
      `[${p.monsters.map((c) => (c ? (c.code ? this.cards.name(c.code).slice(0, 12) : "?") : "-")).join(",")}] hand ${p.hand.length} lp ${p.lp}`;
    const [me, opp] = duel.snapshot(0).players;
    return `me ${side(me)} | opp ${side(opp)}`;
  }

  /** The opponent's stand-ins: never respond; anything forced gets the first legal answer. */
  private passive(p: OcgMessage): OcgResponse {
    if (p.type === OcgMessageType.SELECT_CHAIN && !p.forced) return { type: OcgResponseType.SELECT_CHAIN, index: null };
    return autoRespond(p, () => 0, this.cards);
  }
}

/** The same activation in the copy's prompt: same card, place and effect (hand cards: any copy of the card). */
function findSame(list: OcgCardLocActive[], o: OcgCardLocActive): number {
  const exact = list.findIndex((c) => c.code === o.code && c.location === o.location && c.sequence === o.sequence && c.description === o.description);
  if (exact >= 0) return exact;
  return list.findIndex((c) => c.code === o.code && c.location === o.location && c.description === o.description);
}
