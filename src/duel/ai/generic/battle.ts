// Battle phase. Each SELECT_BATTLECMD picks one attack: the most valuable opposing monster some attacker can destroy,
// taken by the weakest attacker that still does it (the stronger ones stay free for bigger targets). Direct attacks
// when their field is empty. Never an attack that loses, unless the attacks left this turn are lethal (an even trade
// that opens the way for a direct attack). The chosen target is remembered for the target prompt.
import {
  OcgMessageType,
  OcgResponseType,
  SelectBattleCMDAction,
  type OcgCardLoc,
  type OcgMessage,
} from "ocgcore-wasm";
import type { CardView } from "../../engine/DuelSession.ts";
import type { AiView, Decision } from "../AiSeat.ts";
import { WALL_DEF, cardAt, damageCost, mine, monsterStats, monsterValue, theirs, weightsOf } from "../board.ts";
import { attackKey, best, sameLoc, type BrainState, type Option } from "./common.ts";

type BattleMessage = Extract<OcgMessage, { type: OcgMessageType.SELECT_BATTLECMD }>;

/** What attacking `target` with `atk` gains (positive) or loses, in cards. */
export function attackValue(view: AiView, attacker: CardView, target: CardView): number {
  const atk = attacker.attack;
  const opp = theirs(view);
  const t = monsterStats(target);
  const theirValue = monsterValue(view, target);
  const ourValue = monsterValue(view, attacker);
  if (t.attackPos && t.known) {
    if (atk > t.atk) return theirValue + damageCost(opp.lp, atk - t.atk, weightsOf(view));
    if (atk === t.atk) return theirValue - ourValue;
    return -ourValue - 1; // our monster dies and we take damage
  }
  // Defense position (or an unknown face-down monster, guessed DEF).
  const sure = t.known ? 1 : 0.8;
  if (atk > t.def) return theirValue * sure;
  return t.known ? -0.5 : -0.3; // bounces off: damage to us, maybe a flip effect
}

/** One attacker of this battle phase and where it goes: an opposing monster, or direct (null). */
interface Assignment { attacker: number; target: CardView | null }

/**
 * Attacks that win the duel this battle phase, the ones clearing the field first, or null. Every opposing monster
 * must be known; each is destroyed in battle (ATK at least its ATK in Attack Position, an even trade included, or
 * above its DEF in Defense Position), unless every direct attack can go over it (`can_direct`); damage = direct
 * attacks + what Attack Position kills go through by. Set Spells/Traps don't stop it (they might, but we try).
 */
export function lethalAttacks(
  view: AiView, attackers: { card: CardView; direct: boolean }[], targets: CardView[],
  blocked: (attacker: number, target: CardView) => boolean = () => false,
): Assignment[] | null {
  if (targets.some((t) => !monsterStats(t).known)) return null;
  const lp = theirs(view).lp;
  const plan: Assignment[] = [];
  // Each attacker (at most 5) to a standing target, direct, or not attacking.
  const search = (i: number, standing: CardView[], damage: number): Assignment[] | null => {
    if (i === attackers.length) {
      const direct = plan.filter((p) => !p.target);
      const ok = damage >= lp && (standing.length === 0 || direct.every((p) => attackers[p.attacker].direct));
      return ok ? [...plan.filter((p) => p.target), ...direct] : null;
    }
    const atk = attackers[i].card.attack;
    for (const t of standing) {
      const st = monsterStats(t);
      if ((st.attackPos ? atk < st.atk : atk <= st.def) || blocked(i, t)) continue;
      plan.push({ attacker: i, target: t });
      const r = search(i + 1, standing.filter((x) => x !== t), damage + (st.attackPos ? atk - st.atk : 0));
      plan.pop();
      if (r) return r;
    }
    plan.push({ attacker: i, target: null });
    const r = search(i + 1, standing, damage + atk);
    plan.pop();
    return r ?? search(i + 1, standing, damage);
  };
  return search(0, targets, 0);
}

