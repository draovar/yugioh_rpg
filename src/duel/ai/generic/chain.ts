// Chain prompts (SELECT_CHAIN): whether to respond, and with what. Without card knowledge the brain leans on the
// engine: it only offers cards that are legal right now, and `spe_count` > 0 means a card's script marks this exact
// moment as its moment (a trap's trigger event, or a timing hint like "the opponent's End Phase"). The generic brain
// responds only to the opponent (their summon, attack, activation, or their End Phase) and only at such moments.
import { OcgLocation, OcgMessageType, OcgPhase, OcgResponseType, type OcgMessage } from "ocgcore-wasm";
import { TYPE } from "../../engine/cardData.ts";
import type { AiView, Decision } from "../AiSeat.ts";
import { cardAt, cardType, mine, monsterStats, weightsOf } from "../board.ts";
import { best, type BrainState, type Option } from "./common.ts";
import type { Situation } from "../sim/replay.ts";

type ChainMessage = Extract<OcgMessage, { type: OcgMessageType.SELECT_CHAIN }>;

/** spe_count's value when the prompt is a choice between triggered effects rather than an open chain window. */
const TRIGGER_SELECTION = 0x7f;

/**
 * How much better than passing a replayed response must come out (in cards) to be used now. Timing is the one thing a
 * replay can't judge, so it's a rule: answer an action when it gains; in their End Phase even trades are worth making
 * (a set card removed now can't be used against us); in other phases with nothing to answer, wait unless it's big.
 */
function responseMargin(situation: Situation): number {
  if (situation.kind !== "phase") return 0.15;
  return situation.phase === OcgPhase.END ? -0.15 : 1.5;
}

/** Whether the monster just summoned at `place` can destroy one of ours in battle, or we have none. */
function threatens(view: AiView, place: Parameters<typeof cardAt>[1]): boolean {
  const summoned = cardAt(view, place);
  if (!summoned || summoned.faceDown || !summoned.code) return true;
  const ours = mine(view).monsters.filter((c) => c !== null);
  return !ours.length || ours.some((c) => {
    const st = monsterStats(c);
    return summoned.attack > (st.attackPos ? st.atk : st.def);
  });
}

export function decideChain(m: ChainMessage, view: AiView, state: BrainState): Decision {
  const name = (code: number) => view.cards.name(code);
  const options: Option[] = m.selects.map((c, i) => {
    const type = cardType(view, c.code);
    // Traps set for this are the classic answer; spells and monster effects next.
    const score = type & TYPE.TRAP ? 1 : type & TYPE.MONSTER ? 0.9 : c.location === OcgLocation.HAND ? 0.6 : 0.8;
    return { label: `chain ${name(c.code)}`, score, response: { type: OcgResponseType.SELECT_CHAIN, index: i } };
  });
  const pass = { type: OcgResponseType.SELECT_CHAIN, index: null } as const;

  if (m.forced) return best(options, () => "must activate");
  if (!options.length) return { response: pass, reason: "nothing to chain" };
  if (m.spe_count === TRIGGER_SELECTION) return best(options, () => "optional trigger: use it");

  // Simulated: replay what the opponent did and try every answer (M3).
  const replayed = state.simulator?.responses(view, m) ?? null;
  if (replayed) {
    const passValue = replayed.outcomes.find((o) => o.index === null)!.value;
    const tried = replayed.outcomes.filter((o) => o.index !== null);
    const what = replayed.situation.kind === "phase" ? `phase ${replayed.situation.phase}` : replayed.situation.kind;
    const scored = options.map((o, i) => {
      const r = tried.find((t) => t.index === i);
      return { label: `${o.label} (${r ? `sim ${r.value - passValue >= 0 ? "+" : ""}${(r.value - passValue).toFixed(2)}` : "not playable in the copy"})`, score: r ? r.value - passValue : -Infinity, response: o.response };
    });
    const top = scored.reduce((a, b) => (b.score > a.score ? b : a), { label: "", score: -Infinity, response: pass } as Option);
    const trace = scored.map((o) => ({ label: o.label, score: Number.isFinite(o.score) ? o.score : -9 }));
    if (top.score > responseMargin(replayed.situation)) return { response: top.response, reason: `replayed ${what}: beats passing`, options: trace };
    return { response: pass, reason: `replayed ${what}: nothing beats passing`, options: trace };
  }

  const { memory } = view;
  // Never respond to our own chain link (e.g. negating our own trap).
  if (memory.chain.length && memory.chain[memory.chain.length - 1].controller === view.seat)
    return { response: pass, reason: "the last link is ours" };
  const last = memory.lastAction;
  const theirLink = memory.chain.length > 0 && memory.chain[memory.chain.length - 1].controller !== view.seat;
  // Their summon or attack; an activation of theirs only while it's on the chain (theirLink): once resolved, it's over.
  // A summon only when the monster threatens ours: answering a harmless one spends a card for little (in the copies,
  // a set Compulsory Evacuation Device went on the first stand-in summoned, so setting it looked worse than holding it).
  const theirMove = last !== null && last.player !== view.seat && last.kind !== "activate"
    && (last.kind === "attack" || !last.place || threatens(view, last.place));
  const theirEndPhase = memory.phase === OcgPhase.END && memory.turnPlayer !== view.seat;
  const responding = theirLink || theirMove || theirEndPhase;

  if (m.spe_count > 0 && responding) {
    // Only cards that do something: one the copy can play on its own must gain there (a DEF boost on an attacking
    // monster doesn't); one it can't (it needs something to answer) keeps the rule.
    const sim = state.simulator;
    const useful = sim ? options.filter((_, i) => {
      const alone = sim.alone(view, m.selects[i]);
      return !alone || alone.delta > weightsOf(view).activateMin;
    }) : options;
    if (useful.length) return best(useful, () => "the opponent acted and a card fits this moment");
    return { response: pass, reason: "played alone in a copy, no card gains", options: options.map((o) => ({ label: `${o.label} (no gain)`, score: o.score })) };
  }
  return {
    response: pass,
    reason: responding ? "no card made for this moment" : "nothing to respond to",
    options: options.map((o) => ({ label: `${o.label} (not now)`, score: o.score })),
  };
}
