// The turn planner: finds the best sequence of moves for the rest of the AI's turn. A beam search over plans: start
// from the moves the real prompt offers, extend the best few plans by the moves their copy offers next, and score
// every plan by playing it in a copy, ending the turn and letting the opponent play their next turn (stand-ins for
// what we can't see), so set traps, blockers and attacks earn what they're worth there. Plans that reach the same
// board are merged. A move aimed at one of the opponent's cards (De-Spell, Hane-Hane's flip) is also tried on each
// of their other cards it could hit, as separate plans: the generic pick rule rates cards, not what removing them
// unlocks (De-Spell on Swords of Revealing Light frees our attacks). Budgets cap the work: nodes (copies) and milliseconds.
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
import type { FieldSnapshot } from "../../engine/DuelSession.ts";
import { mulberry32 } from "../../engine/rng.ts";
import type { AiView } from "../AiSeat.ts";
import { boardDigest, nextSteps, type PickTarget, type PlanStep } from "./sequence.ts";
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
  /**
   * Plans kept besides the beam because their last move unlocked a summon or activation the plan before it couldn't
   * make (Soul Exchange → a Tribute Summon): scored as if the turn ended there they often look lost, before the move
   * they enable is tried.
   */
  unlockKeep: number;
  /**
   * Deck orders a plan that draws from our Deck is played with (its value: their average). The copies' order of our
   * Deck is a guess, so one order judges Reload on a single lucky or unlucky draw.
   */
  drawSamples: number;
}

export const DEFAULT_PLAN_SETTINGS: Readonly<PlanSettings> = { beam: 3, depth: 6, children: 8, maxNodes: 60, maxMs: 2000, unlockKeep: 2, drawSamples: 4 };

const UNLOCKS: ReadonlySet<SelectIdleCMDAction> = new Set([
  SelectIdleCMDAction.SELECT_SUMMON, SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, SelectIdleCMDAction.SELECT_ACTIVATE,
]);
const stepKey = (s: PlanStep) => (s.kind === "idle" ? `${s.action}:${s.card?.code ?? 0}` : "");

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
  /** Damage the opponent took in our turn. */
  damage: number;
  /** The last step's pick among the opponent's cards, and the others it could have taken. */
  picks?: { chosen: PickTarget; others: PickTarget[] };
}

/** Plans scoring within this of the best count as tied: the one dealing more damage wins, then the one summoning more. */
const TIE = 0.05;
const summons = (n: Node) => n.steps.filter((s) => s.kind === "idle"
  && (s.action === SelectIdleCMDAction.SELECT_SUMMON || s.action === SelectIdleCMDAction.SELECT_SPECIAL_SUMMON)).length;

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
  const play = (steps: PlanStep[], seed: number, playOn = false) => {
    nodes++;
    const r = sim.sequence({ ...view, rng: mulberry32(seed) }, [...prefix, ...steps], { opponentTurn: true, battleAfter: canBattle, playOn });
    return r && r.done >= prefix.length + steps.length ? r : null;
  };
  const evaluate = (steps: PlanStep[]): Node | null => {
    const r = play(steps, deckSeed);
    if (!r) return null;
    const node: Node = { steps, value: r.value, next: r.next, checkpoints: r.checkpoints.slice(prefix.length), damage: r.damageDealt, picks: r.picks };
    if (r.drewAt === null || r.drewAt < prefix.length) return node;
    // A draw from our Deck ends the plan: moves after it would play the guessed cards (the real duel plans again once
    // they're drawn). Its value: the average over several orders of our Deck, not one guessed draw, each played on by
    // the generic brain (what the drawn cards are good for this turn).
    if (r.drewAt - prefix.length < steps.length - 1) return null;
    let total = 0, n = 0;
    for (let k = 0; k < settings.drawSamples; k++) {
      const o = play(steps, (deckSeed + k * 0x9e3779b9) >>> 0, true);
      if (o) { total += o.value; n++; }
    }
    return n ? { ...node, value: total / n, next: [] } : null;
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
    /** Children whose last move made a summon or activation possible that their parent couldn't make. */
    const unlocking = new Set<Node>();
    for (const node of frontier) {
      const before = new Set(node.next.map(stepKey));
      const moves = node.next.filter((s) => allowed(s, node.steps)).sort((a, b) => priority(a) - priority(b)).slice(0, settings.children);
      const queue = [...moves];
      for (let move = queue.shift(); move; move = queue.shift()) {
        if (overBudget()) break;
        const child = evaluate([...node.steps, move]);
        if (!child) continue;
        if (child.picks && move.kind === "idle" && !move.pick) {
          // The move hit one of their cards: name that pick in the plan (the real duel follows it) and try the others.
          child.steps[child.steps.length - 1] = { ...move, pick: child.picks.chosen };
          queue.unshift(...child.picks.others.map((pick): PlanStep => ({ ...move, pick })));
        }
        // The board reached after the move (before any further move): a plan that got here another way is the same plan.
        const reached = child.checkpoints[child.steps.length];
        if (reached !== undefined) {
          if (seen.has(reached)) continue;
          seen.add(reached);
        }
        children.push(child);
        if (child.next.some((s) => s.kind === "idle" && UNLOCKS.has(s.action) && !before.has(stepKey(s)) && allowed(s, child.steps)))
          unlocking.add(child);
      }
    }
    all.push(...children);
    children.sort((a, b) => b.value - a.value);
    frontier = [
      ...children.slice(0, settings.beam),
      ...children.slice(settings.beam).filter((c) => unlocking.has(c)).slice(0, settings.unlockKeep),
    ];
  }

  all.sort((a, b) => b.value - a.value);
  // A near-tie goes to the more active plan (damage, then summons): holding back is no safer when the scores agree.
  // Not between wins: damage past 0 LP means nothing, and extra moves only over-extend (Dark Dust Spirit destroying
  // our own monsters for 300 more damage; a set card stopped the attack). The win with the fewest moves goes.
  const tied = all.filter((n) => n.value >= all[0].value - TIE);
  const best = all[0].value >= 1000
    ? tied.reduce((a, b) => (b.steps.length < a.steps.length ? b : a))
    : tied.reduce((a, b) => (b.damage > a.damage || (b.damage === a.damage && summons(b) > summons(a)) ? b : a));
  return {
    steps: best.steps, battleAfter: !!canBattle, value: best.value, checkpoints: best.checkpoints,
    alternatives: all.filter((n) => n !== best).slice(0, 5).map((n) => ({ steps: n.steps, value: n.value })),
    nodes, ms: performance.now() - started,
  };
}
