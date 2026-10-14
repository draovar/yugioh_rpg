// Battle phase. Each SELECT_BATTLECMD picks one attack: the most valuable opposing monster some attacker can destroy,
// taken by the weakest attacker that still does it (the stronger ones stay free for bigger targets). Direct attacks
// when their field is empty. Never an attack that loses. The chosen target is remembered for the target prompt.
import {
  OcgMessageType,
  OcgResponseType,
  SelectBattleCMDAction,
  type OcgCardLoc,
  type OcgMessage,
} from "ocgcore-wasm";
import type { CardView } from "../../DuelSession.ts";
import type { AiView, Decision } from "../AiSeat.ts";
import { cardAt, damageCost, monsterStats, monsterValue, theirs } from "../board.ts";
import { best, sameLoc, type BrainState, type Option } from "./common.ts";

type BattleMessage = Extract<OcgMessage, { type: OcgMessageType.SELECT_BATTLECMD }>;

/** What attacking `target` with `atk` gains (positive) or loses, in cards. */
export function attackValue(view: AiView, attacker: CardView, target: CardView): number {
  const atk = attacker.attack;
  const opp = theirs(view);
  const t = monsterStats(target);
  const theirValue = monsterValue(view, target);
  const ourValue = monsterValue(view, attacker);
  if (t.attackPos && t.known) {
    if (atk > t.atk) return theirValue + damageCost(opp.lp, atk - t.atk);
    if (atk === t.atk) return theirValue - ourValue;
    return -ourValue - 1; // our monster dies and we take damage
  }
  // Defense position (or an unknown face-down monster, guessed DEF).
  const sure = t.known ? 1 : 0.8;
  if (atk > t.def) return theirValue * sure;
  return t.known ? -0.5 : -0.3; // bounces off: damage to us, maybe a flip effect
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

  if (!targets.length) {
    // Empty field: everything goes direct, strongest first.
    for (const x of attackers)
      options.push({ label: `${name(x.a.code)} attacks directly`, score: 1 + x.card.attack / 1000, response: attack(x.index) });
  } else {
    for (const t of targets) {
      // The weakest attacker that destroys it (by value, then ATK) gets this target.
      const scored = attackers.map((x) => ({ x, v: attackValue(view, x.card, t) })).filter((s) => s.v > 0.05);
      if (!scored.length) continue;
      scored.sort((p, q) => p.x.card.attack - q.x.card.attack);
      const { x, v } = scored[0];
      const option = { label: `${name(x.a.code)} attacks ${t.code ? name(t.code) : "a face-down monster"}`, score: v, response: attack(x.index) };
      options.push(option);
      planned.set(option, t);
    }
    // Attackers allowed to go direct over monsters (rare effects).
    for (const x of attackers.filter((x) => x.a.can_direct))
      options.push({ label: `${name(x.a.code)} attacks directly`, score: damageCost(opp.lp, x.card.attack), response: attack(x.index) });
  }

  const top = options.reduce((a, b) => (b.score > a.score ? b : a));
  // Remember which target this attack is for: the engine asks for it next.
  const target = planned.get(top);
  state.attackTarget = target ? { controller: target.controller, location: target.location, sequence: target.sequence } : null;
  return best(options, (o) => (o.score > 0 ? "best attack" : "no attack worth making"));
}

/** The attack-target prompt: the planned target if it's offered, else the best one for whoever is attacking. */
export function pickAttackTarget(selects: OcgCardLoc[], view: AiView, state: BrainState): number {
  const planned = state.attackTarget;
  state.attackTarget = null;
  if (planned) {
    const i = selects.findIndex((s) => sameLoc(s, planned));
    if (i >= 0) return i;
  }
  // No plan (e.g. a replay after the target changed): the most valuable target we can see.
  let bestI = 0, bestV = -Infinity;
  selects.forEach((s, i) => {
    const c = cardAt(view, s);
    const v = c ? monsterValue(view, c) - (c.code ? c.attack : 0) / 2000 : 0;
    if (v > bestV) { bestV = v; bestI = i; }
  });
  return bestI;
}
