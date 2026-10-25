// Fixed test positions with a known right (or wrong) main-phase decision: every misplay found in play becomes one, so
// it stays fixed. Each position is a board (cards placed before the duel starts, the AI going first) and a check on
// the AI's first main-phase choice (its trace text, e.g. "summon Zaborg the Thunder Monarch"), its plan, a chain
// answer, or its whole turn (every main-phase and battle choice in order, e.g. "summon Celtic Guardian → to battle
// phase → attack with Celtic Guardian → ..."), or its chain answers in the opponent's next turn.
// Usage: npm run ai-bench [-- --brain NAME (default: the game's)] [-- --show] [-- --only NAME-PART]
//        [-- --weights W.json (any of board.ts's Weights; the rest stay default)]
import { readFileSync } from "node:fs";
import { OcgMessageType, OcgResponseType, SelectBattleCMDAction, SelectIdleCMDAction } from "ocgcore-wasm";
import { autoRespond } from "../../src/duel/ai/autoBot.ts";
import { AiSeat } from "../../src/duel/ai/AiSeat.ts";
import { DEFAULT_WEIGHTS, type Weights } from "../../src/duel/ai/board.ts";
import { BRAINS, DEFAULT_BRAIN, isBrainName, type BrainName } from "../../src/duel/ai/brains.ts";
import { formatTrace, type TraceEntry } from "../../src/duel/ai/trace.ts";
import type { Deck } from "../../src/duel/engine/DuelSession.ts";
import { cards, core, newDuel, readScript, seedFrom } from "../lib/engine.ts";

import { C, POSITIONS } from "./ai-bench-positions.ts";

const args = process.argv.slice(2);
const brainName = (args.includes("--brain") ? args[args.indexOf("--brain") + 1] : DEFAULT_BRAIN) as BrainName;
if (!isBrainName(brainName)) throw new Error(`unknown brain ${brainName}`);
const show = args.includes("--show");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const weights: Weights | undefined = args.includes("--weights")
  ? { ...DEFAULT_WEIGHTS, ...(JSON.parse(readFileSync(args[args.indexOf("--weights") + 1], "utf-8")) as Partial<Weights>) } : undefined;
const filler = (): Deck["main"] => Array<number>(30).fill(C.mysticalElf);

