// A sequence of the AI's own moves played in one copy: the turn planner's building block. The steps are main-phase
// and battle commands ("activate Dark Hole", "summon Jinzo", "attack with Jinzo", "end turn"); everything they lead
// to (zones, targets, tributes, costs) is answered by the generic brain as the AI would, and the opponent's stand-ins
// never respond. Optionally the copy then plays the opponent's whole next turn (generic brain, stand-ins), so a plan
// is judged by what happens after it too. One copy per sequence: ocgcore can't fork a duel, so a planner extends plans
// by playing them again from the start (cheap with the prepared pool).
import {
  OcgMessageType,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
  type OcgMessage,
  type OcgResponse,
} from "ocgcore-wasm";
import { autoRespond } from "../../autoBot.ts";
import type { CardDb } from "../../cardData.ts";
import type { FieldSnapshot } from "../../DuelSession.ts";
import { AiSeat, type AiView } from "../AiSeat.ts";
import { evaluate } from "../board.ts";
import { createGenericBrain } from "../generic/index.ts";
import { SELECT_HINT } from "../generic/select.ts";
import { formatTrace } from "../trace.ts";
import { findSame, idleList, type CardOption } from "./options.ts";
import type { Simulator } from "./simulator.ts";
import { layoutFrom } from "./world.ts";

/** One move at a main-phase or battle prompt. Zones are the copy's (the same as the real board's). */
export type PlanStep =
  /** A main-phase action with a card, or going to the battle / end phase (no card). */
  | { kind: "idle"; action: SelectIdleCMDAction; card?: CardOption }
  /** An attack: `target` is the zone of the opponent's monster, null = a direct attack. */
  | { kind: "attack"; attacker: CardOption; target: number | null }
  /** Leaving the battle phase. */
  | { kind: "battle"; action: SelectBattleCMDAction.TO_M2 | SelectBattleCMDAction.TO_EP };

export interface SequenceOptions {
  /** After the steps, end the turn and play the opponent's whole next turn before scoring. */
  opponentTurn?: boolean;
}

export interface SequenceResult {
  /** Steps carried out. Fewer than given: the copy didn't offer step `done` there (the plan doesn't work). */
  done: number;
  /** The board at the end, for the AI (±1000 if the duel ended there). */
  value: number;
  /** What the AI could do next where it stopped (empty after the opponent's turn or a finished duel). */
  next: PlanStep[];
}

type Prompt = OcgMessage & { player: number };
type IdleMessage = Extract<OcgMessage, { type: OcgMessageType.SELECT_IDLECMD }>;
type BattleMessage = Extract<OcgMessage, { type: OcgMessageType.SELECT_BATTLECMD }>;

const MAX_PROMPTS = 1000;
const pass: OcgResponse = { type: OcgResponseType.SELECT_CHAIN, index: null };

/** Plays `steps` from the board in `view`; null if the copy failed. The AI is seat 0 in the copy. */
export function playSequence(sim: Simulator, view: AiView, steps: readonly PlanStep[], opts: SequenceOptions = {}): SequenceResult | null {
  const duel = sim.build(layoutFrom(view));
  try {
    const debug = sim.debugSink;
    const brain = () => createGenericBrain({ weights: sim.weights });
    const ai = new AiSeat({ seat: 0, brain: brain(), duel, onTrace: debug ? (e) => debug(`      (plan) ${formatTrace(e)}`) : undefined });
    const opp = opts.opponentTurn ? new AiSeat({ seat: 1, brain: brain(), duel }) : null;
    const score = () => evaluate({
      seat: 0, board: duel.snapshot(0), memory: ai.memory, cards: sim.cardDb, hint: null, rng: () => 0.5, deckList: null, weights: sim.weights,
    });
    let done = 0;
    /** Our turn is over (all steps done, opponentTurn): from here on both sides play on their own. */
    let finishing = false;
    /** The attack the last step declared waits for its target prompt. */
    let target: number | null | undefined;

    for (let n = 0; n < MAX_PROMPTS; n++) {
      const s = duel.advance();
      ai.observe(s.messages);
      opp?.observe(s.messages);
      if (s.ended) return { done, value: s.winner === 0 ? 1000 : s.winner === 1 ? -1000 : 0, next: [] };
      if (ai.memory.turn > 2) return { done, value: score(), next: [] }; // the opponent's turn is over
      const p = s.prompt as Prompt;

      if (p.player === 1) {
        // Stand-ins never respond during our moves; in their own turn they play with the generic brain.
        duel.respond(opp && finishing ? opp.decide(p) : p.type === OcgMessageType.SELECT_CHAIN && !p.forced ? pass : autoRespond(p, () => 0, sim.cardDb));
        continue;
      }
      if (p.type === OcgMessageType.SELECT_IDLECMD || p.type === OcgMessageType.SELECT_BATTLECMD) {
        if (finishing) { duel.respond(ai.decide(p)); continue; } // only reached if our turn didn't end (shouldn't)
        if (done < steps.length) {
          const r = responseFor(p, steps[done]);
          if (!r) return { done, value: score(), next: nextSteps(p, duel.snapshot(0)) };
          const step = steps[done++];
          target = step.kind === "attack" ? step.target : undefined;
          duel.respond(r);
          continue;
        }
        if (!opts.opponentTurn) return { done, value: score(), next: nextSteps(p, duel.snapshot(0)) };
        finishing = true;
        duel.respond(p.type === OcgMessageType.SELECT_IDLECMD
          ? { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null }
          : { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_EP, index: null });
        continue;
      }
      if (p.type === OcgMessageType.SELECT_CARD && target !== undefined && ai.memory.hint !== null && Number(ai.memory.hint) === SELECT_HINT.ATTACK_TARGET) {
        const i = p.selects.findIndex((c) => c.controller === 1 && c.sequence === target);
        target = undefined;
        if (i >= 0) { ai.memory.hint = null; duel.respond({ type: OcgResponseType.SELECT_CARD, indicies: [i] }); continue; }
      }
      // Our own chain windows: the plan has no responses in it; in their turn, our usual chain rule.
      if (p.type === OcgMessageType.SELECT_CHAIN && !p.forced && !finishing) { duel.respond(pass); continue; }
      duel.respond(ai.decide(p));
    }
    return null;
  } catch {
    return null;
  } finally {
    duel.destroy();
  }
}

