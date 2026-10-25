// Main phase (SELECT_IDLECMD): score every action the engine offers, take the best one worth doing, otherwise move on
// to the battle phase (when there's something to attack with) or end the turn. Called once per action.
import {
  OcgLocation,
  OcgMessageType,
  OcgPhase,
  OcgPosition,
  OcgResponseType,
  SelectIdleCMDAction,
  type OcgMessage,
} from "ocgcore-wasm";
import { TYPE } from "../../engine/cardData.ts";
import type { AiView, Decision } from "../AiSeat.ts";
import { bestAtk, cardAt, cardType, codeValue, mine, monsterStats, monsterValue, statValue, theirs, tributesFor, weightsOf } from "../board.ts";
import { best, type BrainState, type Option } from "./common.ts";

type IdleMessage = Extract<OcgMessage, { type: OcgMessageType.SELECT_IDLECMD }>;

/** More main-phase actions than this in one turn means something loops: end the turn. */
const MAX_IDLE_STEPS = 60;

const act = (action: SelectIdleCMDAction, index: number | null) =>
  ({ type: OcgResponseType.SELECT_IDLECMD, action, index }) as const;

export function decideIdle(m: IdleMessage, view: AiView, state: BrainState): Decision {
  const me = mine(view), opp = theirs(view);
  const name = (code: number) => view.cards.name(code);
  const inMain2 = view.memory.phase === OcgPhase.MAIN2;
  const theirBest = bestAtk(opp);
  const theyHaveMonsters = opp.monsters.some((c) => c);
  // Something of ours could attack this turn: then sets and defensive moves wait for Main Phase 2.
  const canAttackLater = m.to_bp && me.monsters.some((c) => c && !c.faceDown && (c.position & OcgPosition.FACEUP_ATTACK));
  const deferSets = !inMain2 && canAttackLater;
  const options: Option[] = [];

  if (++state.idleSteps > MAX_IDLE_STEPS)
    return { response: act(SelectIdleCMDAction.TO_EP, null), reason: "too many actions this turn" };

  const w = weightsOf(view);
  // Our monsters, cheapest first: what a tribute summon gives up (at full value: swapping a monster for an equal one
  // gains nothing).
  const fodder = me.monsters.filter((c) => c !== null).map((c) => monsterValue(view, c)).sort((a, b) => a - b);
  const tributeCost = (code: number) => fodder.slice(0, tributesFor(view, code)).reduce((s, v) => s + v, 0);
  /**
   * What the simulation shows beyond what the rules of thumb here assume (`expected`: the monster goes from hand to
   * field, the cheapest tributes go): a Monarch's effect hitting a card (or, with nothing else to hit, itself), a flip
   * effect, a trigger. 0 without a simulator or when the copy can't play it.
   */
  const surprise = (action: SelectIdleCMDAction, i: number, expected: number): { value: number; label: string } => {
    const sim = state.simulator?.idleAction(view, m, action, i) ?? null;
    if (!sim) return { value: 0, label: "" };
    const value = sim.delta - expected;
    return { value, label: Math.abs(value) >= 0.05 ? ` (sim ${value >= 0 ? "+" : ""}${value.toFixed(2)})` : "" };
  };
  const fromHand = (code: number, atk: number, def: number) => statValue(atk, def, w) - codeValue(view, code) - tributeCost(code);

  // Normal Summon (face-up attack): worth it when the monster survives their best attacker; a tribute summon only for
  // what it adds over its tributes.
  m.summons.forEach((c, i) => {
    const r = view.cards.records.get(c.code);
    if (!r) return;
    const survives = r.atk > theirBest;
    let score = (statValue(r.atk, r.def, w) - tributeCost(c.code)) * (survives ? 1.3 : 0.6);
    if (!survives) score -= (theirBest - r.atk) / 2000; // they'll run it over for damage
    if (r.type & TYPE.FLIP) score -= 1; // flip effects want to be set
    if (!theyHaveMonsters && !inMain2) score += 0.3; // a direct hit this turn
    const s = surprise(SelectIdleCMDAction.SELECT_SUMMON, i, fromHand(c.code, r.atk, r.def));
    options.push({ label: `summon ${name(c.code)}${s.label}`, score: score + s.value, response: act(SelectIdleCMDAction.SELECT_SUMMON, i) });
  });

  // Set a monster (face-down defense): a wall against stronger monsters, or a flip effect waiting.
  m.monster_sets.forEach((c, i) => {
    const r = view.cards.records.get(c.code);
    if (!r) return;
    let score = (0.4 + r.def / 1200) * (r.def > theirBest ? 1 : 0.6) - tributeCost(c.code);
    if (r.type & TYPE.FLIP) score += 1;
    if (deferSets) score = Math.min(score, -0.1);
    options.push({ label: `set ${name(c.code)}`, score, response: act(SelectIdleCMDAction.SELECT_MONSTER_SET, i) });
  });

  // Special Summons from the hand (no Normal Summon used): almost always good.
  m.special_summons.forEach((c, i) => {
    const r = view.cards.records.get(c.code);
    const score = r ? statValue(r.atk, r.def, w) * 1.3 + 0.5 : 1;
    const s = r ? surprise(SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, i, statValue(r.atk, r.def, w) - codeValue(view, c.code)) : { value: 0, label: "" };
    options.push({ label: `special summon ${name(c.code)}${s.label}`, score: score + s.value, response: act(SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, i) });
  });

  // Activations. Without card knowledge: spells and effects the engine allows are mostly worth using. But with nothing
  // of theirs on the field, quick-plays, traps and monster effects can only hit our own cards (MST, Breaker): wait.
  const theirField = opp.monsters.some((c) => c) || opp.spells.some((c) => c);
  m.activates.forEach((c, i) => {
    const key = `${c.code}:${c.description}`;
    const repeats = state.activations.get(key) ?? 0;
    // Simulated: the board change it really makes. Worth doing early when it gains (draws, removal before attacking).
    const sim = state.simulator?.activation(view, m, i) ?? null;
    if (sim) {
      const score = (sim.delta > weightsOf(view).activateMin ? 2 + sim.delta : sim.delta - 0.3) - repeats;
      const label = `activate ${name(c.code)} (sim ${sim.delta >= 0 ? "+" : ""}${sim.delta.toFixed(2)})`;
      options.push({ label, score, response: act(SelectIdleCMDAction.SELECT_ACTIVATE, i) });
      return;
    }
    const type = cardType(view, c.code);
    let score: number;
    if (type & TYPE.MONSTER) score = 1.8;
    else if (type & TYPE.TRAP) score = 0.8;
    else if (type & TYPE.EQUIP) score = 1.2; // after the summon, so there's a monster to equip
    else if (type & (TYPE.CONTINUOUS | TYPE.FIELD)) score = 1.5;
    else if (type & TYPE.QUICKPLAY) score = c.location === OcgLocation.HAND ? 1 : 0.9;
    else score = 2.6; // normal spells first: draws and removal before summoning and attacking
    if (!theirField && type & (TYPE.MONSTER | TYPE.TRAP | TYPE.QUICKPLAY)) score = -1;
    score -= repeats; // the same effect again and again: less and less
    options.push({ label: `activate ${name(c.code)}`, score, response: act(SelectIdleCMDAction.SELECT_ACTIVATE, i) });
  });

  // Set Spells/Traps: traps yes, quick-plays maybe, normal spells no (no bluffing yet).
  m.spell_sets.forEach((c, i) => {
    const type = cardType(view, c.code);
    let score = type & TYPE.TRAP ? 0.9 : type & TYPE.QUICKPLAY ? 0.5 : -0.5;
    if (deferSets) score = Math.min(score, -0.1);
    options.push({ label: `set ${name(c.code)}`, score, response: act(SelectIdleCMDAction.SELECT_SPELL_SET, i) });
  });

  // Position changes.
  m.pos_changes.forEach((c, i) => {
    const card = cardAt(view, c);
    if (!card) return;
    const { atk, def } = monsterStats(card);
    let score = -1;
    let label = "";
    if (card.faceDown) {
      // Flip summon: flip effects, or a monster that wins fights. The copy shows what the flip effect really does.
      if (cardType(view, c.code) & TYPE.FLIP) score = 1.5;
      else if (atk > theirBest && !inMain2) score = 1.2;
      const s = surprise(SelectIdleCMDAction.SELECT_POS_CHANGE, i, 0);
      if (s.label) { score = Math.max(score, 0.5) + s.value; label = s.label; }
    } else if (card.position & OcgPosition.FACEUP_DEFENSE) {
      if (atk > theirBest && !inMain2 && m.to_bp) score = 1.4; // go on the attack
    } else if (atk <= theirBest && def > atk && !deferSets) {
      score = 0.7; // can't win fights: brace in defense
    }
    options.push({ label: `change position of ${name(c.code)}${label}`, score, response: act(SelectIdleCMDAction.SELECT_POS_CHANGE, i) });
  });

  if (m.to_bp) options.push({ label: "go to battle phase", score: canAttackLater ? 0.3 : -1, response: act(SelectIdleCMDAction.TO_BP, null) });
  if (m.to_ep) options.push({ label: "end turn", score: 0, response: act(SelectIdleCMDAction.TO_EP, null) });

  const decision = best(options, (o) => (o.score > 0 ? "best scored action" : "nothing better to do"));
  const chosen = decision.response;
  if (chosen.type === OcgResponseType.SELECT_IDLECMD && chosen.action === SelectIdleCMDAction.SELECT_ACTIVATE) {
    const c = m.activates[chosen.index!];
    const key = `${c.code}:${c.description}`;
    state.activations.set(key, (state.activations.get(key) ?? 0) + 1);
    state.lastActivation = key;
  }
  return decision;
}
