// Dev-only prompt preview for the duel scene: open the duel with `&dialogs` and pick a prompt from the
// dropdown (top-left of the page). It runs the real prompt UI with sample cards from the pool; whatever
// you answer is written to the duel log instead of being sent to the engine, then the real pending
// prompt comes back. Numbers match docs/duel-ui-checklist.md.
import Phaser from "phaser";
import { OcgLocation, OcgMessageType, OcgPosition, type OcgResponse } from "ocgcore-wasm";
import type { HumanPrompt } from "../duel/DuelController.ts";
import type { FieldSnapshot } from "../duel/DuelSession.ts";

/** What the preview needs from the duel scene. */
export interface DialogPreviewHost {
  readonly scene: Phaser.Scene;
  snapshot(): FieldSnapshot | null;
  /**
   * Shows `prompt` as if the engine had asked it. Answers are logged, not sent, then passed to `onAnswer`
   * if given: it may show a follow-up prompt and return true; false (or none) returns to the real duel.
   */
  prompt(prompt: HumanPrompt, hint: bigint | null, onAnswer?: (response: OcgResponse) => boolean): void;
  end(winner: number | null): void;
  graveyard(side: 0 | 1, codes: number[], banished: number[]): void;
}

interface Preview {
  label: string;
  run(host: DialogPreviewHost): void;
}

// Sample cards (all in data/pool.json).
const BLUE_EYES = 89631139, DARK_MAGICIAN = 46986414, SKULL = 70781052, CELTIC = 91152256, GEMINI = 69140098;
const VORSE = 14898066, LA_JINN = 97590747, MAN_EATER = 54652250, SANGAN = 26202165, POT = 55144522;
const RAIGEKI = 12580477, REBORN = 83764718, MST = 5318639, MIRROR_FORCE = 44095762, SAKURETSU = 56120475;
const TRAP_HOLE = 4206964, HEAVY_STORM = 19613556;

const HUMAN = 0;
/** aux.Stringid(code, n): a card's own script string (EDOPro packs it as code << 20 | n). */
const stringId = (code: number, n: number) => (BigInt(code) << 20n) | BigInt(n);

const loc = (code: number, location: OcgLocation, sequence: number, controller: 0 | 1 = HUMAN) =>
  ({ code, controller, location, sequence, position: OcgPosition.FACEUP_ATTACK });
const grave = (codes: number[]) => codes.map((code, i) => loc(code, OcgLocation.GRAVE, i));

const msg = (m: object) => ({ player: HUMAN, ...m }) as unknown as HumanPrompt;

