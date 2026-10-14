// Fixed test positions with a known right (or wrong) main-phase decision: every misplay found in play becomes one, so
// it stays fixed. Each position is a board (cards placed before the duel starts, the AI going first) and a check on
// the AI's first main-phase choice (its trace text, e.g. "summon Zaborg the Thunder Monarch").
// Usage: npm run ai-bench [-- --brain sim] [-- --show]
import { OcgLocation, OcgMessageType, OcgPosition, OcgResponseType } from "ocgcore-wasm";
import { autoRespond } from "../src/duel/autoBot.ts";
import { AiSeat } from "../src/duel/ai/AiSeat.ts";
import { BRAINS, isBrainName, type BrainName } from "../src/duel/ai/brains.ts";
import { formatTrace, type TraceEntry } from "../src/duel/ai/trace.ts";
import type { Deck, StartCard } from "../src/duel/DuelSession.ts";
import { cards, core, newDuel, readScript, seedFrom } from "./lib/engine.ts";

const C = {
  zaborg: 51945556, mobius: 4929256, vorseRaider: 14898066, mysticalElf: 15025844, celticGuardian: 91152256,
} as const;

interface Position {
  name: string;
  /** Where it came from (a user report, a known misplay...). */
  why: string;
  /** The AI (seat 0, goes first) and the opponent. Main decks are filler so draws don't matter. */
  ai: StartCard[];
  opponent: StartCard[];
  /** The AI's first main-phase choice must match this... */
  expect?: RegExp;
  /** ...and must not match this. */
  forbid?: RegExp;
}

const hand = (code: number): StartCard => ({ code, location: OcgLocation.HAND });
const monster = (code: number, sequence = 0, position = OcgPosition.FACEUP_ATTACK): StartCard =>
  ({ code, location: OcgLocation.MZONE, sequence, position });

const POSITIONS: Position[] = [
  {
    name: "monarch-without-target",
    why: "user report 2026-10-14: tributed Mobius for Zaborg with nothing else on the field; Zaborg destroyed itself",
    ai: [hand(C.zaborg), monster(C.mobius)],
    opponent: [],
    forbid: /summon Zaborg/,
  },
  {
    name: "monarch-with-target",
    why: "control for the above: with an opposing monster, Zaborg's effect pays off",
    ai: [hand(C.zaborg), monster(C.celticGuardian)],
    opponent: [monster(C.vorseRaider)],
    expect: /summon Zaborg/,
  },
];

const args = process.argv.slice(2);
const brainName = (args.includes("--brain") ? args[args.indexOf("--brain") + 1] : "sim") as BrainName;
if (!isBrainName(brainName)) throw new Error(`unknown brain ${brainName}`);
const show = args.includes("--show");
const filler = (): Deck["main"] => Array<number>(30).fill(C.mysticalElf);

let failed = 0;
for (const p of POSITIONS) {
  // No opening hand and no draws: only the placed cards.
  const duel = newDuel({
    decks: [{ main: filler(), start: p.ai }, { main: filler(), start: p.opponent }], seed: seedFrom(1),
    draws: { opening: 0, perTurn: 0 }, onCoreLog: () => {},
  });
  const traces: TraceEntry[] = [];
  const ai = new AiSeat({
    seat: 0, brain: BRAINS[brainName]({ engine: { core, cards, readScript } }), duel,
    deck: filler(), onTrace: (e) => traces.push(e),
  });
  let choice: TraceEntry | null = null;
  for (let steps = 0; steps < 50 && !choice; steps++) {
    const s = duel.advance();
    ai.observe(s.messages);
    if (s.ended) break;
    const prompt = s.prompt as typeof s.prompt & { player: number };
    if (prompt.player !== 0) {
      // The opponent never does anything: passes chains, answers anything else with the first legal option.
      duel.respond(prompt.type === OcgMessageType.SELECT_CHAIN && !prompt.forced
        ? { type: OcgResponseType.SELECT_CHAIN, index: null } : autoRespond(prompt, () => 0, cards));
      continue;
    }
    duel.respond(ai.decide(prompt));
    const last = traces[traces.length - 1];
    if (prompt.type === OcgMessageType.SELECT_IDLECMD) choice = last;
  }
  duel.destroy();
  const text = choice?.choice ?? "(no main-phase decision)";
  const ok = !!choice && (!p.expect || p.expect.test(text)) && (!p.forbid || !p.forbid.test(text));
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${p.name}: ${text}${ok ? "" : `   (${p.expect ? `expected ${p.expect}` : ""}${p.forbid ? ` forbidden ${p.forbid}` : ""}; ${p.why})`}`);
  if (show || !ok) if (choice) console.log(formatTrace(choice).split("\n").slice(1).join("\n"));
}
console.log(failed ? `${failed} of ${POSITIONS.length} positions failed` : `all ${POSITIONS.length} positions passed (${brainName})`);
if (failed) process.exit(1);
