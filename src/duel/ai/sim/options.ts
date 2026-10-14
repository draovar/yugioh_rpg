// Finding a real prompt's option again in a copy's prompt. Copies are rebuilt from the board, so indices differ; an
// option is the same when it's the same card in the same place doing the same thing.
import { OcgMessageType, SelectIdleCMDAction, type OcgCardLoc, type OcgMessage } from "ocgcore-wasm";

type IdleMessage = Extract<OcgMessage, { type: OcgMessageType.SELECT_IDLECMD }>;

/** A card option, with the effect's description when it's an activation. */
export type CardOption = OcgCardLoc & { description?: bigint };

/** The main-phase prompt's list for an action (summons, special summons, position changes, sets, activations). */
export function idleList(m: IdleMessage, action: SelectIdleCMDAction): CardOption[] | null {
  switch (action) {
    case SelectIdleCMDAction.SELECT_SUMMON: return m.summons;
    case SelectIdleCMDAction.SELECT_SPECIAL_SUMMON: return m.special_summons;
    case SelectIdleCMDAction.SELECT_POS_CHANGE: return m.pos_changes;
    case SelectIdleCMDAction.SELECT_MONSTER_SET: return m.monster_sets;
    case SelectIdleCMDAction.SELECT_SPELL_SET: return m.spell_sets;
    case SelectIdleCMDAction.SELECT_ACTIVATE: return m.activates;
    default: return null;
  }
}

/** The same option in `list`: same card, place and effect; for hand cards any copy of the card will do. -1 if none. */
export function findSame(list: readonly CardOption[], o: CardOption): number {
  const exact = list.findIndex((c) => c.code === o.code && c.location === o.location && c.sequence === o.sequence && c.description === o.description);
  if (exact >= 0) return exact;
  return list.findIndex((c) => c.code === o.code && c.location === o.location && c.description === o.description);
}
