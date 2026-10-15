// Shared pieces of the generic brain: scored options and the brain's own per-turn state.
import type { OcgCardLoc, OcgResponse } from "ocgcore-wasm";
import type { Decision } from "../AiSeat.ts";
import type { Simulator } from "../sim/simulator.ts";
import { DEFAULT_PLAN_SETTINGS, type Plan, type PlanSettings } from "../sim/planner.ts";

export interface Option {
  label: string;
  score: number;
  response: OcgResponse;
}

/** The highest-scoring option as a Decision; the trace lists the best few. */
export function best(options: Option[], reason: (o: Option) => string = () => ""): Decision {
  const sorted = [...options].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  return {
    response: top.response,
    reason: reason(top),
    options: sorted.slice(0, 8).map((o) => ({ label: o.label, score: o.score })),
  };
}

/** What the brain remembers between decisions (reset every turn). */
export class BrainState {
  /** Plays main-phase activations on a copy of the board to judge them (M2); null = judge by card type (M1). */
  readonly simulator: Simulator | null;
  /** Answers the opponent's moves by replaying them in a copy (M3); needs the simulator. */
  readonly replayChains: boolean;
  /** Plans whole turns (sim/planner.ts) for main-phase and battle decisions; needs the simulator. */
  readonly planTurns: boolean;
  /** The turn planner's budgets and number of sampled worlds. */
  readonly planSettings: Readonly<PlanSettings>;
  /** The plan being followed and the index of its next step. */
  plan: { plan: Plan; at: number } | null = null;
  /** Seed of this turn's sampled worlds (drawn at the turn's first plan), and that turn. */
  worldSeed = 0;
  worldSeedTurn = -1;
  /** Our Normal Summon (or monster set) is used this turn (the copies don't know). */
  normalSummonUsed = false;
  turn = -1;
  /** Main-phase decisions this turn (a safety stop against loops). */
  idleSteps = 0;
  /** How often each card effect was activated this turn, by `code:description`. */
  activations = new Map<string, number>();
  /** The last main-phase activation (`code:description`), to give up on it if its targets turn out to be ours. */
  lastActivation: string | null = null;
  /** The monster the battle plan wants the current attack to hit. */
  attackTarget: Pick<OcgCardLoc, "controller" | "location" | "sequence"> | null = null;

  constructor(simulator: Simulator | null = null, replayChains = false, planTurns = false, planSettings = DEFAULT_PLAN_SETTINGS) {
    this.simulator = simulator;
    this.planSettings = planSettings;
    this.replayChains = replayChains;
    this.planTurns = planTurns;
  }

  /** Resets the per-turn state when a new turn has started. */
  sync(turn: number): void {
    if (turn === this.turn) return;
    this.turn = turn;
    this.idleSteps = 0;
    this.activations.clear();
    this.lastActivation = null;
    this.plan = null;
    this.normalSummonUsed = false;
    this.attackTarget = null;
  }
}

export const sameLoc = (a: Pick<OcgCardLoc, "controller" | "location" | "sequence">, b: Pick<OcgCardLoc, "controller" | "location" | "sequence">) =>
  a.controller === b.controller && a.location === b.location && a.sequence === b.sequence;
