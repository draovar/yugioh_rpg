// What the duel screen shows for each prompt the engine asks you: card actions and phase buttons (idle / battle),
// dialogs, card pickers (on the board when the cards are there), zone choice, declarations. Prompts with no UI yet
// are answered by the bot (and logged). New prompt types go here.
import {
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
  type OcgCardLoc,
  type OcgResponse,
} from "ocgcore-wasm";
import type { HumanPrompt } from "../duel/DuelController.ts";
import type { FieldSnapshot } from "../duel/DuelSession.ts";
import type { Engine } from "../duel/loadEngine.ts";
import { autoRespond, declarableCards, sumMatches } from "../duel/autoBot.ts";
import { ATTRIBUTES, COIN_HEADS_STRING, COIN_TAILS_STRING, RACES } from "../duel/text.ts";
import type { BoardPick } from "../ui/duel/BoardPick.ts";
import type { Modal, PickerOptions } from "../ui/duel/Modal.ts";

/** The clickable phase boxes: to the Battle Phase, Main Phase 2, End Phase. */
export type PhaseAction = "bp" | "m2" | "ep";

/** What the prompts need from the duel scene. */
export interface PromptHost {
  readonly engine: Engine;
  /** Your seat. */
  readonly me: 0 | 1;
  readonly modal: Modal;
  readonly boardPick: BoardPick;
  snapshot(): FieldSnapshot | null;
  answer(response: OcgResponse): void;
  /** An entry in the card's action menu (SUMMON, SET, USE...). */
  addAction(card: OcgCardLoc, label: string, response: OcgResponse): void;
  /** Makes a phase box clickable. */
  setPhaseAction(action: PhaseAction, response: OcgResponse): void;
  /** Shows a hovered card in the info panel, and the pointer leaving it. */
  showInfo(code: number): void;
  hoverEnd(): void;
  log(line: string): void;
}

