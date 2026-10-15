// The turn planner: finds the best sequence of moves for the rest of the AI's turn. A beam search over plans: start
// from the moves the real prompt offers, extend the best few plans by the moves their copy offers next, and score
// every plan by playing it in a copy, ending the turn and letting the opponent play their next turn (stand-ins for
// what we can't see), so set traps, blockers and attacks earn what they're worth there. Plans that reach the same
// board are merged. Budgets cap the work: nodes (copies) and milliseconds.
//
// The search runs on the single guess of their hidden cards (world.ts). With `worlds` > 1 the best few plans (the best
// one per first move, then the next best) are then played again in that many sampled worlds, the same worlds for every
// plan, and the plan with the best average wins: their hand may hold no monster, a set card may be a Mirror Force.
//
// What the copies can't know is enforced here, mostly by trusting the real prompt over the copy: no Normal Summon when
// the real prompt offers none (already used, or forbidden this turn, e.g. after Scapegoat), no position change for a
// monster the real prompt won't let change (summoned or set this turn), no effect of a card already on the field that
// the real prompt doesn't offer (used this turn), monsters that already attacked don't attack again, no battle phase
// when the real prompt doesn't allow it (turn 1, after Main Phase 2).
import {
  OcgMessageType,
  OcgPhase,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
  type OcgMessage,
} from "ocgcore-wasm";
import type { FieldSnapshot } from "../../DuelSession.ts";
import { mulberry32 } from "../../rng.ts";
import type { AiView } from "../AiSeat.ts";
import { weightsOf } from "../board.ts";
import { boardDigest, nextSteps, type PlanStep } from "./sequence.ts";
import type { Simulator } from "./simulator.ts";
import { sampleWorlds } from "./world.ts";

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
  /** Sampled worlds the best plans are scored in again (at most); 1 = only the single guess (the planner before phase 2). */
  worlds: number;
  /** Worlds every rescored plan plays in (the first round). */
  firstWorlds: number;
  /** The best two plans closer than this after half the worlds play the other half too. */
  closeCall: number;
  /** Plans scored again in the worlds. */
  rescore: number;
}

/** The default planner: one guess of their hidden cards (sampled worlds measured weaker so far, rework phase 2). */
export const DEFAULT_PLAN_SETTINGS: Readonly<PlanSettings> = {
  beam: 3, depth: 6, children: 8, maxNodes: 60, maxMs: 2000, worlds: 1, firstWorlds: 4, closeCall: 0.5, rescore: 6,
};
/** The planner with sampled worlds (brain `worlds`). */
export const WORLD_PLAN_SETTINGS: Readonly<PlanSettings> = { ...DEFAULT_PLAN_SETTINGS, worlds: 32 };

export interface PlanContext {
  /** Our Normal Summon (or monster set) is already used this turn. */
  normalSummonUsed: boolean;
  /** Zones of our monsters that already attacked this turn. */
  attacked: ReadonlySet<number>;
  /** Seed of the sampled worlds (kept for the whole turn, so replanning doesn't trade one guess for another). */
  worldSeed: number;
}

export interface Plan {
  /** The moves, from the current prompt on. Then: battle with the usual logic if `battleAfter`, and end the turn. */
  steps: PlanStep[];
  /** Plans were scored with a battle phase after their moves (the real prompt allowed one). */
  battleAfter: boolean;
  /** Planned at a battle prompt: once its steps are done, the battle phase is over. */
  fromBattle: boolean;
  /** Its score: the board after the opponent's next turn (averaged over `worlds` sampled worlds, if any). */
  value: number;
  worlds: number;
  /** `boardDigest` the real board should have before each step ([0] = now). */
  checkpoints: number[];
  /** The best other plans considered (for the trace). */
  alternatives: { steps: PlanStep[]; value: number; worlds: number }[];
  nodes: number;
  ms: number;
}

interface Node {
  steps: PlanStep[];
  value: number;
  /** Sampled worlds behind `value` (0 = the single guess). */
  worlds?: number;
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
  // What the real main-phase prompt doesn't offer now stays off for cards already in play (the copy may allow more).
  const idle = prompt.type === OcgMessageType.SELECT_IDLECMD ? prompt : null;
  const summonBlocked = ctx.normalSummonUsed || (!!idle && !idle.summons.length && !idle.monster_sets.length);
  const key = (c: { code: number; location: number; sequence: number }) => `${c.code}:${c.location}:${c.sequence}`;
  const fieldNow = new Set([...view.board.players[view.seat].monsters, ...view.board.players[view.seat].spells]
    .filter((c) => c !== null).map((c) => key(c!)));
  const posOk = new Set(idle?.pos_changes.map(key) ?? []);
  const activateOk = new Set(idle?.activates.map(key) ?? []);
  const allowed = (s: PlanStep, steps: readonly PlanStep[]) => {
    if (idle && s.kind === "idle" && s.card && fieldNow.has(key(s.card))) {
      if (s.action === SelectIdleCMDAction.SELECT_POS_CHANGE && !posOk.has(key(s.card))) return false;
      if (s.action === SelectIdleCMDAction.SELECT_ACTIVATE && !activateOk.has(key(s.card))) return false;
    }
    if (s.kind === "idle" && s.action === SelectIdleCMDAction.TO_EP) return false; // ending the turn is every plan's last move
    if (s.kind === "battle" && s.action === SelectBattleCMDAction.TO_EP) return false;
    if (s.kind === "idle" && s.action === SelectIdleCMDAction.TO_BP && !canBattle) return false;
    const summoned = summonBlocked || steps.some((p) => p.kind === "idle" && (p.action === SelectIdleCMDAction.SELECT_SUMMON || p.action === SelectIdleCMDAction.SELECT_MONSTER_SET));
    if (s.kind === "idle" && summoned && (s.action === SelectIdleCMDAction.SELECT_SUMMON || s.action === SelectIdleCMDAction.SELECT_MONSTER_SET)) return false;
    if (s.kind === "attack" && ctx.attacked.has(s.attacker.sequence)) return false;
    return true;
  };