let failed = 0;
let known = 0;
let runs = 0;
for (const p of POSITIONS.filter((q) => !only || q.name.includes(only))) for (let run = 1; run <= (p.seeds ?? 1); run++) {
  runs++;
  // No opening hand and no draws: only the placed cards. Seat 0 goes first.
  const aiSeat = p.aiSecond ? 1 : 0;
  const aiDeck = p.aiDeck ? [...p.aiDeck] : filler();
  const aiMain = [...aiDeck];
  for (const c of p.ai) { const i = aiMain.indexOf(c.code); if (i >= 0) aiMain.splice(i, 1); }
  const sides = [{ main: p.aiDeck ? aiMain : filler(), start: p.ai }, { main: filler(), start: p.opponent }];
  const duel = newDuel({
    decks: p.aiSecond ? [sides[1], sides[0]] : [sides[0], sides[1]], seed: seedFrom(run),
    draws: { opening: 0, perTurn: 0 }, onCoreLog: () => {},
    startingLP: p.lp ? (p.aiSecond ? [p.lp[1], p.lp[0]] : p.lp) : undefined,
  });
  const traces: TraceEntry[] = [];
  let firstTurnTrace: TraceEntry | null = null;
  const ai = new AiSeat({
    seat: aiSeat, brain: BRAINS[brainName]({ engine: { core, cards, readScript }, weights }), duel,
    deck: aiDeck, onTrace: (e) => traces.push(e),
  });
  let choice: TraceEntry | null = null;
  let activated = false;
  /** The turn's main-phase and battle choices (turn checks). */
  const turnChoices: string[] = [];
  const aiTurn = p.aiSecond ? 2 : 1;
  /** opponentSetsThenBattles: what the opponent has done in their turn. */
  let oppSet = false, oppBattled = false;
  /** Checks on the AI's chain answers in the opponent's turn. */
  const theirTurn = !!p.opponentSetsThenBattles || !!p.opponentAttacks;
  let attacksLeft = [...(p.opponentAttacks ?? [])];
  for (let steps = 0; steps < (p.turn || theirTurn ? 300 : 50) && !choice; steps++) {
    const s = duel.advance();
    ai.observe(s.messages);
    if (s.ended) break;
    if (p.turn && ai.memory.turn > aiTurn) break;
    if (theirTurn && ai.memory.turn > aiTurn + 1) break;
    const prompt = s.prompt as typeof s.prompt & { player: number };
    if (prompt.player !== aiSeat && p.opponentAttacks && ai.memory.turn === aiTurn + 1
      && (prompt.type === OcgMessageType.SELECT_IDLECMD || prompt.type === OcgMessageType.SELECT_BATTLECMD)) {
      if (prompt.type === OcgMessageType.SELECT_IDLECMD) {
        const toBp: boolean = !oppBattled && prompt.to_bp;
        oppBattled ||= toBp;
        duel.respond({ type: OcgResponseType.SELECT_IDLECMD, action: toBp ? SelectIdleCMDAction.TO_BP : SelectIdleCMDAction.TO_EP, index: null });
      } else {
        let i = -1;
        while (attacksLeft.length && i < 0) {
          const zone = attacksLeft.shift();
          i = prompt.attacks.findIndex((a) => a.sequence === zone);
        }
        duel.respond(i >= 0 ? { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: i }
          : { type: OcgResponseType.SELECT_BATTLECMD, action: prompt.to_m2 ? SelectBattleCMDAction.TO_M2 : SelectBattleCMDAction.TO_EP, index: null });
      }
      continue;
    }
    if (prompt.player !== aiSeat && p.opponentSetsThenBattles && ai.memory.turn === aiTurn + 1 && prompt.type === OcgMessageType.SELECT_IDLECMD) {
      if (!oppSet && prompt.monster_sets.length) {
        oppSet = true;
        duel.respond({ type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.SELECT_MONSTER_SET, index: 0 });
      } else if (!oppBattled && prompt.to_bp) {
        oppBattled = true;
        duel.respond({ type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_BP, index: null });
      } else duel.respond({ type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null });
      continue;
    }
    if (prompt.player !== aiSeat) {
      const j = prompt.type === OcgMessageType.SELECT_CHAIN && !activated && ai.memory.turnPlayer === aiSeat ? prompt.selects.findIndex((c) => c.code === p.opponentActivates) : -1;
      if (j >= 0) { activated = true; duel.respond({ type: OcgResponseType.SELECT_CHAIN, index: j }); continue; }
      if (prompt.type === OcgMessageType.SELECT_CARD && activated && p.opponentTargets) {
        const t = p.opponentTargets;
        const k = prompt.selects.findIndex((c) => c.controller === aiSeat && c.location === t.location && c.sequence === t.sequence);
        if (k >= 0) { duel.respond({ type: OcgResponseType.SELECT_CARD, indicies: [k] }); continue; }
      }
      // Otherwise the opponent never does anything: passes chains, ends its turn, answers anything else with the first legal option.
      duel.respond(prompt.type === OcgMessageType.SELECT_CHAIN && !prompt.forced ? { type: OcgResponseType.SELECT_CHAIN, index: null }
        : prompt.type === OcgMessageType.SELECT_IDLECMD ? { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null }
        : autoRespond(prompt, () => 0, cards));
      continue;
    }
    duel.respond(ai.decide(prompt));
    const last = traces[traces.length - 1];
    if (theirTurn) {
      if (ai.memory.turn === aiTurn + 1 && prompt.type === OcgMessageType.SELECT_CHAIN && prompt.selects.length > 0) {
        turnChoices.push(last.choice);
        firstTurnTrace ??= last;
      }
      if (ai.memory.turn === aiTurn + 1 && prompt.type === OcgMessageType.SELECT_POSITION) {
        turnChoices.push(`position ${last.choice}`);
        firstTurnTrace ??= last;
      }
      continue;
    }
    if (p.turn) {
      if (prompt.type === OcgMessageType.SELECT_IDLECMD || prompt.type === OcgMessageType.SELECT_BATTLECMD) {
        turnChoices.push(last.choice);
        firstTurnTrace ??= last;
      }
      if (p.picks && prompt.type === OcgMessageType.SELECT_CARD && ai.memory.turn === aiTurn)
        turnChoices.push(`${/attack|be attacked/.test(last.reason) ? "target" : "pick"} ${last.choice}`);
      if (p.picks && prompt.type === OcgMessageType.SELECT_POSITION && ai.memory.turn === aiTurn) turnChoices.push(`position ${last.choice}`);
      continue;
    }
    if (p.checkChain ? activated && prompt.type === OcgMessageType.SELECT_CHAIN && prompt.selects.length > 0 : prompt.type === OcgMessageType.SELECT_IDLECMD) choice = last;
  }
  duel.destroy();
  if (p.turn || theirTurn) choice = firstTurnTrace;
  const planLine = choice && p.plan ? formatTrace(choice).split("\n").find((l) => l.includes("plan:"))?.trim() : undefined;
  const text = p.turn || theirTurn ? turnChoices.join(" → ") || "(no main-phase decision)" : planLine ?? choice?.choice ?? "(no main-phase decision)";
  const ok = !!choice && (!p.expect || p.expect.test(text)) && (!p.forbid || !p.forbid.test(text));
  if (!ok && p.known) known++;
  else if (!ok) failed++;
  const status = p.known ? (ok ? "now passes (drop `known`)" : `known (${p.known})`) : ok ? "ok  " : "FAIL";
  console.log(`${status} ${p.name}${p.seeds ? ` #${run}` : ""}: ${text}${ok ? "" : `   (${p.expect ? `expected ${p.expect}` : ""}${p.forbid ? ` forbidden ${p.forbid}` : ""}; ${p.why})`}`);
  if (show || (!ok && !p.known)) if (choice) console.log(formatTrace(choice).split("\n").slice(1).join("\n"));
  if ((p.turn || theirTurn) && (show || (!ok && !p.known)))
    for (const t of traces) console.log(`    ${formatTrace(t).split("\n")[0]}`);
}
const knownNote = known ? `, ${known} known misplay${known > 1 ? "s" : ""}` : "";
console.log(failed ? `${failed} of ${runs} runs failed${knownNote}` : `all ${runs - known} runs passed${knownNote} (${POSITIONS.length} positions, ${brainName})`);
if (failed) process.exit(1);