/** Sets up the UI for prompt `m` (`hint`: the "Select the card(s) to ..." string that came before it, if any). */
export function showPrompt(h: PromptHost, m: HumanPrompt, hint: bigint | null) {
  const t = h.engine.text;
  const title = (fallback: string) => (hint ? t.describe(hint) : fallback);
  const name = (code: number) => t.name(code);
  const where = (c: OcgCardLoc) => locationName(c.location, c.controller, h.me);
  // Cards in pickers and dialogs show in the info panel while hovered.
  const hover = { onHover: (code: number) => h.showInfo(code), onHoverEnd: () => h.hoverEnd() };
  const pickCards = (locs: OcgCardLoc[], opts: PickerOptions) => {
    if (!h.boardPick.cards(locs, opts)) h.modal.picker(opts);
  };

  switch (m.type) {
    case OcgMessageType.SELECT_IDLECMD: {
      const add = (cards: OcgCardLoc[], label: string, action: SelectIdleCMDAction) =>
        cards.forEach((c, index) => h.addAction(c, label, { type: OcgResponseType.SELECT_IDLECMD, action, index }));
      add(m.summons, "Summon", SelectIdleCMDAction.SELECT_SUMMON);
      add(m.special_summons, "Sp.Sum", SelectIdleCMDAction.SELECT_SPECIAL_SUMMON);
      add(m.monster_sets, "Set", SelectIdleCMDAction.SELECT_MONSTER_SET);
      m.pos_changes.forEach((c, index) => h.addAction(c, positionLabel(h, c), {
        type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_POS_CHANGE, index,
      }));
      m.activates.forEach((c, index) => h.addAction(c, "Use", {
        type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_ACTIVATE, index,
      }));
      // Last, so a Spell/Trap in hand lists USE before SET.
      add(m.spell_sets, "Set", SelectIdleCMDAction.SELECT_SPELL_SET);
      if (m.to_bp) h.setPhaseAction("bp", { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null });
      if (m.to_ep) h.setPhaseAction("ep", { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null });
      return;
    }
    case OcgMessageType.SELECT_BATTLECMD: {
      m.attacks.forEach((c, index) => h.addAction(c, "Attack", { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index }));
      m.chains.forEach((c, index) => h.addAction(c, "Use", {
        type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_CHAIN, index,
      }));
      if (m.to_m2) h.setPhaseAction("m2", { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_M2, index: null });
      if (m.to_ep) h.setPhaseAction("ep", { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.TO_EP, index: null });
      return;
    }
    case OcgMessageType.SELECT_CHAIN:
      h.modal.picker({
        title: m.forced ? "You must activate an effect" : "Chain an effect?",
        // Caption: the effect's own name when it has one, else where the card is (FIELD, HAND, GY...),
        // except set Spells/Traps: S/T says nothing new. Never the generic "ACTIVATE".
        cards: m.selects.map((c) => {
          const effect = activateLabel(h, c.code, c.description);
          if (effect !== "Activate") return { code: c.code, caption: effect };
          return { code: c.code, caption: c.location === OcgLocation.SZONE ? "" : where(c) };
        }),
        mode: "single",
        onConfirm: ([i]) => h.answer({ type: OcgResponseType.SELECT_CHAIN, index: i }),
        buttons: m.forced ? [] : [{ label: "Don't chain", onClick: () => h.answer({ type: OcgResponseType.SELECT_CHAIN, index: null }) }],
        ...hover,
      });
      return;
    case OcgMessageType.SELECT_EFFECTYN: {
      const msg = m.description ? t.describe(m.description, name(m.code)) : t.describe(95, name(m.code));
      yesNo(h, msg || `Activate the effect of "${name(m.code)}"?`, (yes) => ({ type: OcgResponseType.SELECT_EFFECTYN, yes }), m.code);
      return;
    }
    case OcgMessageType.SELECT_YESNO:
      yesNo(h, t.describe(m.description), (yes) => ({ type: OcgResponseType.SELECT_YESNO, yes }));
      return;
    case OcgMessageType.SELECT_OPTION: {
      // Calling a coin toss (Duel.AnnounceCoin) is an option prompt between system strings 60 / 61.
      const heads = m.options.findIndex((o) => Number(o) === COIN_HEADS_STRING);
      const tails = m.options.findIndex((o) => Number(o) === COIN_TAILS_STRING);
      if (m.options.length === 2 && heads >= 0 && tails >= 0) {
        h.modal.coinCall(title("Call the coin toss"), (isHeads) => h.answer({ type: OcgResponseType.SELECT_OPTION, index: isHeads ? heads : tails }));
        return;
      }
      h.modal.dialog(title("Choose an option").toUpperCase(), m.options.map((o, index) => ({
        label: t.describe(o).toUpperCase(), onClick: () => h.answer({ type: OcgResponseType.SELECT_OPTION, index }),
      })));
      return;
    }
    case OcgMessageType.SELECT_POSITION: {
      const choices: [OcgPosition, string][] = [
        [OcgPosition.FACEUP_ATTACK, "ATTACK"], [OcgPosition.FACEDOWN_ATTACK, "FD ATTACK"],
        [OcgPosition.FACEUP_DEFENSE, "DEFENSE"], [OcgPosition.FACEDOWN_DEFENSE, "FD DEFENSE"],
      ];
      h.modal.dialog(`BATTLE POSITION FOR "${name(m.code).toUpperCase()}"`, choices.filter(([p]) => m.positions & p).map(([position, label]) => ({
        label, onClick: () => h.answer({ type: OcgResponseType.SELECT_POSITION, position }),
      })), m.code);
      return;
    }
    case OcgMessageType.SELECT_CARD:
      pickCards(m.selects, {
        title: title(`Select ${range(m.min, m.max)} card(s)`),
        cards: m.selects.map((c) => ({ code: c.code, caption: where(c) })),
        mode: m.min === 1 && m.max === 1 ? "single" : "multi",
        isValid: (sel) => sel.length >= m.min && sel.length <= m.max,
        max: m.max,
        onConfirm: (sel) => h.answer({ type: OcgResponseType.SELECT_CARD, indicies: sel }),
        buttons: m.can_cancel ? [{ label: "Cancel", onClick: () => h.answer({ type: OcgResponseType.SELECT_CARD, indicies: null }) }] : [],
        ...hover,
      });
      return;
    case OcgMessageType.SELECT_TRIBUTE:
      pickCards(m.selects, {
        title: title("Select monster(s) to Tribute"),
        // Tributes are normally your own field monsters: caption only the unusual ones (hand, opponent's).
        cards: m.selects.map((c) => ({ code: c.code, caption: c.controller === h.me && c.location === OcgLocation.MZONE ? "" : where(c) })),
        mode: "multi",
        // release_param: how many tributes this card counts as (Double Tribute monsters count 2).
        isValid: (sel) => {
          const worth = sel.reduce((n, i) => n + (m.selects[i].release_param || 1), 0);
          return worth >= m.min && sel.length <= m.max && sel.length > 0;
        },
        max: m.max,
        onConfirm: (sel) => h.answer({ type: OcgResponseType.SELECT_TRIBUTE, indicies: sel }),
        buttons: m.can_cancel ? [{ label: "Cancel", onClick: () => h.answer({ type: OcgResponseType.SELECT_TRIBUTE, indicies: null }) }] : [],
        ...hover,
      });
      return;
    case OcgMessageType.SELECT_UNSELECT_CARD: {
      // The engine asks one card at a time and lists the chosen ones separately. Show all of them in
      // board order so a card stays put when picked (it just rises, captioned CHOSEN); `index` counts
      // select_cards first, then unselect_cards.
      const entries = [
        ...m.select_cards.map((c, index) => ({ c, index, chosen: false })),
        ...m.unselect_cards.map((c, index) => ({ c, index: m.select_cards.length + index, chosen: true })),
      ].sort((a, b) => a.c.controller - b.c.controller || a.c.location - b.c.location || a.c.sequence - b.c.sequence);
      const chosen = m.unselect_cards.length;
      const done = { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null } as const;
      // FINISH and CANCEL send the same answer: FINISH once enough are chosen, CANCEL before that if
      // allowed, else a faded FINISH that only shows the count.
      const button = m.can_finish || !m.can_cancel
        ? { label: `Finish ${chosen}/${m.max}`, enabled: m.can_finish, onClick: () => h.answer(done) }
        : { label: "Cancel", onClick: () => h.answer(done) };
      pickCards(entries.map((e) => e.c), {
        title: title(`Select ${range(m.min, m.max)} card(s)`),
        cards: entries.map((e) => ({ code: e.c.code, caption: e.chosen ? "CHOSEN" : where(e.c), selected: e.chosen })),
        mode: "single",
        buttons: [button],
        onConfirm: ([i]) => h.answer({ type: OcgResponseType.SELECT_UNSELECT_CARD, index: entries[i].index }),
        ...hover,
      });
      return;
    }
    case OcgMessageType.SELECT_SUM: {
      // Picker indexes: the "must" cards first (locked, always counted), then the optional ones.
      const must = m.selects_must.map((c) => c.amount);
      const value = (amount: number) => amount & 0xffff; // low half; the high half is an alternative value
      const caption = (amount: number) => `VALUE ${value(amount)}`;
      h.modal.picker({
        title: title(`Select cards with a total of ${m.amount}`),
        cards: [
          ...m.selects_must.map((c) => ({ code: c.code, locked: true, caption: caption(c.amount) })),
          ...m.selects.map((c) => ({ code: c.code, caption: caption(c.amount) })),
        ],
        mode: "multi",
        isValid: (sel) => {
          const chosen = sel.filter((i) => i >= must.length).map((i) => m.selects[i - must.length].amount);
          // "At least" mode (Ritual tributes) sends min = max = 0: no count limit then.
          const countOk = m.select_max !== 0 || (chosen.length >= m.min && chosen.length <= m.max);
          return countOk && sumMatches([...must, ...chosen], m.amount, m.select_max !== 0);
        },
        // CONFIRM shows the running total against the target ("CONFIRM 6/8").
        counter: {
          value: (sel) => sel.reduce((n, i) => n + value(i < must.length ? must[i] : m.selects[i - must.length].amount), 0),
          of: m.amount,
        },
        onConfirm: (sel) => h.answer({ type: OcgResponseType.SELECT_SUM, indicies: sel.filter((i) => i >= must.length).map((i) => i - must.length) }),
        ...hover,
      });
      return;
    }
    case OcgMessageType.SELECT_COUNTER: {
      const counterName = t.counterName(m.counter_type);
      const onBoard = h.boardPick.counters(m.cards, m.count, {
        title: title(`Remove ${m.count} ${counterName}${m.count > 1 ? "s" : ""}`),
        onConfirm: (counters) => h.answer({ type: OcgResponseType.SELECT_COUNTER, counters }),
        ...hover,
      });
      if (!onBoard) break; // not on the board after all: the bot answers
      return;
    }
    case OcgMessageType.SORT_CARD:
      // Big Eye: the cards come top-first; the one numbered 1 goes on top.
      h.modal.sortCards({
        title: title("Click the cards in their new order (1 = top)"),
        codes: m.cards.map((c) => c.code),
        onConfirm: (order) => h.answer({ type: OcgResponseType.SORT_CARD, order }),
        ...hover,
      });
      return;
    case OcgMessageType.SELECT_PLACE:
    case OcgMessageType.SELECT_DISFIELD:
      // For zone prompts the hint is the passcode of the card being placed, not a string id.
      h.boardPick.places(m.player, m.field_mask, m.count, hint && h.engine.cards.records.has(Number(hint))
        ? t.describe(569, name(Number(hint)))
        : t.describe(m.type === OcgMessageType.SELECT_PLACE ? 560 : 570),
      (places) => h.answer(m.type === OcgMessageType.SELECT_PLACE
        ? { type: OcgResponseType.SELECT_PLACE, places }
        : { type: OcgResponseType.SELECT_DISFIELD, places }));
      return;
    // Declarations (Tribe-Infecting Virus, DNA Transplant, Sixth Sense, Mind Crush...).
    case OcgMessageType.ANNOUNCE_RACE:
      declareFlags(h, title("Declare a Type"), RACES, BigInt(m.available), m.count,
        (races) => ({ type: OcgResponseType.ANNOUNCE_RACE, races }) as OcgResponse);
      return;
    case OcgMessageType.ANNOUNCE_ATTRIB:
      declareFlags(h, title("Declare an Attribute"), ATTRIBUTES.map(([bit, n]) => [BigInt(bit), n]), BigInt(m.available), m.count,
        (picked) => ({ type: OcgResponseType.ANNOUNCE_ATTRIB, attributes: picked.map(Number) }) as OcgResponse);
      return;
    case OcgMessageType.ANNOUNCE_NUMBER:
      // The answer is the option's index, not the number.
      h.modal.dialog(title("Declare a number").toUpperCase(), m.options.map((value, index) => ({
        label: String(value), onClick: () => h.answer({ type: OcgResponseType.ANNOUNCE_NUMBER, value: index }),
      })));
      return;
    case OcgMessageType.ANNOUNCE_CARD: {
      // Typed search over every card the game knows that passes the prompt's filter.
      const codes = declarableCards(h.engine.cards, m.opcodes);
      if (!codes.length) break;
      h.modal.search({
        title: title("Declare a card name"),
        codes,
        onPick: (card) => h.answer({ type: OcgResponseType.ANNOUNCE_CARD, card }),
        onHover: hover.onHover,
      });
      return;
    }
  }
  // The bot answers the rest: prompts without UI yet (SORT_CHAIN, a card's rock-paper-scissors; no pool card asks
  // them so far), counters not on the board, a card declaration nothing can satisfy.
  h.log(`(auto-answered ${OcgMessageType[m.type] ?? m.type})`);
  h.answer(autoRespond(m, Math.random, h.engine.cards));
}

