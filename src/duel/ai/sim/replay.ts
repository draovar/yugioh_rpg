// Chain responses by replay (M3). A chain prompt answers something the opponent just did; an open chain or an attack
// in progress can't be laid out directly, so the copy replays it: the opponent moves first in the copy and repeats the
// action (declares the same attack, summons the same monster, activates the same card, or just goes to the same
// phase), the AI answers with one candidate (or passes) at the first matching window, and the copy plays on to the end
// of the opponent's turn (their monsters still attack; that's where Book of Moon or Solemn on a summon pays off), the
// opponent with the generic brain, the AI with its usual chain rule after the action. Then the board is scored.
// One copy per answer; the best one wins if it beats passing.
//
// Mostly the opponent's turn: in ours, only a chain link of theirs (scored as soon as it has resolved). Everything the copy doesn't know stays a stand-in (world.ts), so the
// replay never uses hidden information: the opponent's face-down cards and hand never respond.
import {
  OcgLocation,
  OcgMessageType,
  OcgPhase,
  OcgPosition,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
  type OcgCardLocPosActive,
  type OcgMessage,
  type OcgResponse,
} from "ocgcore-wasm";
import { autoRespond, pickTributes } from "../../autoBot.ts";
import type { Deck, StartCard } from "../../DuelSession.ts";
import { AiSeat, type AiView } from "../AiSeat.ts";
import { evaluate, tributesFor } from "../board.ts";
import { createGenericBrain } from "../generic/index.ts";
import { SELECT_HINT } from "../generic/select.ts";
import { formatTrace } from "../trace.ts";
import { findSame } from "./options.ts";
import type { Simulator } from "./simulator.ts";
import { BLANK, layoutFrom, type SimLayout } from "./world.ts";

/** What the opponent did that the chain prompt answers. Zones are sequences on their side (targets: on ours). */
export type Situation =
  | { kind: "attack"; attacker: number; target: number | null }
  | { kind: "summon"; how: "summon" | "flip summon" | "special summon"; code: number; zone: number }
  /** ourTurn: their chain link in our turn (e.g. Just Desserts answering our Axe): scored once their chain is over. */
  | { kind: "activate"; code: number; location: number; sequence: number; ourTurn?: boolean }
  | { kind: "phase"; phase: number };

export interface ResponseOutcome {
  /** Index into the real prompt's `selects`; null = pass. */
  index: number | null;
  /** The board once the opponent's action is over, from the AI's side. */
  value: number;
}

type ChainMessage = Extract<OcgMessage, { type: OcgMessageType.SELECT_CHAIN }>;
type Prompt = OcgMessage & { player: number };

const BATTLE = 0xf8;
const MAX_STEPS = 800;

/** The opponent's action this chain prompt answers, as far as the copy can replay it (their turn; in ours, their chain link). */
export function situationOf(view: AiView): Situation | null {
  const { memory } = view;
  const opp = 1 - view.seat;
  const top = memory.chain[memory.chain.length - 1];
  if (memory.turnPlayer !== opp) {
    // In our turn only a chain link of theirs on top of our own: what's below it isn't in the copy, so this works
    // for links that don't depend on it (free-chain cards); others aren't offered in the copy and fall back.
    if (!top || top.controller !== opp) return null;
    return { kind: "activate", code: top.code, location: top.place.location, sequence: top.place.sequence, ourTurn: true };
  }
  if (top) {
    if (top.controller !== opp) return null;
    return { kind: "activate", code: top.code, location: top.place.location, sequence: top.place.sequence };
  }
  const last = memory.lastAction;
  if (last?.player === opp && last.kind === "attack" && memory.attacks.length) {
    const a = memory.attacks[memory.attacks.length - 1];
    return { kind: "attack", attacker: a.attacker.sequence, target: a.target ? a.target.sequence : null };
  }
  if (last?.player === opp && last.kind !== "activate" && last.kind !== "attack" && last.place?.location === OcgLocation.MZONE)
    return { kind: "summon", how: last.kind, code: last.code, zone: last.place.sequence };
  return { kind: "phase", phase: memory.phase };
}

/** The outcome of passing and of each candidate the copy could play; null if the copy can't replay the situation. */
export function replayResponses(sim: Simulator, view: AiView, prompt: ChainMessage, situation: Situation): ResponseOutcome[] | null {
  const ourTurn = situation.kind === "activate" && situation.ourTurn;
  const layout = ourTurn ? theirLinkInOurTurn(view, situation) : opponentFirst(view, situation);
  if (!layout) return null;
  const one = (c: OcgCardLocPosActive | null) => ourTurn ? replayLink(sim, layout, situation, c) : replayOne(sim, view, layout, situation, c);
  const pass = one(null);
  if (pass === null) return null;
  const outcomes: ResponseOutcome[] = [{ index: null, value: pass }];
  prompt.selects.forEach((c, i) => {
    const value = one(c);
    if (value !== null) outcomes.push({ index: i, value });
  });
  return outcomes;
}

