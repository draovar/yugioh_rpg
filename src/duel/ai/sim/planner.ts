// The turn planner: finds the best sequence of moves for the rest of the AI's turn. A beam search over plans: start
// from the moves the real prompt offers, extend the best few plans by the moves their copy offers next, and score
// every plan by playing it in a copy, ending the turn and letting the opponent play their next turn (stand-ins for
// what we can't see), so set traps, blockers and attacks earn what they're worth there. Plans that reach the same
// board are merged. Budgets cap the work: nodes (copies) and milliseconds.
//
// What the copies can't know is enforced here: no second Normal Summon after one was used, monsters that already
// attacked don't attack again, no battle phase when the real prompt doesn't allow it (turn 1, after Main Phase 2).
import {
  OcgMessageType,
  OcgPhase,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
  type OcgMessage,
} from "ocgcore-wasm";
import type { FieldSnapshot } from "../../DuelSession.ts";
import type { AiView } from "../AiSeat.ts";
import { boardDigest, nextSteps, type PlanStep } from "./sequence.ts";
import type { Simulator } from "./simulator.ts";

type IdleMessage = Extract<OcgMessage, { type: OcgMessageType.SELECT_IDLECMD }>;
type BattleMessage = Extract<OcgMessage, { type: OcgMessageType.SELECT_BATTLECMD }>;

export interface PlanSettings {
  /** Plans kept at each depth. */
  beam: number;
  /** Most steps in a plan. */
  depth: number;
  /** Most new steps tried per kept plan. */
  children: number;
  /** Most copies per search, and most milliseconds. */
  maxNodes: number;
  maxMs: number;
}

export const DEFAULT_PLAN_SETTINGS: Readonly<PlanSettings> = { beam: 3, depth: 6, children: 8, maxNodes: 60, maxMs: 2000 };

export interface PlanContext {
  /** Our Normal Summon (or monster set) is already used this turn. */
  normalSummonUsed: boolean;
  /** Zones of our monsters that already attacked this turn. */
  attacked: ReadonlySet<number>;
}

export interface Plan {
  /** The moves, from the current prompt on. Then: battle with the usual logic if `battleAfter`, and end the turn. */
  steps: PlanStep[];
  /** Plans were scored with a battle phase after their moves (the real prompt allowed one). */
  battleAfter: boolean;
  /** Its score: the board after the opponent's next turn. */
  value: number;
  /** `boardDigest` the real board should have before each step ([0] = now). */
  checkpoints: number[];
  /** The best other plans considered (for the trace). */
  alternatives: { steps: PlanStep[]; value: number }[];
  nodes: number;
  ms: number;
}

interface Node {
  steps: PlanStep[];
  value: number;
  next: PlanStep[];
  checkpoints: number[];
}

const BATTLE = 0xf8;

/** Tries steps in this order (cut off at `children`): what changes the board most first, sets last. */
function priority(s: PlanStep): number {
  if (s.kind === "attack") return 0;
  if (s.kind === "battle") return 6;
  switch (s.action) {
    case SelectIdleCMDAction.SELECT_ACTIVATE: return 1;
    case SelectIdleCMDAction.SELECT_SPECIAL_SUMMON: return 2;
    case SelectIdleCMDAction.SELECT_SUMMON: return 3;
    case SelectIdleCMDAction.SELECT_POS_CHANGE: return 4;
    case SelectIdleCMDAction.SELECT_MONSTER_SET: return 5;
    case SelectIdleCMDAction.TO_BP: return 5;
    default: return 7; // spell/trap sets
  }
}

/** The best plan for the rest of the turn from this prompt, or null if no copy could be played. */
export function planTurn(
  sim: Simulator, view: AiView, prompt: IdleMessage | BattleMessage, ctx: PlanContext,
  settings: Readonly<PlanSettings> = DEFAULT_PLAN_SETTINGS,
): Plan | null {
  const started = performance.now();
  const phase = view.memory.phase;
  // A copy starts in Main Phase 1: these steps (not part of the plan) bring it to the real phase first.
  const prefix: PlanStep[] = phase & BATTLE ? [{ kind: "idle", action: SelectIdleCMDAction.TO_BP }]
    : phase === OcgPhase.MAIN2 ? [{ kind: "idle", action: SelectIdleCMDAction.TO_BP }, { kind: "battle", action: SelectBattleCMDAction.TO_M2 }]
    : [];
  const canBattle = prompt.type === OcgMessageType.SELECT_BATTLECMD || (phase === OcgPhase.MAIN1 && prompt.to_bp);
  const allowed = (s: PlanStep, steps: readonly PlanStep[]) => {
    if (s.kind === "idle" && s.action === SelectIdleCMDAction.TO_EP) return false; // ending the turn is every plan's last move
    if (s.kind === "battle" && s.action === SelectBattleCMDAction.TO_EP) return false;
    if (s.kind === "idle" && s.action === SelectIdleCMDAction.TO_BP && !canBattle) return false;
    const summoned = ctx.normalSummonUsed || steps.some((p) => p.kind === "idle" && (p.action === SelectIdleCMDAction.SELECT_SUMMON || p.action === SelectIdleCMDAction.SELECT_MONSTER_SET));
    if (s.kind === "idle" && summoned && (s.action === SelectIdleCMDAction.SELECT_SUMMON || s.action === SelectIdleCMDAction.SELECT_MONSTER_SET)) return false;
    if (s.kind === "attack" && ctx.attacked.has(s.attacker.sequence)) return false;
    return true;
  };

  let nodes = 0;
  const evaluate = (steps: PlanStep[]): Node | null => {
    nodes++;
    const r = sim.sequence(view, [...prefix, ...steps], { opponentTurn: true, battleAfter: canBattle });
    if (!r || r.done < prefix.length + steps.length) return null;
    return { steps, value: r.value, next: r.next, checkpoints: r.checkpoints.slice(prefix.length) };
  };
  const overBudget = () => nodes >= settings.maxNodes || performance.now() - started > settings.maxMs;

  // The root: end the turn now. Its moves come from the real prompt (the copy may allow more than is legal).
  const root = evaluate([]);
  if (!root) return null;
  const ours: FieldSnapshot = { players: [view.board.players[view.seat], view.board.players[1 - view.seat]] };
  root.next = nextSteps(prompt, ours);

  const all: Node[] = [root];
  const seen = new Set<number>([root.checkpoints[0] ?? 0]);
  let frontier: Node[] = [root];
  for (let depth = 0; depth < settings.depth && frontier.length && !overBudget(); depth++) {
    const children: Node[] = [];
    for (const node of frontier) {
      const moves = node.next.filter((s) => allowed(s, node.steps)).sort((a, b) => priority(a) - priority(b)).slice(0, settings.children);
      for (const move of moves) {
        if (overBudget()) break;
        const child = evaluate([...node.steps, move]);
        if (!child) continue;
        // The board reached after the move (before any further move): a plan that got here another way is the same plan.
        const reached = child.checkpoints[child.steps.length];
        if (reached !== undefined) {
          if (seen.has(reached)) continue;
          seen.add(reached);
        }
        children.push(child);
      }
    }
    all.push(...children);
    frontier = children.sort((a, b) => b.value - a.value).slice(0, settings.beam);
  }

  all.sort((a, b) => b.value - a.value);
  const best = all[0];
  return {
    steps: best.steps, battleAfter: !!canBattle, value: best.value, checkpoints: best.checkpoints,
    alternatives: all.slice(1, 6).map((n) => ({ steps: n.steps, value: n.value })),
    nodes, ms: performance.now() - started,
  };
}