export function decideBattle(m: BattleMessage, view: AiView, state: BrainState): Decision {
  const opp = theirs(view);
  const name = (code: number) => view.cards.name(code);
  const targets = opp.monsters.filter((c): c is CardView => c !== null);
  const options: Option[] = [];
  /** The target each attack option is planned against. */
  const planned = new Map<Option, CardView>();
  const end = m.to_m2
    ? { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_M2, index: null } as const
    : { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_EP, index: null } as const;
  options.push({ label: m.to_m2 ? "go to main phase 2" : "end turn", score: 0, response: end });

  const attackers = m.attacks
    .map((a, index) => ({ a, index, card: cardAt(view, a) }))
    .filter((x): x is { a: (typeof m.attacks)[number]; index: number; card: CardView } => x.card !== null);
  const attack = (index: number) => ({ type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index }) as const;

  // Attacks the target prompt refused earlier this turn.
  const blocked = (x: { a: { sequence: number } }, t: CardView) => state.blockedAttacks.has(attackKey(x.a.sequence, t.sequence));
  const lethal = lethalAttacks(view, attackers.map((x) => ({ card: x.card, direct: !!x.a.can_direct })), targets, (i, t) => blocked(attackers[i], t));
  if (lethal?.length) {
    const { attacker, target } = lethal[0];
    const x = attackers[attacker];
    state.attackTarget = target ? { controller: target.controller, location: target.location, sequence: target.sequence } : null;
    const label = `${name(x.a.code)} attacks ${target ? name(target.code) : "directly"} (lethal)`;
    return best([...options, { label, score: 1000, response: attack(x.index) }], () => "the attacks left are lethal");
  }

  if (!targets.length) {
    // Empty field: everything goes direct, strongest first.
    for (const x of attackers)
      options.push({ label: `${name(x.a.code)} attacks directly`, score: 1 + x.card.attack / 1000, response: attack(x.index) });
  } else {
    for (const t of targets) {
      if (!monsterStats(t).known) {
        // An unknown face-down monster, often a wall: probe it with the weakest attacker above WALL_DEF, else
        // the strongest one; not when bouncing off a wall would cost the duel.
        const sorted = attackers.filter((s) => !blocked(s, t)).sort((p, q) => p.card.attack - q.card.attack);
        const x = sorted.find((s) => s.card.attack > WALL_DEF) ?? sorted[sorted.length - 1];
        const v = x ? attackValue(view, x.card, t) : 0;
        if (!x || v <= 0.05 || mine(view).lp <= WALL_DEF - x.card.attack) continue;
        const option = { label: `${name(x.a.code)} attacks a face-down monster`, score: v, response: attack(x.index) };
        options.push(option);
        planned.set(option, t);
        continue;
      }
      // The weakest attacker that destroys it (by value, then ATK) gets this target.
      const scored = attackers.filter((x) => !blocked(x, t)).map((x) => ({ x, v: attackValue(view, x.card, t) })).filter((s) => s.v > 0.05);
      if (!scored.length) continue;
      scored.sort((p, q) => p.x.card.attack - q.x.card.attack);
      const { x, v } = scored[0];
      const option = { label: `${name(x.a.code)} attacks ${t.code ? name(t.code) : "a face-down monster"}`, score: v, response: attack(x.index) };
      options.push(option);
      planned.set(option, t);
    }
    // Attackers allowed to go direct over monsters (rare effects).
    for (const x of attackers.filter((x) => x.a.can_direct))
      options.push({ label: `${name(x.a.code)} attacks directly`, score: damageCost(opp.lp, x.card.attack, weightsOf(view)), response: attack(x.index) });
  }

  const top = options.reduce((a, b) => (b.score > a.score ? b : a));
  // Remember which target this attack is for: the engine asks for it next.
  const target = planned.get(top);
  state.attackTarget = target ? { controller: target.controller, location: target.location, sequence: target.sequence } : null;
  return best(options, (o) => (o.score > 0 ? "best attack" : "no attack worth making"));
}

/**
 * The attack-target prompt: the planned target if it's offered. If not (an effect keeps it from being attacked, e.g.
 * Soul-Absorbing Bone Tower next to another Zombie), the attack is remembered as blocked for this turn and the best
 * offered target for this attacker is taken, if attacking it gains anything; else the attack is cancelled (null).
 */
export function pickAttackTarget(selects: OcgCardLoc[], canCancel: boolean, view: AiView, state: BrainState): number | null {
  const planned = state.attackTarget;
  const attacker = state.attacker ? cardAt(view, state.attacker) : null;
  state.attackTarget = null;
  if (planned) {
    const i = selects.findIndex((s) => sameLoc(s, planned));
    if (i >= 0) return i;
    if (state.attacker) state.blockedAttacks.add(attackKey(state.attacker.sequence, planned.sequence));
  }
  let bestI = 0, bestV = -Infinity;
  selects.forEach((s, i) => {
    const c = cardAt(view, s);
    // Without a known attacker (e.g. a replay after the target changed): the most valuable target we can see.
    const v = !c ? 0 : attacker ? attackValue(view, attacker, c) : monsterValue(view, c) - (c.code ? c.attack : 0) / 2000;
    if (v > bestV) { bestV = v; bestI = i; }
  });
  return attacker && bestV <= 0.05 && canCancel ? null : bestI;
}
