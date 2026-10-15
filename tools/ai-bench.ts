// Fixed test positions with a known right (or wrong) main-phase decision: every misplay found in play becomes one, so
// it stays fixed. Each position is a board (cards placed before the duel starts, the AI going first) and a check on
// the AI's first main-phase choice (its trace text, e.g. "summon Zaborg the Thunder Monarch").
// Usage: npm run ai-bench [-- --brain NAME (default: the game's)] [-- --show]
import { OcgLocation, OcgMessageType, OcgPosition, OcgResponseType, SelectIdleCMDAction } from "ocgcore-wasm";
import { autoRespond } from "../src/duel/autoBot.ts";
import { AiSeat } from "../src/duel/ai/AiSeat.ts";
import { BRAINS, DEFAULT_BRAIN, isBrainName, type BrainName } from "../src/duel/ai/brains.ts";
import { formatTrace, type TraceEntry } from "../src/duel/ai/trace.ts";
import type { Deck, StartCard } from "../src/duel/DuelSession.ts";
import { DECKS } from "../src/duel/decks.ts";
import { cards, core, newDuel, readScript, seedFrom } from "./lib/engine.ts";

const C = {
  zaborg: 51945556, mobius: 4929256, vorseRaider: 14898066, mysticalElf: 15025844, celticGuardian: 91152256,
  darkHole: 53129443, jinzo: 77585513, lordOfD: 17985575, darkMagicianGirl: 38033121, sangan: 26202165,
  potOfGreed: 55144522, compulsory: 94192409, darkMagician: 46986414, magicianOfFaith: 31560081,
  flute: 43973174, heavyStorm: 19613556, dnaTransplant: 56769674, fissure: 66788016, magicCylinder: 62279055,
  kuriboh: 40640057, gaia: 6368038, blueEyes: 89631139, smashingGround: 97169186,
  wingedDragon1: 87796900, axeOfDespair: 40619825, giantRat: 97017120,
  feralImp: 41392891, backupSoldier: 36280194, lastWill: 85602018, blackLusterRitual: 55761792, mysticTomato: 83011277,
  laJinn: 97590747,
} as const;

interface Position {
  name: string;
  /** Where it came from (a user report, a known misplay...). */
  why: string;
  /** The AI's and the opponent's cards. Main decks are filler, and nobody draws. */
  ai: StartCard[];
  opponent: StartCard[];
  /** The opponent goes first and just ends their turn, so the AI is on turn 2 and may attack. */
  aiSecond?: boolean;
  /** Play it with this many duel seeds (different deck orders and AI randomness); every one must pass. Default 1. */
  seeds?: number;
  /** Starting LP [AI, opponent]; default 8000 each. */
  lp?: [number, number];
  /** The AI's whole decklist (its Main Deck = this minus its placed cards); default filler. */
  aiDeck?: readonly number[];
  /** The AI's first main-phase choice must match this... */
  expect?: RegExp;
  /** ...and must not match this. */
  forbid?: RegExp;
  /** Check the whole turn plan behind that choice (the planner's "plan:" trace line) instead. */
  plan?: boolean;
}

const hand = (code: number): StartCard => ({ code, location: OcgLocation.HAND });
const monster = (code: number, sequence = 0, position: OcgPosition = OcgPosition.FACEUP_ATTACK): StartCard =>
  ({ code, location: OcgLocation.MZONE, sequence, position });
const setCard = (code: number, sequence = 0): StartCard => ({ code, location: OcgLocation.SZONE, sequence, position: OcgPosition.FACEDOWN_DEFENSE });
/** A face-up Equip Spell in zone `sequence`, equipped to the monster in zone `to` of duel team `team`. */
const equip = (code: number, sequence: number, to: number, team: 0 | 1): StartCard =>
  ({ code, location: OcgLocation.SZONE, sequence, equipTo: { team, sequence: to } });