/** The response that carries out `step` at this prompt, or null if the prompt doesn't offer it. */
function responseFor(p: IdleMessage | BattleMessage, step: PlanStep): OcgResponse | null {
  if (p.type === OcgMessageType.SELECT_IDLECMD) {
    if (step.kind !== "idle") return null;
    const idle = (index: number | null): OcgResponse => ({ type: OcgResponseType.SELECT_IDLECMD, action: step.action, index });
    if (step.action === SelectIdleCMDAction.TO_BP) return p.to_bp ? idle(null) : null;
    if (step.action === SelectIdleCMDAction.TO_EP) return p.to_ep ? idle(null) : null;
    const j = step.card ? findSame(idleList(p, step.action) ?? [], step.card) : -1;
    return j >= 0 ? idle(j) : null;
  }
  const battle = (action: SelectBattleCMDAction, index: number | null): OcgResponse => ({ type: OcgResponseType.SELECT_BATTLECMD, action, index });
  if (step.kind === "attack") {
    const j = p.attacks.findIndex((a) => a.code === step.attacker.code && a.sequence === step.attacker.sequence);
    return j >= 0 ? battle(SelectBattleCMDAction.SELECT_BATTLE, j) : null;
  }
  if (step.kind === "battle") {
    if (step.action === SelectBattleCMDAction.TO_M2) return p.to_m2 ? battle(step.action, null) : null;
    return p.to_ep ? battle(step.action, null) : null;
  }
  return null;
}

/** Every step the AI could take at this prompt (attacks: one per target, or direct). */
function nextSteps(p: IdleMessage | BattleMessage, board: FieldSnapshot): PlanStep[] {
  const steps: PlanStep[] = [];
  if (p.type === OcgMessageType.SELECT_IDLECMD) {
    for (const action of [SelectIdleCMDAction.SELECT_ACTIVATE, SelectIdleCMDAction.SELECT_SUMMON, SelectIdleCMDAction.SELECT_SPECIAL_SUMMON,
      SelectIdleCMDAction.SELECT_POS_CHANGE, SelectIdleCMDAction.SELECT_MONSTER_SET, SelectIdleCMDAction.SELECT_SPELL_SET])
      for (const card of idleList(p, action) ?? []) steps.push({ kind: "idle", action, card });
    if (p.to_bp) steps.push({ kind: "idle", action: SelectIdleCMDAction.TO_BP });
    if (p.to_ep) steps.push({ kind: "idle", action: SelectIdleCMDAction.TO_EP });
    return steps;
  }
  const theirs = board.players[1].monsters.map((c, zone) => (c ? zone : -1)).filter((z) => z >= 0);
  for (const a of p.attacks) {
    for (const zone of theirs) steps.push({ kind: "attack", attacker: a, target: zone });
    if (!theirs.length || a.can_direct) steps.push({ kind: "attack", attacker: a, target: null });
  }
  if (p.to_m2) steps.push({ kind: "battle", action: SelectBattleCMDAction.TO_M2 });
  if (p.to_ep) steps.push({ kind: "battle", action: SelectBattleCMDAction.TO_EP });
  return steps;
}

/** A step in words, for traces. */
export function describeStep(step: PlanStep, cards: CardDb): string {
  const name = (c?: CardOption) => (c ? cards.name(c.code) : "?");
  switch (step.kind) {
    case "idle":
      switch (step.action) {
        case SelectIdleCMDAction.TO_BP: return "battle phase";
        case SelectIdleCMDAction.TO_EP: return "end turn";
        case SelectIdleCMDAction.SELECT_ACTIVATE: return `activate ${name(step.card)}`;
        case SelectIdleCMDAction.SELECT_SUMMON: return `summon ${name(step.card)}`;
        case SelectIdleCMDAction.SELECT_SPECIAL_SUMMON: return `special summon ${name(step.card)}`;
        case SelectIdleCMDAction.SELECT_POS_CHANGE: return `change position of ${name(step.card)}`;
        default: return `set ${name(step.card)}`;
      }
    case "attack": return `${name(step.attacker)} attacks ${step.target === null ? "directly" : `zone ${step.target + 1}`}`;
    case "battle": return step.action === SelectBattleCMDAction.TO_M2 ? "main phase 2" : "end turn";
  }
}