/** Their chain link in our turn: our board as usual (we move first), their card set again so they can activate it. */
function theirLinkInOurTurn(view: AiView, situation: Situation & { kind: "activate" }): SimLayout | null {
  if (situation.location !== OcgLocation.SZONE) return null;
  const base = layoutFrom(view);
  const start = [...(base.decks[1].start ?? [])];
  const i = start.findIndex((s) => s.location === OcgLocation.SZONE && s.sequence === situation.sequence);
  if (i < 0) return null;
  start[i] = { ...start[i], code: situation.code, position: OcgPosition.FACEDOWN_DEFENSE };
  return { decks: [base.decks[0], { ...base.decks[1], start }], lp: base.lp };
}

/**
 * Replays their chain link in our turn: they activate it at the first chain window they get (our Standby Phase in the
 * copy), we answer with `candidate` (or pass), and the board is scored once that chain has resolved: the rest of the
 * turn is ours to play, not part of the comparison. Null if the copy never got there.
 */
function replayLink(sim: Simulator, layout: SimLayout, situation: Situation & { kind: "activate" }, candidate: OcgCardLocPosActive | null): number | null {
  const duel = sim.build(layout);
  try {
    const debug = sim.debugSink;
    const ai = new AiSeat({ seat: 0, brain: createGenericBrain({ weights: sim.weights }), duel, onTrace: debug ? (e) => debug(`      (replay) ${formatTrace(e)}`) : undefined });
    let done = false, used = false;
    for (let steps = 0; steps < MAX_STEPS; steps++) {
      const s = duel.advance();
      ai.observe(s.messages);
      for (const m of s.messages) {
        if (!done) done = m.type === OcgMessageType.CHAINING && m.controller === 1 && m.code === situation.code;
        else if (m.type === OcgMessageType.CHAIN_END) {
          if (candidate && !used) return null;
          const value = evaluate({ seat: 0, board: duel.snapshot(0), memory: ai.memory, cards: sim.cardDb, hint: null, rng: () => 0.5, deckList: null, weights: sim.weights });
          debug?.(`      (replay) their link in our turn: ${candidate ? sim.cardDb.name(candidate.code) : "pass"} -> ${value.toFixed(2)}`);
          return value;
        }
      }
      if (s.ended) return s.winner === 0 ? 1000 : s.winner === 1 ? -1000 : 0;
      const p = s.prompt as Prompt;
      if (p.player === 1) {
        if (p.type === OcgMessageType.SELECT_CHAIN && !p.forced) {
          const j = done ? -1 : p.selects.findIndex((c) => c.code === situation.code);
          duel.respond({ type: OcgResponseType.SELECT_CHAIN, index: j >= 0 ? j : null });
        } else duel.respond(autoRespond(p, () => 0, sim.cardDb));
        continue;
      }
      if (p.type === OcgMessageType.SELECT_IDLECMD || p.type === OcgMessageType.SELECT_BATTLECMD) return null; // no window came
      if (p.type === OcgMessageType.SELECT_CHAIN && !p.forced) {
        const j = candidate && done && !used ? findSame(p.selects, candidate) : -1;
        if (j >= 0) used = true;
        duel.respond({ type: OcgResponseType.SELECT_CHAIN, index: j >= 0 ? j : null });
        continue;
      }
      duel.respond(ai.decide(p));
    }
    return null;
  } catch {
    return null;
  } finally {
    duel.destroy();
  }
}