const POSITIONS: Position[] = [
  {
    name: "monarch-without-target",
    why: "user report 2026-10-14: tributed Mobius for Zaborg with nothing else on the field; Zaborg destroyed itself",
    ai: [hand(C.zaborg), monster(C.mobius)],
    opponent: [],
    forbid: /summon Zaborg/,
  },
  {
    name: "tribute-before-dark-hole",
    why: "user report 2026-10-14: Dark Hole first destroyed Lord of D., the tribute Jinzo needed; then no summon",
    ai: [hand(C.darkHole), hand(C.jinzo), monster(C.lordOfD)],
    opponent: [monster(C.darkMagicianGirl, 1), monster(C.sangan, 2, OcgPosition.FACEDOWN_DEFENSE)],
    aiSecond: true,
    forbid: /activate Dark Hole/,
  },
  {
    name: "pot-before-position-change",
    why: "user report 2026-10-14: turned Dark Magician to defense (no attack on a set Magician of Faith) because that plan's copy drew better from Pot of Greed",
    ai: [hand(C.potOfGreed), hand(C.jinzo), hand(C.compulsory), monster(C.darkMagician)],
    opponent: [monster(C.magicianOfFaith, 2, OcgPosition.FACEDOWN_DEFENSE)],
    aiSecond: true,
    aiDeck: DECKS.kaiba.deck.main,
    seeds: 8,
    expect: /activate Pot of Greed/,
  },
  {
    name: "fissure-when-every-line-loses",
    why: "user report 2026-10-14: at 1600 LP every plan lost to the opponent's guessed 1600-ATK attacker (all -1000, a tie), so the AI kept Fissure instead of destroying Dark Magician",
    ai: [hand(C.flute), hand(C.heavyStorm), hand(C.dnaTransplant), hand(C.fissure)],
    opponent: [
      monster(C.darkMagician, 2), monster(C.mysticalElf, 3, OcgPosition.FACEDOWN_DEFENSE), setCard(C.magicCylinder, 2),
      hand(C.darkMagician), hand(C.kuriboh), hand(C.kuriboh), hand(C.gaia),
    ],
    aiSecond: true,
    lp: [1600, 7200],
    expect: /activate Fissure/,
  },
  {
    name: "keep-a-tribute-for-jinzo",
    why: "user report 2026-10-14: turn 1 with Jinzo + Blue-Eyes in hand ended with an empty field instead of Compulsory Evacuation Device + Lord of D. (1600 LP looked cheaper than risking Lord)",
    ai: [hand(C.jinzo), hand(C.compulsory), hand(C.lordOfD), hand(C.blueEyes), hand(C.smashingGround)],
    opponent: [hand(C.mysticalElf), hand(C.mysticalElf), hand(C.mysticalElf), hand(C.mysticalElf), hand(C.mysticalElf)],
    aiDeck: DECKS.kaiba.deck.main,
    seeds: 4,
    forbid: /end turn/,
  },
  {
    name: "attack-with-equipped-monster",
    why: "user report 2026-10-15: turned Winged Dragon #1 with Axe of Despair (2400) to defense instead of attacking an empty field; the copies lost the equip link",
    ai: [hand(C.giantRat), monster(C.wingedDragon1, 0), equip(C.axeOfDespair, 0, 0, 1)], // team 1: the AI goes second
    opponent: Array.from({ length: 6 }, () => hand(C.mysticalElf)),
    aiSecond: true,
    aiDeck: DECKS.yugiEvolution.deck.main,
    lp: [8000, 6600],
    seeds: 4,
    plan: true,
    forbid: /change position/,
  },
  {
    name: "set-the-blocker-facing-blue-eyes",
    why: "user report 2026-10-15: after Fissure, summoned Celtic Guardian in attack position facing Blue-Eyes (no attack, 1600 damage next turn); every plan scored as a loss, summon and set tied",
    ai: [hand(C.fissure), hand(C.celticGuardian), hand(C.feralImp), hand(C.backupSoldier), hand(C.lastWill), hand(C.blackLusterRitual)],
    opponent: [monster(C.mysticTomato, 0), monster(C.laJinn, 2), monster(C.blueEyes, 3), hand(C.mysticalElf), hand(C.mysticalElf), hand(C.mysticalElf)],
    aiSecond: true,
    aiDeck: DECKS.yugiEvolution.deck.main,
    lp: [4200, 6800],
    seeds: 4,
    plan: true,
    forbid: /summon Celtic Guardian|summon Feral Imp/,
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
const brainName = (args.includes("--brain") ? args[args.indexOf("--brain") + 1] : DEFAULT_BRAIN) as BrainName;
if (!isBrainName(brainName)) throw new Error(`unknown brain ${brainName}`);
const show = args.includes("--show");
const filler = (): Deck["main"] => Array<number>(30).fill(C.mysticalElf);

let failed = 0;
let runs = 0;
for (const p of POSITIONS) for (let run = 1; run <= (p.seeds ?? 1); run++) {
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
  const ai = new AiSeat({
    seat: aiSeat, brain: BRAINS[brainName]({ engine: { core, cards, readScript } }), duel,
    deck: aiDeck, onTrace: (e) => traces.push(e),
  });
  let choice: TraceEntry | null = null;
  for (let steps = 0; steps < 50 && !choice; steps++) {
    const s = duel.advance();
    ai.observe(s.messages);
    if (s.ended) break;
    const prompt = s.prompt as typeof s.prompt & { player: number };
    if (prompt.player !== aiSeat) {
      // The opponent never does anything: passes chains, ends its turn, answers anything else with the first legal option.
      duel.respond(prompt.type === OcgMessageType.SELECT_CHAIN && !prompt.forced ? { type: OcgResponseType.SELECT_CHAIN, index: null }
        : prompt.type === OcgMessageType.SELECT_IDLECMD ? { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null }
        : autoRespond(prompt, () => 0, cards));
      continue;
    }
    duel.respond(ai.decide(prompt));
    const last = traces[traces.length - 1];
    if (prompt.type === OcgMessageType.SELECT_IDLECMD) choice = last;
  }
  duel.destroy();
  const planLine = choice && p.plan ? formatTrace(choice).split("\n").find((l) => l.includes("plan:"))?.trim() : undefined;
  const text = planLine ?? choice?.choice ?? "(no main-phase decision)";
  const ok = !!choice && (!p.expect || p.expect.test(text)) && (!p.forbid || !p.forbid.test(text));
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${p.name}${p.seeds ? ` #${run}` : ""}: ${text}${ok ? "" : `   (${p.expect ? `expected ${p.expect}` : ""}${p.forbid ? ` forbidden ${p.forbid}` : ""}; ${p.why})`}`);
  if (show || !ok) if (choice) console.log(formatTrace(choice).split("\n").slice(1).join("\n"));
}
console.log(failed ? `${failed} of ${runs} runs failed` : `all ${runs} runs of ${POSITIONS.length} positions passed (${brainName})`);
if (failed) process.exit(1);
