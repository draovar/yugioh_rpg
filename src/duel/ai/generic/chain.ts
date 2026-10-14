// Chain prompts (SELECT_CHAIN): whether to respond, and with what. Without card knowledge the brain leans on the
// engine: it only offers cards that are legal right now, and `spe_count` > 0 means a card's script marks this exact
// moment as its moment (a trap's trigger event, or a timing hint like "the opponent's End Phase"). The generic brain
// responds only to the opponent (their summon, attack, activation, or their End Phase) and only at such moments.
import { OcgLocation, OcgMessageType, OcgPhase, OcgResponseType, type OcgMessage } from "ocgcore-wasm";
import { TYPE } from "../../cardData.ts";
import type { AiView, Decision } from "../AiSeat.ts";
import { cardType } from "../board.ts";
import { best, type Option } from "./common.ts";

type ChainMessage = Extract<OcgMessage, { type: OcgMessageType.SELECT_CHAIN }>;

/** spe_count's value when the prompt is a choice between triggered effects rather than an open chain window. */
const TRIGGER_SELECTION = 0x7f;

export function decideChain(m: ChainMessage, view: AiView): Decision {
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

  const { memory } = view;
  // Never respond to our own chain link (e.g. negating our own trap).
  if (memory.chain.length && memory.chain[memory.chain.length - 1].controller === view.seat)
    return { response: pass, reason: "the last link is ours" };
  const last = memory.lastAction;
  const theirLink = memory.chain.length > 0 && memory.chain[memory.chain.length - 1].controller !== view.seat;
  const theirMove = last !== null && last.player !== view.seat;
  const theirEndPhase = memory.phase === OcgPhase.END && memory.turnPlayer !== view.seat;
  const responding = theirLink || theirMove || theirEndPhase;

  if (m.spe_count > 0 && responding) return best(options, () => "the opponent acted and a card fits this moment");
  return {
    response: pass,
    reason: responding ? "no card made for this moment" : "nothing to respond to",
    options: options.map((o) => ({ label: `${o.label} (not now)`, score: o.score })),
  };
}