const PREVIEWS: Preview[] = [
  {
    label: "#3 Optional effect (yes/no, with card)",
    run: (h) => h.prompt(msg({ type: OcgMessageType.SELECT_EFFECTYN, ...loc(SANGAN, OcgLocation.GRAVE, 0), description: 0n }), null),
  },
  {
    label: "#4 Yes/no question",
    run: (h) => h.prompt(msg({ type: OcgMessageType.SELECT_YESNO, description: 31n }), null), // "Attack directly?"
  },
  {
    label: "#5 Choose an option (short)",
    run: (h) => h.prompt(msg({ type: OcgMessageType.SELECT_OPTION, options: [100n, 101n] }), null), // Go first / second
  },
  {
    label: "#5 Choose an option (long)",
    run: (h) => h.prompt(msg({ type: OcgMessageType.SELECT_OPTION, options: [stringId(RAIGEKI, 0), 94n, 98n, 222n] }), 555n),
  },
  {
    label: "#6 Battle position (all 4)",
    run: (h) => h.prompt(msg({ type: OcgMessageType.SELECT_POSITION, code: BLUE_EYES, positions: 0xf }), null),
  },
  {
    label: "#6 Battle position (face-up only)",
    run: (h) => h.prompt(msg({ type: OcgMessageType.SELECT_POSITION, code: DARK_MAGICIAN, positions: OcgPosition.FACEUP_ATTACK | OcgPosition.FACEUP_DEFENSE }), null),
  },
  { label: "#7 Duel over: win", run: (h) => h.end(HUMAN) },
  { label: "#7 Duel over: loss", run: (h) => h.end(1) },
  { label: "#7 Duel over: draw", run: (h) => h.end(null) },
  {
    label: "#8 Chain (optional)",
    run: (h) => h.prompt(msg({
      type: OcgMessageType.SELECT_CHAIN, spe_count: 0, forced: false, hint_timing: 0, hint_timing_other: 0,
      selects: [MIRROR_FORCE, SAKURETSU, MST].map((code, i) => ({ ...loc(code, OcgLocation.SZONE, i), description: 0n, client_mode: 0 })),
    }), null),
  },
  {
    label: "#8 Chain (forced)",
    run: (h) => h.prompt(msg({
      type: OcgMessageType.SELECT_CHAIN, spe_count: 0, forced: true, hint_timing: 0, hint_timing_other: 0,
      selects: [{ ...loc(MAN_EATER, OcgLocation.MZONE, 2), description: 0n, client_mode: 0 }],
    }), null),
  },
  {
    label: "#9 Select 1 card (Monster Reborn target)",
    run: (h) => h.prompt(msg({
      type: OcgMessageType.SELECT_CARD, can_cancel: true, min: 1, max: 1,
      selects: [...grave([BLUE_EYES, SKULL, SANGAN]), ...grave([DARK_MAGICIAN, VORSE]).map((c) => ({ ...c, controller: 1 }))],
    }), 509n),
  },
  {
    label: "#9 Select 2 cards (multi)",
    run: (h) => h.prompt(msg({
      type: OcgMessageType.SELECT_CARD, can_cancel: false, min: 2, max: 2,
      selects: [POT, RAIGEKI, REBORN, MST, HEAVY_STORM, TRAP_HOLE].map((code, i) => loc(code, OcgLocation.HAND, i)),
    }), 501n),
  },
  {
    label: "#9 Select 1-3 of 30 cards (pages)",
    run: (h) => {
      const pool = [BLUE_EYES, DARK_MAGICIAN, SKULL, CELTIC, GEMINI, VORSE, LA_JINN, MAN_EATER, SANGAN, POT];
      h.prompt(msg({
        type: OcgMessageType.SELECT_CARD, can_cancel: true, min: 1, max: 3,
        selects: Array.from({ length: 30 }, (_, i) => loc(pool[i % pool.length], OcgLocation.DECK, i)),
      }), 506n);
    },
  },
  {
    label: "#9 On the field: pick 1 card in your hand",
    run: (h) => h.prompt(msg({ type: OcgMessageType.SELECT_CARD, can_cancel: true, min: 1, max: 1, selects: myHand(h) }), 501n),
  },
  {
    label: "#9 On the field: pick 2 cards in your hand",
    run: (h) => h.prompt(msg({ type: OcgMessageType.SELECT_CARD, can_cancel: false, min: 2, max: 2, selects: myHand(h) }), 501n),
  },
  {
    label: "#10 Tribute (2 of 3)",
    run: (h) => h.prompt(msg({
      type: OcgMessageType.SELECT_TRIBUTE, can_cancel: true, min: 2, max: 2,
      selects: [CELTIC, VORSE, MAN_EATER].map((code, i) => ({ ...loc(code, OcgLocation.MZONE, i), release_param: 1 })),
    }), 531n),
  },
  {
    label: "#11 Select/unselect (1 chosen)",
    run: (h) => selectUnselect(h, [GEMINI, LA_JINN], [CELTIC], 1, 3, false),
  },
  {
    label: "#11 Select/unselect (none chosen yet)",
    run: (h) => selectUnselect(h, [CELTIC, GEMINI, LA_JINN], [], 1, 2, false),
  },
  {
    label: "#12 Sum selection (total 8)",
    run: (h) => h.prompt(msg({
      type: OcgMessageType.SELECT_SUM, select_max: 0, amount: 8, min: 1, max: 3,
      selects_must: [{ ...loc(SKULL, OcgLocation.HAND, 0), amount: 6 }],
      selects: [CELTIC, MAN_EATER, SANGAN].map((code, i) => ({ ...loc(code, OcgLocation.HAND, i + 1), amount: [4, 2, 3][i] })),
    }), 500n),
  },
  {
    label: "#13 Graveyard browser (yours, + banished)",
    run: (h) => h.graveyard(0, [POT, SANGAN, MIRROR_FORCE, VORSE], [BLUE_EYES]),
  },
  {
    label: "#13 Graveyard browser (opponent's, 7 cards)",
    run: (h) => h.graveyard(1, [RAIGEKI, SKULL, TRAP_HOLE, GEMINI, HEAVY_STORM, LA_JINN, MST], []),
  },
  {
    label: "#14 Zone choice (free monster zones)",
    run: (h) => {
      const mine = h.snapshot()?.players[0].monsters ?? [];
      // field_mask bits set = not selectable; bits 0-4 are your Main Monster Zones. The hint is the
      // passcode of the card being placed.
      let mask = 0xffffffff;
      for (let i = 0; i < 5; i++) if (!mine[i]) mask &= ~(1 << i);
      h.prompt(msg({ type: OcgMessageType.SELECT_PLACE, count: 1, field_mask: mask >>> 0 }), BigInt(SKULL));
    },
  },
];

/**
 * SELECT_UNSELECT_CARD the way the engine runs it: one card per prompt, asked again after each pick or
 * unpick with the lists updated, until FINISH / CANCEL (or the max is reached). Opponent's monsters.
 */
function selectUnselect(h: DialogPreviewHost, pickable: number[], chosen: number[], min: number, max: number, canCancel: boolean) {
  const seq = new Map([...pickable, ...chosen].map((code, i) => [code, i]));
  const card = (code: number) => loc(code, OcgLocation.MZONE, seq.get(code)!, 1);
  const ask = () => h.prompt(msg({
    type: OcgMessageType.SELECT_UNSELECT_CARD, min, max,
    can_finish: chosen.length >= min, can_cancel: canCancel && chosen.length === 0,
    select_cards: pickable.map(card), unselect_cards: chosen.map(card),
  }), 502n, (r) => {
    const index = (r as { index: number | null }).index;
    if (index === null) return false; // FINISH / CANCEL
    if (index < pickable.length) chosen.push(...pickable.splice(index, 1));
    else pickable.push(...chosen.splice(index - pickable.length, 1));
    if (chosen.length >= max) return false; // the engine stops asking at the max
    ask();
    return true;
  });
  ask();
}

/** Your real hand cards (so on-field targeting can be tried: the cards exist on the board). */
function myHand(h: DialogPreviewHost) {
  return (h.snapshot()?.players[0].hand ?? []).map((c, i) => ({ code: c.code, controller: 0, location: OcgLocation.HAND, sequence: i, position: c.position }));
}

/** Adds the dropdown + Show button (plain HTML above the game). Call once the duel has started. */
export function installDialogPreview(host: DialogPreviewHost) {
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;left:6px;top:32px;z-index:10;display:flex;gap:4px;font:12px monospace";
  const select = document.createElement("select");
  PREVIEWS.forEach((p, i) => select.add(new Option(p.label, String(i))));
  const show = document.createElement("button");
  show.textContent = "Show";
  box.append(select, show);
  document.body.append(box);
  host.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => box.remove());

  const run = () => PREVIEWS[Number(select.value)].run(host);
  show.addEventListener("click", run);
  select.addEventListener("change", run);
}