/** The board with the opponent as team 0, set up so they can repeat the action. Null if it can't be. */
function opponentFirst(view: AiView, situation: Situation): SimLayout | null {
  const base = layoutFrom(view);
  const theirs: Deck = { ...base.decks[1], start: [...(base.decks[1].start ?? [])] };
  const start = theirs.start!;
  const at = (location: number, sequence: number) => start.findIndex((s) => s.location === location && s.sequence === sequence);
  if (situation.kind === "summon") {
    const i = at(OcgLocation.MZONE, situation.zone);
    if (i < 0 || start[i].code !== situation.code) return null;
    if (situation.how === "flip summon") {
      start[i] = { ...start[i], position: OcgPosition.FACEDOWN_DEFENSE };
    } else {
      // Back to the hand, with stand-in monsters to tribute for it.
      start.splice(i, 1);
      replaceBlankInHand(start, situation.code);
      const used = new Set(start.filter((s) => s.location === OcgLocation.MZONE).map((s) => s.sequence));
      let need = tributesFor(view, situation.code);
      for (let z = 0; z < 5 && need > 0; z++) {
        if (used.has(z)) continue;
        start.push({ code: BLANK.MONSTER, location: OcgLocation.MZONE, sequence: z, position: OcgPosition.FACEUP_ATTACK });
        need--;
      }
      if (need > 0) return null;
    }
  } else if (situation.kind === "activate") {
    if (situation.location === OcgLocation.SZONE) {
      // Being activated now: set it again so it can be activated in the copy.
      const i = at(OcgLocation.SZONE, situation.sequence);
      if (i < 0) return null;
      start[i] = { ...start[i], code: situation.code, position: OcgPosition.FACEDOWN_DEFENSE };
    } else if (situation.location === OcgLocation.HAND) {
      replaceBlankInHand(start, situation.code);
    }
  }
  return { decks: [theirs, base.decks[0]], lp: [base.lp[1], base.lp[0]] };
}

function replaceBlankInHand(start: StartCard[], code: number): void {
  const i = start.findIndex((s) => s.location === OcgLocation.HAND && s.code === BLANK.CARD);
  if (i >= 0) start[i] = { ...start[i], code };
  else start.push({ code, location: OcgLocation.HAND, sequence: start.length, position: OcgPosition.FACEDOWN_DEFENSE });
}

/**
 * Replays the situation once, the AI answering with `candidate` at the first window during the action that offers it
 * (null: passing there), then plays on to the end of the opponent's turn. Returns the board value for the AI then, or
 * null if the copy couldn't replay it (or never offered the candidate during the action).
 */
function replayOne(sim: Simulator, view: AiView, layout: SimLayout, situation: Situation, candidate: OcgCardLocPosActive | null): number | null {
  const duel = sim.build(layout);
  try {
    const debug = sim.debugSink;
    // In the copy the opponent is seat 0 and the AI seat 1.
    const opp = new AiSeat({ seat: 0, brain: createGenericBrain({ weights: sim.weights }), duel });
    const ai = new AiSeat({ seat: 1, brain: createGenericBrain({ weights: sim.weights }), duel, onTrace: debug ? (e) => debug(`      (replay) ${formatTrace(e)}`) : undefined });
    const realPhase = view.memory.phase;
    // done: the opponent has started the action; over: it has finished (their next main/battle prompt, or the phase
    // has moved on). The candidate may only be used in between.
    let done = false, over = false, used = false;

    for (let steps = 0; ; steps++) {
      if (steps > MAX_STEPS) return null;
      const s = duel.advance();
      opp.observe(s.messages);
      ai.observe(s.messages);
      for (const m of s.messages) if (!done) done = actionHappened(m, situation, opp.memory.phase, opp.memory.turnPlayer);
      if (s.ended) return s.winner === 1 ? 1000 : s.winner === 0 ? -1000 : 0;
      if (ai.memory.turn > 1) break; // the opponent's turn is over
      const p = s.prompt as Prompt;
      if (done && !over && situation.kind === "phase" && opp.memory.phase !== situation.phase) over = true;
      if (p.player === 0) {
        if (done && !over && (p.type === OcgMessageType.SELECT_IDLECMD || p.type === OcgMessageType.SELECT_BATTLECMD)) over = true;
        if (over && candidate && !used) return null; // never offered during the action
        // Scripted until the action has started; then they play on with the generic brain.
        const scripted = done ? null : opponentMove(p, situation, opp);
        if (scripted === "abort") return null;
        duel.respond(scripted ?? opp.decide(p));
      } else {
        if (p.type === OcgMessageType.SELECT_IDLECMD || p.type === OcgMessageType.SELECT_BATTLECMD) break;
        if (p.type !== OcgMessageType.SELECT_CHAIN || p.forced) { duel.respond(ai.decide(p)); continue; }
        const during = done && !over;
        const phaseOk = situation.kind === "summon" || situation.kind === "activate" || ai.memory.phase === realPhase;
        const j = candidate && !used && during && phaseOk ? findSame(p.selects, candidate) : -1;
        if (j >= 0) { used = true; duel.respond({ type: OcgResponseType.SELECT_CHAIN, index: j }); continue; }
        // Up to and during the action only the candidate; afterwards the usual chain rule (both branches alike).
        duel.respond(done && over ? ai.decide(p) : pass());
      }
    }
    if (!done || (candidate && !used)) return null;
    const value = evaluate({ seat: 1, board: duel.snapshot(1), memory: ai.memory, cards: sim.cardDb, hint: null, rng: () => 0.5, deckList: null, weights: sim.weights });
    debug?.(`      (replay) ${situation.kind}: ${candidate ? sim.cardDb.name(candidate.code) : "pass"} -> ${value.toFixed(2)}`);
    return value;
  } catch {
    return null;
  } finally {
    duel.destroy();
  }
}

