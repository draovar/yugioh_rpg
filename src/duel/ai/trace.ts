// Readable records of the AI's decisions: what it was asked, what it chose and why, with the scores of the options it
// weighed. Printed by `&aitrace` in the browser and by `npm run arena -- --trace`, so misplays can be reported.
import {
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
  ocgMessageTypeStrings,
  type OcgMessage,
  type OcgResponse,
  type SelectFieldPlace,
} from "ocgcore-wasm";
import type { CardDb } from "../cardData.ts";

/** One option the brain weighed, with its score (higher = better). */
export interface ScoredOption {
  label: string;
  score: number;
}

export interface TraceEntry {
  seat: 0 | 1;
  brain: string;
  turn: number;
  phase: number;
  /** The prompt's message type, e.g. "select_idlecmd". */
  prompt: string;
  /** The answer in words, e.g. "summon Dark Magician". */
  choice: string;
  reason: string;
  options?: ScoredOption[];
  /** How long the decision took, in ms. */
  ms?: number;
}

const PHASES: [number, string][] = [
  [0x01, "DP"], [0x02, "SP"], [0x04, "M1"], [0xf8, "BP"], [0x100, "M2"], [0x200, "EP"],
];

/** A phase's short name as the traces print it (DP, SP, M1, BP, M2, EP). */
export function phaseLabel(phase: number): string {
  return PHASES.find(([bits]) => phase & bits)?.[1] ?? "-";
}

export function formatTrace(e: TraceEntry): string {
  const phase = phaseLabel(e.phase);
  const time = e.ms !== undefined && e.ms >= 1 ? ` [${Math.round(e.ms)} ms]` : "";
  const lines = [`[AI P${e.seat} ${e.brain} T${e.turn} ${phase}] ${e.prompt}: ${e.choice}${e.reason ? ` (${e.reason})` : ""}${time}`];
  for (const o of e.options ?? []) lines.push(`    ${o.score.toFixed(2).padStart(7)}  ${o.label}`);
  return lines.join("\n");
}

export function promptName(m: OcgMessage): string {
  return ocgMessageTypeStrings.get(m.type) ?? `message ${m.type}`;
}

const IDLE: Record<number, string> = {
  [SelectIdleCMDAction.SELECT_SUMMON]: "summon", [SelectIdleCMDAction.SELECT_SPECIAL_SUMMON]: "special summon",
  [SelectIdleCMDAction.SELECT_POS_CHANGE]: "change position", [SelectIdleCMDAction.SELECT_MONSTER_SET]: "set",
  [SelectIdleCMDAction.SELECT_SPELL_SET]: "set", [SelectIdleCMDAction.SELECT_ACTIVATE]: "activate",
};
const POSITIONS: Record<number, string> = {
  [OcgPosition.FACEUP_ATTACK]: "face-up attack", [OcgPosition.FACEDOWN_ATTACK]: "face-down attack",
  [OcgPosition.FACEUP_DEFENSE]: "face-up defense", [OcgPosition.FACEDOWN_DEFENSE]: "face-down defense",
};
const RPS = ["", "rock", "paper", "scissors"];

/** The answer `r` to prompt `m` in words. */
export function describeChoice(m: OcgMessage, r: OcgResponse, cards: CardDb): string {
  const name = (code: number) => (code ? cards.name(code) : "a hidden card");
  const names = (list: { code: number }[], indices: readonly number[] | null) =>
    indices?.length ? indices.map((i) => name(list[i]?.code ?? 0)).join(", ") : "none";
  switch (r.type) {
    case OcgResponseType.SELECT_IDLECMD: {
      if (m.type !== OcgMessageType.SELECT_IDLECMD) break;
      if (r.action === SelectIdleCMDAction.TO_BP) return "go to battle phase";
      if (r.action === SelectIdleCMDAction.TO_EP) return "end turn";
      if (r.action === SelectIdleCMDAction.SHUFFLE) return "shuffle hand";
      const list = [m.summons, m.special_summons, m.pos_changes, m.monster_sets, m.spell_sets, m.activates][r.action];
      return `${IDLE[r.action]} ${name(list?.[r.index ?? 0]?.code ?? 0)}`;
    }
    case OcgResponseType.SELECT_BATTLECMD: {
      if (m.type !== OcgMessageType.SELECT_BATTLECMD) break;
      if (r.action === SelectBattleCMDAction.TO_M2) return "go to main phase 2";
      if (r.action === SelectBattleCMDAction.TO_EP) return "end turn";
      if (r.action === SelectBattleCMDAction.SELECT_CHAIN) return `activate ${name(m.chains[r.index ?? 0]?.code ?? 0)}`;
      const a = m.attacks[r.index ?? 0];
      return `attack with ${name(a?.code ?? 0)}`;
    }
    case OcgResponseType.SELECT_CHAIN:
      if (m.type !== OcgMessageType.SELECT_CHAIN) break;
      return r.index === null ? "pass" : `chain ${name(m.selects[r.index]?.code ?? 0)}`;
    case OcgResponseType.SELECT_EFFECTYN:
      return `${r.yes ? "use" : "don't use"}${m.type === OcgMessageType.SELECT_EFFECTYN ? ` ${name(m.code)}` : ""}`;
    case OcgResponseType.SELECT_YESNO:
      return r.yes ? "yes" : "no";
    case OcgResponseType.SELECT_OPTION:
      return `option ${r.index + 1}`;
    case OcgResponseType.SELECT_CARD:
      if (m.type === OcgMessageType.SELECT_CARD) return names(m.selects, r.indicies);
      break;
    case OcgResponseType.SELECT_TRIBUTE:
      if (m.type === OcgMessageType.SELECT_TRIBUTE) return names(m.selects, r.indicies);
      break;
    case OcgResponseType.SELECT_SUM:
      if (m.type === OcgMessageType.SELECT_SUM) return names([...m.selects_must, ...m.selects], r.indicies);
      break;
    case OcgResponseType.SELECT_UNSELECT_CARD:
      if (m.type !== OcgMessageType.SELECT_UNSELECT_CARD) break;
      return r.index === null ? "finish" : name([...m.select_cards, ...m.unselect_cards][r.index]?.code ?? 0);
    case OcgResponseType.SELECT_POSITION:
      return POSITIONS[r.position] ?? `position ${r.position}`;
    case OcgResponseType.SELECT_PLACE:
    case OcgResponseType.SELECT_DISFIELD:
      return r.places.map(placeName).join(", ");
    case OcgResponseType.ANNOUNCE_CARD:
      return `declare ${name(r.card)}`;
    case OcgResponseType.ROCK_PAPER_SCISSORS:
      return RPS[r.value] ?? String(r.value);
  }
  return JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

function placeName(p: SelectFieldPlace): string {
  const zone = p.location === OcgLocation.MZONE ? `monster zone ${p.sequence + 1}` : `spell zone ${p.sequence + 1}`;
  return `P${p.player} ${zone}`;
}
