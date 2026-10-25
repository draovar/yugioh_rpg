// Shared pieces of the generic brain: scored options and the brain's own per-turn state.
import type { OcgCardLoc, OcgResponse } from "ocgcore-wasm";
import type { Decision } from "../AiSeat.ts";
import type { Simulator } from "../sim/simulator.ts";
import type { Plan } from "../sim/planner.ts";

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
  /**
   * Copies of the board: plans whole turns (sim/planner.ts), replays the opponent's moves for chain answers, and judges
   * single activations when no plan can be made. Null = judge by card data (M1).
   */
  readonly simulator: Simulator | null;
  /** The plan being followed and the index of its next step. */
  plan: { plan: Plan; at: number } | null = null;
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
  /** The monster that declared the current attack (for the target prompt). */
  attacker: Pick<OcgCardLoc, "controller" | "location" | "sequence"> | null = null;
  /**
   * Attacks the target prompt refused this turn, as `attacker zone>target zone` (e.g. Soul-Absorbing Bone Tower can't
   * be attacked while another Zombie is out): the battle logic doesn't plan them again.
   */
  blockedAttacks = new Set<string>();
  /** The card the plan's current move picks first (e.g. De-Spell's target), when the plan names one. */
  pickTarget: Pick<OcgCardLoc, "controller" | "location" | "sequence"> | null = null;

  constructor(simulator: Simulator | null = null) {
    this.simulator = simulator;
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
    this.attacker = null;
    this.blockedAttacks.clear();
    this.pickTarget = null;
  }
}

/** The `blockedAttacks` key of an attack by the monster in zone `attacker` on the one in zone `target`. */
export const attackKey = (attacker: number, target: number) => `${attacker}>${target}`;

export const sameLoc = (a: Pick<OcgCardLoc, "controller" | "location" | "sequence">, b: Pick<OcgCardLoc, "controller" | "location" | "sequence">) =>
  a.controller === b.controller && a.location === b.location && a.sequence === b.sequence;