/**
 * Declares `count` of the flags in `available` (Types or Attributes): one button dialog per pick, without
 * the ones already picked; answers once all are chosen.
 */
function declareFlags(h: PromptHost, title: string, options: [bigint, string][], available: bigint, count: number,
  make: (picked: bigint[]) => OcgResponse, picked: bigint[] = []) {
  const open = options.filter(([bit]) => available & bit && !picked.includes(bit));
  const step = count > 1 ? ` (${picked.length + 1}/${count})` : "";
  h.modal.dialog(`${title}${step}`.toUpperCase(), open.map(([bit, name]) => ({
    label: name,
    onClick: () => {
      const next = [...picked, bit];
      if (next.length >= count) h.answer(make(next));
      else declareFlags(h, title, options, available, count, make, next);
    },
  })));
}

function yesNo(h: PromptHost, msg: string, make: (yes: boolean) => OcgResponse, code?: number) {
  h.modal.dialog(msg.toUpperCase(), [
    { label: "YES", onClick: () => h.answer(make(true)) },
    { label: "NO", onClick: () => h.answer(make(false)) },
  ], code);
}

/** An effect's own name (its description), or "Activate" when it has none. */
function activateLabel(h: PromptHost, code: number, desc: bigint): string {
  const d = h.engine.text.describe(desc, h.engine.text.name(code));
  return d && !d.startsWith("#") ? d : "Activate";
}

