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
  /** M1: plays from card data alone. */
  generic: (ctx: BrainContext) => createGenericBrain({ weights: ctx.weights }),
  /** M2: generic + main-phase activations judged by simulating them (needs the engine, else plays like generic). */
  sim: (ctx: BrainContext) =>
    createGenericBrain({ simulator: ctx.engine ? new Simulator(ctx.engine, ctx.weights) : undefined, weights: ctx.weights, name: "sim" }),
  /** M3: sim + answers the opponent's attacks, summons, activations and phases by replaying them in a copy. */
  replay: (ctx: BrainContext) =>
    createGenericBrain({
      simulator: ctx.engine ? new Simulator(ctx.engine, ctx.weights) : undefined, replayChains: true, weights: ctx.weights, name: "replay",
    }),
} satisfies Record<string, (ctx: BrainContext) => Brain>;

export type BrainName = keyof typeof BRAINS;

export function isBrainName(name: string): name is BrainName {
  return name in BRAINS;
}