const pass = (): OcgResponse => ({ type: OcgResponseType.SELECT_CHAIN, index: null });

/** Whether `m` is the opponent (seat 0 in the copy) carrying out the replayed action. */
function actionHappened(m: OcgMessage, situation: Situation, phase: number, turnPlayer: number): boolean {
  switch (situation.kind) {
    case "attack": return m.type === OcgMessageType.ATTACK && m.card.controller === 0 && m.card.sequence === situation.attacker;
    case "summon":
      return (m.type === OcgMessageType.SUMMONING || m.type === OcgMessageType.FLIPSUMMONING || m.type === OcgMessageType.SPSUMMONING)
        && m.controller === 0 && m.code === situation.code;
    case "activate": return m.type === OcgMessageType.CHAINING && m.controller === 0 && m.code === situation.code;
    case "phase":
      return turnPlayer === 0 && ((m.type === OcgMessageType.NEW_PHASE && m.phase === situation.phase) || (phase === situation.phase));
  }
}

/** The opponent's scripted moves in the copy: whatever repeats the action. Null = let its brain answer. */
function opponentMove(p: Prompt, situation: Situation, opp: AiSeat): OcgResponse | "abort" | null {
  const idle = (action: SelectIdleCMDAction, index: number | null = null): OcgResponse => ({ type: OcgResponseType.SELECT_IDLECMD, action, index });
  const battle = (action: SelectBattleCMDAction, index: number | null = null): OcgResponse => ({ type: OcgResponseType.SELECT_BATTLECMD, action, index });
  if (p.type === OcgMessageType.SELECT_IDLECMD) {
    switch (situation.kind) {
      case "attack": return p.to_bp ? idle(SelectIdleCMDAction.TO_BP) : "abort";
      case "summon": {
        if (situation.how === "flip summon") {
          const i = p.pos_changes.findIndex((c) => c.code === situation.code && c.sequence === situation.zone);
          return i >= 0 ? idle(SelectIdleCMDAction.SELECT_POS_CHANGE, i) : "abort";
        }
        const i = p.summons.findIndex((c) => c.code === situation.code);
        return i >= 0 ? idle(SelectIdleCMDAction.SELECT_SUMMON, i) : "abort";
      }
      case "activate": {
        const i = p.activates.findIndex((c) => c.code === situation.code);
        return i >= 0 ? idle(SelectIdleCMDAction.SELECT_ACTIVATE, i) : "abort";
      }
      case "phase":
        if (situation.phase & BATTLE || situation.phase === OcgPhase.MAIN2) return p.to_bp ? idle(SelectIdleCMDAction.TO_BP) : "abort";
        return idle(SelectIdleCMDAction.TO_EP);
    }
  }
  if (p.type === OcgMessageType.SELECT_BATTLECMD) {
    if (situation.kind === "attack") {
      const i = p.attacks.findIndex((a) => a.sequence === situation.attacker);
      return i >= 0 ? battle(SelectBattleCMDAction.SELECT_BATTLE, i) : "abort";
    }
    if (situation.kind === "phase" && situation.phase === OcgPhase.MAIN2) return p.to_m2 ? battle(SelectBattleCMDAction.TO_M2) : "abort";
    return battle(SelectBattleCMDAction.TO_EP);
  }
  if (p.type === OcgMessageType.SELECT_CARD && situation.kind === "attack" && opp.memory.hint !== null && Number(opp.memory.hint) === SELECT_HINT.ATTACK_TARGET) {
    const i = p.selects.findIndex((c) => c.controller === 1 && c.sequence === situation.target);
    return { type: OcgResponseType.SELECT_CARD, indicies: [i >= 0 ? i : 0] };
  }
  if (p.type === OcgMessageType.SELECT_CHAIN && !p.forced) return pass(); // stand-ins never respond
  if (p.type === OcgMessageType.SELECT_TRIBUTE) {
    // Tribute the stand-ins put there for it.
    const order = p.selects.map((c, i) => ({ i, blank: c.code === BLANK.MONSTER })).sort((a, b) => Number(b.blank) - Number(a.blank));
    return { type: OcgResponseType.SELECT_TRIBUTE, indicies: pickTributes(p.selects, order.map((x) => x.i), p.min) };
  }
  return null;
}