/** Card menu labels fit 6 letters: a set monster can be flipped, a face-up one switched. */
function positionLabel(h: PromptHost, c: OcgCardLoc): string {
  const pos = h.snapshot()?.players[c.controller].monsters[c.sequence]?.position ?? 0;
  if (pos & (OcgPosition.FACEDOWN_ATTACK | OcgPosition.FACEDOWN_DEFENSE)) return "Flip";
  return pos & OcgPosition.FACEUP_DEFENSE ? "To Atk" : "To Def";
}

function range(min: number, max: number) {
  return min === max ? String(min) : `${min}-${max}`;
}

/** Where a card is, as a picker caption: FIELD, HAND, GY..., "OPP " in front for the opponent's cards. */
function locationName(location: number, controller: number, me: number): string {
  const owner = controller === me ? "" : "OPP ";
  const names: Record<number, string> = {
    [OcgLocation.DECK]: "DECK", [OcgLocation.HAND]: "HAND", [OcgLocation.MZONE]: "FIELD",
    [OcgLocation.SZONE]: "S/T", [OcgLocation.GRAVE]: "GY", [OcgLocation.REMOVED]: "BANISHED", [OcgLocation.EXTRA]: "EXTRA",
  };
  return `${owner}${names[location] ?? "?"}`;
}
