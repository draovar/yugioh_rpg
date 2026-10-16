// The available brains by name (arena, URL options, later trainer profiles).
import { autoRespond } from "../autoBot.ts";
import type { Brain } from "./AiSeat.ts";
import { createGenericBrain } from "./generic/index.ts";
import { Simulator, type SimEngine } from "./sim/simulator.ts";
import type { Weights } from "./board.ts";

/** What a brain may be built with: the rules engine for simulations (never the duel itself), and its weights. */
export interface BrainContext {
  engine?: SimEngine;
  /** How it values things (board.ts); default DEFAULT_WEIGHTS. Tuning and trainer styles set these. */
  weights?: Readonly<Weights>;
}

/** autoBot behind the Brain interface: the first legal option. The baseline every real brain must beat. */
export const autoBotBrain: Brain = {
  name: "autobot",
  decide: (prompt, view) => ({ response: autoRespond(prompt, view.rng, view.cards), reason: "first legal option" }),
};

export const BRAINS = {
  autobot: () => autoBotBrain,
  /** M1: plays from card data alone, no simulation (fast; the planner's own fallback). */
  generic: (ctx: BrainContext) => createGenericBrain({ weights: ctx.weights }),
  /**
   * generic + the simulator: plans whole turns (sim/planner.ts: main-phase and battle moves as the best sequence for
   * the turn) and answers the opponent's moves by replaying them in a copy (sim/replay.ts). Needs the engine, else it
   * plays like generic.
   */
  planner: (ctx: BrainContext) =>
    createGenericBrain({ simulator: ctx.engine ? new Simulator(ctx.engine, ctx.weights) : undefined, weights: ctx.weights, name: "planner" }),
} satisfies Record<string, (ctx: BrainContext) => Brain>;

export type BrainName = keyof typeof BRAINS;

/** The opponent the game uses unless told otherwise (`&ai=NAME`), and the one `npm run ai-bench` checks. */
export const DEFAULT_BRAIN: BrainName = "planner";

export function isBrainName(name: string): name is BrainName {
  return name in BRAINS;
}
