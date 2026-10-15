// Fixed test positions with a known right (or wrong) main-phase decision: every misplay found in play becomes one, so
// it stays fixed. Each position is a board (cards placed before the duel starts, the AI going first) and a check on
// the AI's first main-phase choice (its trace text, e.g. "summon Zaborg the Thunder Monarch"), its plan, a chain
// answer, or its whole turn (every main-phase and battle choice in order, e.g. "summon Celtic Guardian → to battle
// phase → attack with Celtic Guardian → ...").
// Usage: npm run ai-bench [-- --brain NAME (default: the game's)] [-- --show] [-- --only NAME-PART]
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
  blackLusterSoldier: 5405694, disappear: 24623598, shift: 59560625, giantSoldier: 13039848, koumori: 67724379, madSwordBeast: 79870141,
  mysticClown: 47060154, mst: 5318639, magicJammer: 77414722, spiritRyu: 67957315, warriorDaiGrepher: 75953262, trapHole: 4206964, darkBlade: 11321183, neo: 50930991, laJinn: 97590747, summonedSkull: 70781052, opticlops: 14531242, justDesserts: 24068492, reliableGuardian: 16430187,
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
  /** Check the AI's whole turn instead: its main-phase and battle choices in order, joined by " → ". */
  turn?: boolean;
  /**
   * A known misplay waiting for a planned fix (docs/ai-rework-plan.md, e.g. "phase 2a"): reported as "known", not a
   * failure; when it passes, "now passes" says the flag can go.
   */
  known?: string;
  /** The opponent activates this card at the first chain prompt in the AI's turn that offers it... */
  opponentActivates?: number;
  /** ...and the check is on the AI's next chain answer after that (with something to chain), not a main-phase choice. */
  checkChain?: boolean;
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
    name: "no-buff-against-just-desserts",
    why: "user report 2026-10-15: chained The Reliable Guardian to Just Desserts in its own turn (it changes nothing) and gave the +700 DEF to the opponent's Opticlops",
    ai: [hand(C.axeOfDespair), hand(C.reliableGuardian), monster(C.summonedSkull, 0)],
    opponent: [monster(C.opticlops, 1), monster(C.mysticTomato, 2), setCard(C.justDesserts, 0)],
    aiSecond: true,
    opponentActivates: C.justDesserts,
    checkChain: true,
    expect: /^pass/,
  },
  {
    name: "ritual-summon-black-luster-soldier",
    why: "user report 2026-10-15: held Black Luster Ritual + Black Luster Soldier for turns with Gaia in hand and Giant Soldier of Stone on the field (7 + 3 levels), facing three 1400-1800 ATK monsters",
    ai: [
      hand(C.wingedDragon1), hand(C.blackLusterRitual), hand(C.disappear), hand(C.shift), hand(C.blackLusterSoldier), hand(C.gaia),
      monster(C.giantSoldier, 0, OcgPosition.FACEUP_DEFENSE),
    ],
    opponent: [
      monster(C.koumori, 2), monster(C.laJinn, 3), monster(C.madSwordBeast, 4),
      ...Array.from({ length: 7 }, () => hand(C.mysticalElf)),
    ],
    aiSecond: true,
    aiDeck: DECKS.yugiEvolution.deck.main,
    lp: [7200, 6800],
    plan: true,
    expect: /activate Black Luster Ritual/,
  },
  {
    name: "attack-an-empty-field",
    why: "user report 2026-10-15: at 4100 LP vs 8000, with an empty field on both sides, kept Mystic Clown and Celtic Guardian in hand instead of summoning one and attacking directly",
    ai: [hand(C.lastWill), hand(C.celticGuardian), hand(C.mysticClown)],
    opponent: Array.from({ length: 5 }, () => hand(C.mysticalElf)),
    aiSecond: true,
    aiDeck: DECKS.yugiEvolution.deck.main,
    lp: [4100, 8000],
    seeds: 4,
    expect: /summon (Mystic Clown|Celtic Guardian)/,
  },
  {
    name: "pot-of-greed-first",
    why: "user report 2026-10-15: summoned Dark Blade, then played Pot of Greed; drawing first could change which monster is best to summon",
    ai: [hand(C.darkBlade), hand(C.neo), hand(C.potOfGreed), hand(C.darkHole), hand(C.lastWill)],
    opponent: [monster(C.mysticalElf, 2, OcgPosition.FACEDOWN_DEFENSE), hand(C.mysticalElf), hand(C.mysticalElf), hand(C.mysticalElf), hand(C.mysticalElf)],
    aiSecond: true,
    aiDeck: DECKS.yugiEvolution.deck.main,
    seeds: 4,
    expect: /activate Pot of Greed/,
  },
  {
    name: "set-magic-jammer",
    why: "user report 2026-10-15: held Magic Jammer in hand (a set card counted less than a Trap in hand) instead of setting it behind Warrior Dai Grepher; any time in the turn will do",
    ai: [hand(C.backupSoldier), hand(C.celticGuardian), hand(C.magicJammer), monster(C.warriorDaiGrepher, 0)],
    opponent: [
      monster(C.spiritRyu, 0, OcgPosition.FACEDOWN_DEFENSE), setCard(C.trapHole, 4),
      hand(C.mysticalElf), hand(C.mysticalElf), hand(C.mysticalElf), hand(C.mysticalElf),
    ],
    aiSecond: true,
    aiDeck: DECKS.yugiEvolution.deck.main,
    lp: [6800, 3700],
    turn: true,
    expect: /set Magic Jammer/,
  },
  {
    name: "summon-and-attack-an-empty-board",
    why: "the user's rule (2026-10-15): with your field empty, summoning an attacker (ATK over DEF) and attacking is right almost always; you may hold no monster, or a weaker one",
    ai: [hand(C.celticGuardian), hand(C.lastWill)],
    opponent: Array.from({ length: 5 }, () => hand(C.mysticalElf)),
    aiSecond: true,
    aiDeck: DECKS.yugiEvolution.deck.main,
    seeds: 4,
    turn: true,
    expect: /summon Celtic Guardian.*attack with Celtic Guardian/,
  },
  {
    name: "set-the-wall",
    why: "the user's rule (2026-10-15): a wall (Giant Soldier of Stone, 1300/2000) is set in Defense Position, not summoned to attack",
    ai: [hand(C.giantSoldier), hand(C.lastWill)],
    opponent: Array.from({ length: 5 }, () => hand(C.mysticalElf)),
    aiSecond: true,
    aiDeck: DECKS.yugiEvolution.deck.main,
    seeds: 4,
    turn: true,
    expect: /set Giant Soldier of Stone/,
  },
  {
    name: "wall-attacks-for-lethal",
    why: "control for set-the-wall: at 1300 LP or less, Giant Soldier of Stone's direct attack wins",
    ai: [hand(C.giantSoldier), hand(C.lastWill)],
    opponent: Array.from({ length: 5 }, () => hand(C.mysticalElf)),
    aiSecond: true,
    aiDeck: DECKS.yugiEvolution.deck.main,
    lp: [8000, 1300],
    seeds: 4,
    turn: true,
    expect: /summon Giant Soldier of Stone.*attack with Giant Soldier of Stone/,
  },
  {
    name: "clear-the-set-card-first",
    why: "the user's rule (2026-10-15, report 1633241308: attacked with three monsters into a set card): remove a set card before attacking when possible, then attack",
    ai: [hand(C.mst), monster(C.celticGuardian, 0), monster(C.warriorDaiGrepher, 1), monster(C.mysticClown, 2)],
    opponent: [setCard(C.trapHole, 2), ...Array.from({ length: 4 }, () => hand(C.mysticalElf))],
    aiSecond: true,
    aiDeck: DECKS.yugiEvolution.deck.main,
    seeds: 4,
    turn: true,
    expect: /^(?:(?!attack with).)*activate Mystical Space Typhoon.*attack with/,
  },
  {
    name: "attack-through-a-set-card",
    why: "control for clear-the-set-card-first: without removal, a set card must not stop the attacks",
    ai: [monster(C.celticGuardian, 0), monster(C.warriorDaiGrepher, 1), monster(C.mysticClown, 2)],
    opponent: [setCard(C.trapHole, 2), ...Array.from({ length: 4 }, () => hand(C.mysticalElf))],
    aiSecond: true,
    aiDeck: DECKS.yugiEvolution.deck.main,
    seeds: 4,
    turn: true,
    expect: /attack with/,
  },
  {
    name: "summon-under-1600-next-to-a-monster",
    why: "user report 2026-10-15: kept Celtic Guardian (1400) in hand behind Warrior Dai Grepher; in the copies it always dies to the guessed 1600 attacker",
    ai: [hand(C.backupSoldier), hand(C.celticGuardian), hand(C.magicJammer), monster(C.warriorDaiGrepher, 0)],
    opponent: [
      monster(C.spiritRyu, 0, OcgPosition.FACEDOWN_DEFENSE), setCard(C.trapHole, 4),
      hand(C.mysticalElf), hand(C.mysticalElf), hand(C.mysticalElf), hand(C.mysticalElf),
    ],
    aiSecond: true,
    aiDeck: DECKS.yugiEvolution.deck.main,
    lp: [6800, 3700],
    plan: true,
    expect: /summon Celtic Guardian/,
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
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
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
    seat: aiSeat, brain: BRAINS[brainName]({ engine: { core, cards, readScript } }), duel,
    deck: aiDeck, onTrace: (e) => traces.push(e),
  });
  let choice: TraceEntry | null = null;
  let activated = false;
  /** The turn's main-phase and battle choices (turn checks). */
  const turnChoices: string[] = [];
  const aiTurn = p.aiSecond ? 2 : 1;
  for (let steps = 0; steps < (p.turn ? 300 : 50) && !choice; steps++) {
    const s = duel.advance();
    ai.observe(s.messages);
    if (s.ended) break;
    if (p.turn && ai.memory.turn > aiTurn) break;
    const prompt = s.prompt as typeof s.prompt & { player: number };
    if (prompt.player !== aiSeat) {
      const j = prompt.type === OcgMessageType.SELECT_CHAIN && !activated && ai.memory.turnPlayer === aiSeat ? prompt.selects.findIndex((c) => c.code === p.opponentActivates) : -1;
      if (j >= 0) { activated = true; duel.respond({ type: OcgResponseType.SELECT_CHAIN, index: j }); continue; }
      // Otherwise the opponent never does anything: passes chains, ends its turn, answers anything else with the first legal option.
      duel.respond(prompt.type === OcgMessageType.SELECT_CHAIN && !prompt.forced ? { type: OcgResponseType.SELECT_CHAIN, index: null }
        : prompt.type === OcgMessageType.SELECT_IDLECMD ? { type: OcgResponseType.SELECT_IDLECMD, action: SelectIdleCMDAction.TO_EP, index: null }
        : autoRespond(prompt, () => 0, cards));
      continue;
    }
    duel.respond(ai.decide(prompt));
    const last = traces[traces.length - 1];
    if (p.turn) {
      if (prompt.type === OcgMessageType.SELECT_IDLECMD || prompt.type === OcgMessageType.SELECT_BATTLECMD) {
        turnChoices.push(last.choice);
        firstTurnTrace ??= last;
      }
      continue;
    }
    if (p.checkChain ? activated && prompt.type === OcgMessageType.SELECT_CHAIN && prompt.selects.length > 0 : prompt.type === OcgMessageType.SELECT_IDLECMD) choice = last;
  }
  duel.destroy();
  if (p.turn) choice = firstTurnTrace;
  const planLine = choice && p.plan ? formatTrace(choice).split("\n").find((l) => l.includes("plan:"))?.trim() : undefined;
  const text = p.turn ? turnChoices.join(" → ") || "(no main-phase decision)" : planLine ?? choice?.choice ?? "(no main-phase decision)";
  const ok = !!choice && (!p.expect || p.expect.test(text)) && (!p.forbid || !p.forbid.test(text));
  if (!ok && p.known) known++;
  else if (!ok) failed++;
  const status = p.known ? (ok ? "now passes (drop `known`)" : `known (${p.known})`) : ok ? "ok  " : "FAIL";
  console.log(`${status} ${p.name}${p.seeds ? ` #${run}` : ""}: ${text}${ok ? "" : `   (${p.expect ? `expected ${p.expect}` : ""}${p.forbid ? ` forbidden ${p.forbid}` : ""}; ${p.why})`}`);
  if (show || (!ok && !p.known)) if (choice) console.log(formatTrace(choice).split("\n").slice(1).join("\n"));
  if (p.turn && (show || (!ok && !p.known)))
    for (const t of traces) console.log(`    ${formatTrace(t).split("\n")[0]}`);
}
const knownNote = known ? `, ${known} known misplay${known > 1 ? "s" : ""}` : "";
console.log(failed ? `${failed} of ${runs} runs failed${knownNote}` : `all ${runs - known} runs passed${knownNote} (${POSITIONS.length} positions, ${brainName})`);
if (failed) process.exit(1);