  // Every copy gets the same order for our unknown Deck: otherwise each plan draws different cards (Pot of Greed) and
  // the luckiest draw, not the best move, wins the comparison.
  const deckSeed = Math.floor(view.rng() * 2 ** 32);
  let nodes = 0;
  const evaluate = (steps: PlanStep[]): Node | null => {
    nodes++;
    const r = sim.sequence({ ...view, rng: mulberry32(deckSeed) }, [...prefix, ...steps], { opponentTurn: true, battleAfter: canBattle });
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
  let ranked = all;
  if (settings.worlds > 1) {
    // The best plan per first move (the move we make now), then the next best plans; each played in every world.
    const firsts = new Set<string>();
    const picked: Node[] = [];
    for (const n of all) {
      const first = JSON.stringify(n.steps[0] ?? null, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
      if (firsts.has(first) || picked.length >= settings.rescore) continue;
      firsts.add(first);
      picked.push(n);
    }
    for (const n of all) if (picked.length < settings.rescore && !picked.includes(n)) picked.push(n);
    // Rounds: every candidate in the first `firstWorlds` worlds, then the better half in as many more, and so on (the
    // worlds seen double each round) down to the best two; those play the rest only while they are a close call.
    const worlds = sampleWorlds(view, settings.worlds, ctx.worldSeed);
    const scale = weightsOf(view).worldScale;
    const alive = picked.map((n) => ({ n, values: [] as number[], value: -Infinity }));
    const out: typeof alive = [];
    for (let used = 0, batch = Math.min(settings.firstWorlds, worlds.length); batch > 0 && alive.length; ) {
      for (const c of alive) for (const world of worlds.slice(used, used + batch)) {
        nodes++;
        const r = sim.sequence({ ...view, rng: mulberry32(deckSeed) }, [...prefix, ...c.n.steps], { opponentTurn: true, battleAfter: canBattle, world });
        if (r && r.done === prefix.length + c.n.steps.length) c.values.push(r.value);
      }
      used += batch;
      for (const c of alive) c.value = c.values.length ? averageValue(c.values, scale) : -Infinity;
      alive.sort((a, b) => b.value - a.value);
      // Out of worlds or time (the base world's best were scored first), or the last two are clearly apart: this
      // ranking stands. Only close calls go on to the last worlds.
      batch = Math.min(used, worlds.length - used);
      const [a, b] = alive;
      const same = !!b && a.values.length === b.values.length && a.values.every((v, i) => v === b.values[i]);
      const settled = alive.length <= 2 && (same || used >= settings.worlds / 2 && a.value - (b?.value ?? -Infinity) >= settings.closeCall);
      if (!batch || alive.length <= 1 || settled || performance.now() - started > settings.maxMs * 1.5) break;
      const keep = Math.max(2, Math.ceil(alive.length / 2));
      out.unshift(...alive.splice(keep));
    }
    const rescored = [...alive, ...out].filter((c) => c.values.length).map((c) => ({ ...c.n, value: c.value, worlds: c.values.length }));
    if (rescored.length) ranked = rescored;
  }
  const best = ranked[0];
  return {
    steps: best.steps, battleAfter: !!canBattle, fromBattle: prompt.type === OcgMessageType.SELECT_BATTLECMD, value: best.value,
    worlds: best.worlds ?? 0, checkpoints: best.checkpoints,
    alternatives: ranked.slice(1, 6).map((n) => ({ steps: n.steps, value: n.value, worlds: n.worlds ?? 0 })),
    nodes, ms: performance.now() - started,
  };
}

/**
 * One value for a plan from its values in several worlds. Averaged as win chances, not board values: a board value
 * `v` counts as 1 / (1 + e^(-v / scale)), so a lost world (-1000) costs a share of the average instead of drowning
 * every other world. Turned back into board units (logit) so it reads like the other scores; ties (every world lost)
 * go to the higher plain average.
 */
export function averageValue(values: readonly number[], scale: number): number {
  const p = values.reduce((sum, v) => sum + 1 / (1 + Math.exp(-v / scale)), 0) / values.length;
  const q = Math.min(1 - 1e-9, Math.max(1e-9, p));
  return scale * Math.log(q / (1 - q)) + 1e-3 * (values.reduce((a, b) => a + b, 0) / values.length);
}
