// Main-phase and battle decisions by turn plan (sim/planner.ts): plan the rest of the turn, take the plan's next move,
// and keep following it while the real board looks the way the plan expected before each move. When it doesn't (the
// opponent responded, a draw differed, a target went elsewhere), plan again from there. Null = no plan (no simulator,
// the copy failed, or the move isn't offered): the caller falls back to scoring single moves.
import {
  OcgLocation,
  OcgMessageType,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
  type OcgMessage,
  type OcgResponse,
} from "ocgcore-wasm";
import type { AiView, Decision } from "../AiSeat.ts";
import { planTurn } from "../sim/planner.ts";
import { boardDigest, describeStep, responseFor, type PlanStep } from "../sim/sequence.ts";
import type { BrainState } from "./common.ts";

type IdleMessage = Extract<OcgMessage, { type: OcgMessageType.SELECT_IDLECMD }>;
type BattleMessage = Extract<OcgMessage, { type: OcgMessageType.SELECT_BATTLECMD }>;

const describePlan = (steps: readonly PlanStep[], view: AiView, battle: boolean) =>
  [...steps.map((s) => describeStep(s, view.cards)), battle ? "battle" : "end turn"].join(" → ");

/** A main-phase activation of a Spell whose text starts with "Draw": Pot of Greed, Upstart Goblin, Graceful Charity. */
function drawsFirst(s: PlanStep, view: AiView): boolean {
  if (s.kind !== "idle" || s.action !== SelectIdleCMDAction.SELECT_ACTIVATE || !s.card) return false;
  return /^Draw \d+ cards?\b/.test(view.cards.records.get(s.card.code)?.desc ?? "");
}

export function decideByPlan(m: IdleMessage | BattleMessage, view: AiView, state: BrainState, retry = true): Decision | null {
  if (!state.simulator || !state.planTurns || view.memory.turnPlayer !== view.seat) return null;
  // A finished plan went on to the battle phase: battle with the usual logic, then plan Main Phase 2 afresh.
  if (state.plan && state.plan.at > state.plan.plan.steps.length) {
    if (m.type === OcgMessageType.SELECT_BATTLECMD) return null;
    state.plan = null;
  }
  const now = boardDigest(view.board, view.seat);
  let current = state.plan;
  let reason = "following the plan";
  if (!current || current.plan.checkpoints[current.at] !== now) {
    const attacked = new Set(view.memory.attacks.filter((a) => a.attacker.controller === view.seat).map((a) => a.attacker.sequence));
    const plan = planTurn(state.simulator, view, m, { normalSummonUsed: state.normalSummonUsed, attacked });
    if (!plan) { state.plan = null; return null; }
    current = state.plan = { plan, at: 0 };
    reason = `new plan (${plan.nodes} copies, ${Math.round(plan.ms)} ms)`;
  }
  const { plan } = current;
  let step = plan.steps[current.at];
  // A draw spell later in the plan goes first: the cards it brings may change the rest of the turn (the copies drew a
  // guess), so plan again once they're in hand.
  const draw = plan.steps.findIndex((s, i) => i > current!.at && drawsFirst(s, view) && responseFor(m, s));
  if (step && draw >= 0) {
    step = plan.steps[draw];
    state.plan = null;
    reason = "drawing first, then a new plan";
  }
  let response: OcgResponse | null;
  if (step) {
    response = responseFor(m, step);
    if (!response) {
      // Refused by the real duel (something the copy didn't know): plan again from here, once.
      state.plan = null;
      return retry ? decideByPlan(m, view, state, false) : null;
    }
  } else if (m.type === OcgMessageType.SELECT_IDLECMD) {
    // The plan's moves are done: battle (as the plans were scored) or end the turn.
    const battle = plan.battleAfter && m.to_bp;
    response = { type: OcgResponseType.SELECT_IDLECMD, action: battle ? SelectIdleCMDAction.TO_BP : SelectIdleCMDAction.TO_EP, index: null };
  } else {
    current.at++;
    return null; // in the battle phase: the usual battle logic finishes it
  }
  if (state.plan) current.at++;
  if (step?.kind === "attack")
    state.attackTarget = step.target === null ? null : { controller: (1 - view.seat) as 0 | 1, location: OcgLocation.MZONE, sequence: step.target };
  if (step?.kind === "idle" && (step.action === SelectIdleCMDAction.SELECT_SUMMON || step.action === SelectIdleCMDAction.SELECT_MONSTER_SET))
    state.normalSummonUsed = true;
  return {
    response,
    reason: state.plan ? `${reason}: step ${current.at} of ${plan.steps.length + 1}` : reason,
    options: [
      { label: `plan: ${describePlan(plan.steps, view, plan.battleAfter)}`, score: plan.value },
      ...plan.alternatives.map((a) => ({ label: `     ${describePlan(a.steps, view, plan.battleAfter)}`, score: a.value })),
    ],
  };
}
