// The generic brain: plays any deck from card data alone (types, ATK/DEF, levels), the engine's legality and timing
// signals, and the selection hints (M1). With a Simulator (the planner) it plans whole turns on copies of the board,
// answers the opponent's moves by replaying them there, and judges single main-phase activations there when no plan
// can be made.
import { OcgMessageType, OcgResponseType, type OcgMessage } from "ocgcore-wasm";
import { autoRespond, pickSum, pickTributes } from "../../autoBot.ts";
import type { AiView, Brain, Decision } from "../AiSeat.ts";
import { pickAttackTarget, decideBattle } from "./battle.ts";
import { decideChain } from "./chain.ts";
import { BrainState } from "./common.ts";
import { decideIdle } from "./idle.ts";
import { decideByPlan } from "./plan.ts";
import { decideAnnounceBits, decideAnnounceCard, decidePosition } from "./misc.ts";
import { SELECT_HINT, chooseCards, pickUtility, purposeIn } from "./select.ts";
import type { Simulator } from "../sim/simulator.ts";
import { valueAt, type Weights } from "../board.ts";

export interface GenericBrainOptions {
  /** Copies of the board to plan turns and replay the opponent's moves in; none = card data alone. */
  simulator?: Simulator;
  /** How it values things (board.ts); default DEFAULT_WEIGHTS. */
  weights?: Readonly<Weights>;
  name?: string;
}

export function createGenericBrain(opts: GenericBrainOptions = {}): Brain {
  const state = new BrainState(opts.simulator ?? null);
  const weights = opts.weights;
  return {
    name: opts.name ?? "generic",
    decide(prompt: OcgMessage, view: AiView): Decision {
      state.sync(view.memory.turn);
      return decide(prompt, weights ? { ...view, weights } : view, state);
    },
    idle: () => state.simulator?.prepareOne() ?? false,
    dispose: () => state.simulator?.dispose(),
  };
}

function decide(m: OcgMessage, view: AiView, state: BrainState): Decision {
  switch (m.type) {
    case OcgMessageType.SELECT_IDLECMD:
      return decideByPlan(m, view, state) ?? decideIdle(m, view, state);
    case OcgMessageType.SELECT_BATTLECMD:
      return decideByPlan(m, view, state) ?? decideBattle(m, view, state);
    case OcgMessageType.SELECT_CHAIN:
      return decideChain(m, view, state);
    case OcgMessageType.SELECT_CARD: {
      if (view.hint !== null && Number(view.hint) === SELECT_HINT.ATTACK_TARGET)
        return { response: { type: OcgResponseType.SELECT_CARD, indicies: [pickAttackTarget(m.selects, view, state)] }, reason: "planned attack target" };
      const purpose = purposeIn(view);
      // Something bad that could only hit our own cards (e.g. Breaker with no opposing Spell/Trap): back out.
      if (purpose === "bad" && m.can_cancel && !m.selects.some((c) => pickUtility(view, c, purpose) > 0)) {
        if (state.lastActivation) state.activations.set(state.lastActivation, 10);
        return { response: { type: OcgResponseType.SELECT_CARD, indicies: null }, reason: "only our own cards to hit: cancel" };
      }
      return { response: { type: OcgResponseType.SELECT_CARD, indicies: chooseCards(view, m.selects, m.min, m.max, purpose) }, reason: `${purpose} for the card's owner` };
    }
    case OcgMessageType.SELECT_TRIBUTE: {
      // Tribute the least valuable, as many as it takes (`min` counts tributes; Double Tribute monsters count 2).
      const indicies = pickTributes(m.selects, chooseCards(view, m.selects, m.selects.length, m.selects.length, "neutral"), m.min);
      return { response: { type: OcgResponseType.SELECT_TRIBUTE, indicies }, reason: "least valuable monsters" };
    }
    case OcgMessageType.SELECT_UNSELECT_CARD: {
      // One card per prompt: take the next card of the set we'd pick in one go, finish once it's complete.
      const purpose = purposeIn(view);
      const all = [...m.select_cards, ...m.unselect_cards];
      const picked = m.unselect_cards.length;
      const wanted = new Set(chooseCards(view, all, Math.max(m.min, picked), m.max, purpose));
      const next = m.select_cards.findIndex((_, i) => wanted.has(i));
      if (next >= 0 && !(m.can_finish && picked >= m.max)) return { response: { type: OcgResponseType.SELECT_UNSELECT_CARD, index: next }, reason: `${purpose}: next card` };
      if (m.can_finish || !m.select_cards.length) return { response: { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null }, reason: "done" };
      // Must pick more: the best remaining one.
      let bestI = 0;
      m.select_cards.forEach((c, i) => { if (pickUtility(view, c, purpose) > pickUtility(view, m.select_cards[bestI], purpose)) bestI = i; });
      return { response: { type: OcgResponseType.SELECT_UNSELECT_CARD, index: bestI }, reason: "must pick more" };
    }
    case OcgMessageType.SELECT_SUM: {
      // Ritual tributes and the like: the cheapest set that adds up.
      const atLeast = m.select_max !== 0;
      const picked = pickSum(m.selects_must.map((c) => c.amount), m.selects.map((c) => c.amount), m.amount, atLeast,
        atLeast ? 0 : m.min, atLeast ? Infinity : m.max, (i) => valueAt(view, m.selects[i]));
      if (picked) return { response: { type: OcgResponseType.SELECT_SUM, indicies: picked }, reason: "the least valuable cards that add up" };
      return { response: autoRespond(m, view.rng, view.cards), reason: "default answer" };
    }
    case OcgMessageType.SELECT_EFFECTYN:
      return { response: { type: OcgResponseType.SELECT_EFFECTYN, yes: true }, reason: "optional effects are usually worth it" };
    case OcgMessageType.SELECT_YESNO:
      return { response: { type: OcgResponseType.SELECT_YESNO, yes: true }, reason: "default yes" };
    case OcgMessageType.SELECT_POSITION:
      return decidePosition(m, view, state.simulator ? () => state.simulator!.canAttackThisTurn(view) : undefined);
    case OcgMessageType.ANNOUNCE_CARD:
      return decideAnnounceCard(m, view);
    case OcgMessageType.ANNOUNCE_ATTRIB:
    case OcgMessageType.ANNOUNCE_RACE:
      return decideAnnounceBits(m, view);
    default:
      // Zones, options, sums, counters, numbers, sorting, rock-paper-scissors: the first legal answer for now.
      return { response: autoRespond(m, view.rng, view.cards), reason: "default answer" };
  }
}
