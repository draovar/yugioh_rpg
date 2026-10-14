// Shared pieces of the generic brain: scored options and the brain's own per-turn state.
import type { OcgCardLoc, OcgResponse } from "ocgcore-wasm";
import type { Decision } from "../AiSeat.ts";

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
  turn = -1;
  /** Main-phase decisions this turn (a safety stop against loops). */
  idleSteps = 0;
  /** How often each card effect was activated this turn, by `code:description`. */
  activations = new Map<string, number>();
  /** The last main-phase activation (`code:description`), to give up on it if its targets turn out to be ours. */
  lastActivation: string | null = null;
  /** The monster the battle plan wants the current attack to hit. */
  attackTarget: Pick<OcgCardLoc, "controller" | "location" | "sequence"> | null = null;

  /** Resets the per-turn state when a new turn has started. */
  sync(turn: number): void {
    if (turn === this.turn) return;
    this.turn = turn;
    this.idleSteps = 0;
    this.activations.clear();
    this.lastActivation = null;
    this.attackTarget = null;
  }
}

export const sameLoc = (a: Pick<OcgCardLoc, "controller" | "location" | "sequence">, b: Pick<OcgCardLoc, "controller" | "location" | "sequence">) =>
  a.controller === b.controller && a.location === b.location && a.sequence === b.sequence;
