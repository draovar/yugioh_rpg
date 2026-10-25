// The ai-bench positions (tools/ai/ai-bench.ts runs them): boards with a known right or wrong AI choice. Every
// misplay found in play becomes one (logged in docs/ai-reports.md).
import { OcgLocation, OcgPosition } from "ocgcore-wasm";
import type { StartCard } from "../../src/duel/engine/DuelSession.ts";
import { DECKS } from "../../src/duel/decks/decks.ts";

export const C = {
  zaborg: 51945556, mobius: 4929256, vorseRaider: 14898066, mysticalElf: 15025844, celticGuardian: 91152256,
  darkHole: 53129443, jinzo: 77585513, lordOfD: 17985575, darkMagicianGirl: 38033121, sangan: 26202165,
  potOfGreed: 55144522, compulsory: 94192409, darkMagician: 46986414, magicianOfFaith: 31560081,
  flute: 43973174, heavyStorm: 19613556, dnaTransplant: 56769674, fissure: 66788016, magicCylinder: 62279055,
  kuriboh: 40640057, gaia: 6368038, blueEyes: 89631139, smashingGround: 97169186,
  wingedDragon1: 87796900, axeOfDespair: 40619825, giantRat: 97017120,
  feralImp: 41392891, backupSoldier: 36280194, lastWill: 85602018, blackLusterRitual: 55761792, mysticTomato: 83011277,
  blackLusterSoldier: 5405694, disappear: 24623598, shift: 59560625, giantSoldier: 13039848, koumori: 67724379, madSwordBeast: 79870141,
  mysticClown: 47060154, mst: 5318639, magicJammer: 77414722, spiritRyu: 67957315, warriorDaiGrepher: 75953262, trapHole: 4206964, darkBlade: 11321183, neo: 50930991, laJinn: 97590747, summonedSkull: 70781052, opticlops: 14531242, justDesserts: 24068492, reliableGuardian: 16430187,
  battleOx: 5053103, skullRedBird: 10202894, mysticPlasmaZone: 18161786,
  wallOfIllusion: 13945283, soulExchange: 68005187, lusterDragon2: 17658803, fairyMeteorCrush: 97687912, burstBreath: 80163754,
  lightOfIntervention: 62867251, dianKeto: 84257639, changeOfHeart: 4031928,
  zombyra: 88472456, malevolentNuzzler: 99597615, sevenTools: 3819470, trapMaster: 46461247, paladinOfWhiteDragon: 73398797,
  noblemanOfCrossout: 71044499, removeTrap: 51482758, witchOfTheBlackForest: 78010363, mysteriousPuppeteer: 54098121,
  shadowSpell: 29267084, spellbindingCircle: 18807108, rushRecklessly: 70046172, hyozanryu: 62397231, snatchSteal: 45986603, swords: 72302403, sonicBird: 57617178,
  twinHeadedBehemoth: 43586926, regeneratingMummy: 70821187, boneTower: 63012333, stampingDestruction: 81385346,
  dragonsBead: 92408984, dragonsRage: 54178050, masterKyonshee: 24530661, ryuKokki: 57281778, reload: 22589918,
  armedDragonLv5: 46384672, blackDragonsChick: 36262024, maskedDragon: 39191307, callOfTheMummy: 4861205, vampireLady: 26495087, vampireGenesis: 22056710, armedDragonLv3: 980973, pyramidTurtle: 77044671, vampireLord: 53839837,
  coveringFire: 74458486, darkDustSpirit: 89111398, bookOfLife: 2204140, doubleCoston: 44436472, curseOfAnubis: 66742250,
  lusterDragon: 11091375, redEyes: 74677422, recklessGreed: 37576645, elementDragon: 30314994,
  uraby: 1784619, deSpell: 19159413, beaverWarrior: 32452818, jarOfGreed: 83968380, monsterReborn: 83764718, manEaterBug: 54652250,
} as const;

export interface Position {
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
  /** With `turn`: also list its card picks as "pick <cards>" (attack targets as "target <card>") and positions as "position <pos>". */
  picks?: boolean;
  /**
   * A known misplay waiting for a planned fix (docs/ai-rework-plan.md, e.g. "phase 2a"): reported as "known", not a
   * failure; when it passes, "now passes" says the flag can go.
   */
  known?: string;
  /** The opponent activates this card at the first chain prompt in the AI's turn that offers it... */
  opponentActivates?: number;
  /** ...and the check is on the AI's next chain answer after that (with something to chain), not a main-phase choice. */
  checkChain?: boolean;
  /** With opponentActivates: the card it targets, by the AI's zone (location, sequence); default its first choice. */
  opponentTargets?: { location: OcgLocation; sequence: number };
  /**
   * The AI goes first; in the opponent's turn after it they Set the first monster they can (their Normal Summon), go to
   * the Battle Phase and end the turn. The check is on the AI's chain answers in that turn (with something to chain),
   * joined by " → ".
   */
  opponentSetsThenBattles?: boolean;
  /**
   * The AI goes first; in the opponent's turn after it they go to the Battle Phase and attack with the monsters in these
   * zones, in this order (each at the first target offered, or directly), then end the turn. The check is on the AI's
   * chain answers (and positions, "position <pos>") in that turn, as with opponentSetsThenBattles.
   */
  opponentAttacks?: number[];
}

const hand = (code: number): StartCard => ({ code, location: OcgLocation.HAND });
const monster = (code: number, sequence = 0, position: OcgPosition = OcgPosition.FACEUP_ATTACK): StartCard =>
  ({ code, location: OcgLocation.MZONE, sequence, position });
/** A card in the Graveyard; list them oldest first. */
const grave = (code: number): StartCard => ({ code, location: OcgLocation.GRAVE, position: OcgPosition.FACEUP_ATTACK });
const setCard = (code: number, sequence = 0): StartCard => ({ code, location: OcgLocation.SZONE, sequence, position: OcgPosition.FACEDOWN_DEFENSE });
/** A face-up Equip Spell in zone `sequence`, equipped to the monster in zone `to` of duel team `team`. */
const equip = (code: number, sequence: number, to: number, team: 0 | 1): StartCard =>
  ({ code, location: OcgLocation.SZONE, sequence, equipTo: { team, sequence: to } });
/** A face-up persistent Trap in zone `sequence` targeting the monster in zone `to` of duel team `team` (Shadow Spell...). */
const lock = (code: number, sequence: number, to: number, team: 0 | 1): StartCard =>
  ({ code, location: OcgLocation.SZONE, sequence, position: OcgPosition.FACEUP_ATTACK, cardTargets: [{ team, sequence: to }] });

export const POSITIONS: Position[] = [
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
  {
    name: "probe-a-set-monster-above-2000",
    why: "review 2026-10-16 (seed 104 T7): Sonic Bird (1400) bounced off a set Mystic Horseman next to Zombyra; user: the weakest attacker over 2000 attacks a set monster first",
    ai: [monster(C.gaia, 0), monster(C.blueEyes, 1), monster(C.darkBlade, 2)],
    opponent: [monster(C.giantSoldier, 0, OcgPosition.FACEDOWN_DEFENSE)],
    aiSecond: true,
    turn: true,
    expect: /^(?:(?!attack with).)*attack with Gaia/,
  },
  {
    name: "probe-a-set-monster-with-the-strongest",
    why: "user 2026-10-16: with every attacker under 2000, the strongest attacks a set monster first",
    ai: [monster(C.celticGuardian, 0), monster(C.darkBlade, 1), monster(C.mysticTomato, 2)],
    opponent: [monster(C.giantSoldier, 0, OcgPosition.FACEDOWN_DEFENSE)],
    aiSecond: true,
    turn: true,
    expect: /^(?:(?!attack with).)*attack with Dark Blade/,
  },
  {
    name: "probe-a-set-monster-alone",
    why: "user 2026-10-16: a lone Mystic Tomato may attack a set monster (it might be weaker)",
    ai: [monster(C.mysticTomato, 0)],
    opponent: [monster(C.giantSoldier, 0, OcgPosition.FACEDOWN_DEFENSE)],
    aiSecond: true,
    turn: true,
    expect: /attack with Mystic Tomato/,
  },
  {
    name: "no-blind-attack-at-low-lp",
    why: "user 2026-10-16: at 500 LP, bouncing Mystic Tomato off a 2000 DEF wall loses the duel, so don't attack a set monster",
    ai: [monster(C.mysticTomato, 0)],
    opponent: [monster(C.giantSoldier, 0, OcgPosition.FACEDOWN_DEFENSE)],
    aiSecond: true,
    lp: [500, 8000],
    turn: true,
    forbid: /attack with/,
  },
  {
    name: "tribute-for-blue-eyes",
    why: "review 2026-10-16 (seed 101 T7): with two Mystic Tomatoes (1900 under Mystic Plasma Zone) facing Mystic Clown (2000), summoned Battle Ox in defense instead of Blue-Eyes: two 1900 monsters counted more than one 3000 one",
    ai: [monster(C.mysticTomato, 0), monster(C.mysticTomato, 1), hand(C.blueEyes), hand(C.blueEyes), hand(C.battleOx), hand(C.skullRedBird)],
    opponent: [
      monster(C.giantSoldier, 0, OcgPosition.FACEUP_DEFENSE), monster(C.mysticalElf, 1, OcgPosition.FACEUP_DEFENSE), monster(C.mysticClown, 2),
      { code: C.mysticPlasmaZone, location: OcgLocation.SZONE, sequence: 5, position: OcgPosition.FACEUP_ATTACK },
      hand(C.mysticalElf),
    ],
    aiSecond: true,
    aiDeck: DECKS.kaibaEvolution.deck.main,
    plan: true,
    expect: /plan: summon Blue-Eyes White Dragon/,
  },
  {
    name: "soul-exchange-for-luster-dragon",
    why: "review 2026-10-16 (seed 103 T6): set Soul Exchange and Mystic Tomato instead of Soul Exchange on Wall of Illusion + Axe → Luster Dragon #2; Soul Exchange alone loses (empty field), so the beam dropped it before the summon it enables",
    ai: [
      hand(C.fairyMeteorCrush), hand(C.mysticTomato), hand(C.opticlops), hand(C.lusterDragon2), hand(C.soulExchange),
      { code: C.lightOfIntervention, location: OcgLocation.SZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK }, setCard(C.burstBreath, 1),
    ],
    opponent: [
      monster(C.wallOfIllusion, 0), monster(C.giantRat, 1), monster(C.giantSoldier, 2, OcgPosition.FACEUP_DEFENSE), equip(C.axeOfDespair, 0, 0, 0),
      hand(C.darkHole), hand(C.celticGuardian), hand(C.changeOfHeart), hand(C.dianKeto),
    ],
    aiSecond: true,
    aiDeck: DECKS.kaibaEvolution.deck.main,
    lp: [4050, 8000],
    plan: true,
    expect: /plan: activate Soul Exchange (on [^→]* )?→ summon Luster Dragon #2/,
  },
  {
    name: "summon-to-attack-defenders",
    why: "review 2026-10-16 (seed 101 T8): Neo the Magic Swordsman (1700) went to defense ('can't win fights', a position prompt from Light of Intervention) facing only Defense Position monsters it beats; user: summon it in attack and destroy the strongest one it can",
    ai: [hand(C.neo)],
    opponent: [
      monster(C.mysticTomato, 0, OcgPosition.FACEUP_DEFENSE), monster(C.battleOx, 1, OcgPosition.FACEUP_DEFENSE),
      // Light of Intervention face-up: summons ask for a position (in the duel it was Kaiba's)
      { code: C.lightOfIntervention, location: OcgLocation.SZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK },
      hand(C.mysticalElf), hand(C.mysticalElf),
    ],
    aiSecond: true,
    aiDeck: DECKS.yugiEvolution.deck.main,
    turn: true,
    expect: /summon Neo the Magic Swordsman.*attack with Neo the Magic Swordsman/,
  },  {
    name: "no-attack-position-into-lethal",
    why: "user 2026-10-16: Neo (1700) could destroy a Defense Position Sangan, but Blue-Eyes would then hit it for 1300 = the AI's LP: defense",
    ai: [hand(C.neo)],
    opponent: [
      monster(C.blueEyes, 0), monster(C.sangan, 1, OcgPosition.FACEUP_DEFENSE),
      { code: C.lightOfIntervention, location: OcgLocation.SZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK },
      hand(C.mysticalElf), hand(C.mysticalElf),
    ],
    aiSecond: true,
    aiDeck: DECKS.yugiEvolution.deck.main,
    lp: [1300, 8000],
    turn: true,
    forbid: /attack with/,
  },
  {
    name: "attack-position-when-it-survives",
    why: "control for no-attack-position-into-lethal: at 8000 LP Neo goes to attack and destroys Sangan",
    ai: [hand(C.neo)],
    opponent: [
      monster(C.blueEyes, 0), monster(C.sangan, 1, OcgPosition.FACEUP_DEFENSE),
      { code: C.lightOfIntervention, location: OcgLocation.SZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK },
      hand(C.mysticalElf), hand(C.mysticalElf),
    ],
    aiSecond: true,
    aiDeck: DECKS.yugiEvolution.deck.main,
    lp: [8000, 8000],
    turn: true,
    expect: /summon Neo the Magic Swordsman.*attack with Neo the Magic Swordsman/,
  },  {
    name: "attack-with-the-stronger-not-the-wall",
    why: "review 2026-10-16 (seed 104 T3): next to Zombyra (2800 with Malevolent Nuzzler) facing a set monster, Normal Summoned Giant Soldier of Stone (1300/2000) to attack and kept Winged Dragon #1 (1400); Battle Ox killed the Soldier next turn",
    ai: [
      monster(C.zombyra, 0), equip(C.malevolentNuzzler, 1, 0, 1), setCard(C.sevenTools, 0),
      hand(C.giantSoldier), hand(C.feralImp), hand(C.wingedDragon1),
    ],
    opponent: [
      monster(C.trapMaster, 0, OcgPosition.FACEDOWN_DEFENSE), setCard(C.trapHole, 0),
      hand(C.paladinOfWhiteDragon), hand(C.noblemanOfCrossout), hand(C.battleOx),
    ],
    aiSecond: true,
    aiDeck: DECKS.yugiEvolution.deck.main,
    plan: true,
    expect: /plan: summon Winged Dragon/,
  },
  {
    name: "free-the-locked-monster-for-lethal",
    why: "review 2026-10-16 (seed 105 T14): Summoned Skull under the opponent's Shadow Spell, Remove Trap in hand, the opponent at 800 LP with Witch of the Black Forest (1100) in attack; the copies lost Shadow Spell's lock, every plan 'won', and Remove Trap went off in Main 2",
    ai: [monster(C.summonedSkull, 0), monster(C.kuriboh, 2, OcgPosition.FACEUP_DEFENSE), hand(C.removeTrap)],
    opponent: [
      monster(C.mysteriousPuppeteer, 0, OcgPosition.FACEUP_DEFENSE), monster(C.witchOfTheBlackForest, 1), lock(C.shadowSpell, 2, 0, 1),
      hand(C.blueEyes), hand(C.mysticalElf),
    ],
    aiSecond: true,
    aiDeck: DECKS.yugiEvolution.deck.main,
    lp: [7800, 800],
    turn: true,
    expect: /activate Remove Trap.*attack with Summoned Skull/,
  },
  {
    name: "mst-the-circle",
    why: "review 2026-10-16 (seed 106 T7-T9): with Battle Ox under the opponent's Spellbinding Circle, the copies' Ox attacked anyway (plans scored as wins, T9 turned both Mystic Tomatoes to defense); here: free it with MST for lethal",
    ai: [monster(C.battleOx, 0), hand(C.mst)],
    opponent: [lock(C.spellbindingCircle, 1, 0, 1), hand(C.mysticalElf), hand(C.mysticalElf), hand(C.mysticalElf)],
    aiSecond: true,
    aiDeck: DECKS.kaibaEvolution.deck.main,
    lp: [8000, 1700],
    turn: true,
    expect: /activate Mystical Space Typhoon.*attack with Battle Ox/,
  },
  {
    name: "trade-then-attack-for-lethal",
    why: "review 2026-10-16 (seed 105 T12): the opponent at 300 LP behind Mysterious Puppeteer (1000, attack); Sangan (1000) trading with it lets Kuriboh (300) attack directly for lethal, but the battle logic never trades equal monsters: no attack",
    ai: [
      monster(C.summonedSkull, 0), monster(C.kuriboh, 2), monster(C.sangan, 3),
      setCard(C.trapHole, 0), setCard(C.reliableGuardian, 1),
    ],
    opponent: [
      monster(C.mysteriousPuppeteer, 0), lock(C.shadowSpell, 2, 0, 1), setCard(C.rushRecklessly, 3),
      hand(C.hyozanryu), hand(C.blueEyes),
    ],
    aiSecond: true,
    aiDeck: DECKS.yugiEvolution.deck.main,
    lp: [7800, 300],
    turn: true,
    expect: /attack with Sangan.*attack with Kuriboh/,
  },
  {
    name: "no-even-trade-without-lethal",
    why: "control for trade-then-attack-for-lethal: at 2000 LP the trade wins nothing, Sangan stays",
    ai: [
      monster(C.summonedSkull, 0), monster(C.kuriboh, 2), monster(C.sangan, 3),
      setCard(C.trapHole, 0), setCard(C.reliableGuardian, 1),
    ],
    opponent: [
      monster(C.mysteriousPuppeteer, 0), lock(C.shadowSpell, 2, 0, 1), setCard(C.rushRecklessly, 3),
      hand(C.hyozanryu), hand(C.blueEyes),
    ],
    aiSecond: true,
    aiDeck: DECKS.yugiEvolution.deck.main,
    lp: [7800, 2000],
    turn: true,
    forbid: /attack with Sangan/,
  },
  {
    name: "equip-our-own-monster",
    why: "review 2026-10-16 (seed 108 T4): equipped Fairy Meteor Crush to the opponent's Giant Rat (the select logic counted an equip as good for whoever owns the monster); here Axe of Despair belongs on Celtic Guardian (2400 beats La Jinn), not on La Jinn",
    ai: [monster(C.celticGuardian, 0), hand(C.axeOfDespair)],
    opponent: [monster(C.laJinn, 1), hand(C.mysticalElf), hand(C.mysticalElf)],
    aiSecond: true,
    aiDeck: DECKS.yugiEvolution.deck.main,
    turn: true,
    picks: true,
    expect: /activate Axe of Despair → pick Celtic Guardian.*attack with Celtic Guardian/,
  },
  {
    name: "snatch-their-best",
    why: "control for equip-our-own-monster: an equip that only fits their monsters (Snatch Steal) takes their best",
    ai: [hand(C.snatchSteal)],
    opponent: [monster(C.mysticalElf, 0, OcgPosition.FACEUP_DEFENSE), monster(C.blueEyes, 1), hand(C.mysticalElf)],
    aiSecond: true,
    aiDeck: DECKS.yugiEvolution.deck.main,
    turn: true,
    picks: true,
    expect: /activate Snatch Steal → pick Blue-Eyes White Dragon/,
  },
  {
    name: "no-attack-position-under-swords",
    why: "review 2026-10-16 (seed 107 T14): with Light of Intervention up (summons ask for a position), La Jinn (1800) went to Attack Position 'it can destroy one of theirs' (Sonic Bird, 1400) though the opponent's Swords of Revealing Light stopped every attack; Summoned Skull (3500) killed it next turn for 1700",
    ai: [{ code: C.lightOfIntervention, location: OcgLocation.SZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK }, hand(C.laJinn)],
    opponent: [
      monster(C.summonedSkull, 0), monster(C.sonicBird, 1),
      { code: C.swords, location: OcgLocation.SZONE, sequence: 2, position: OcgPosition.FACEUP_ATTACK },
      hand(C.mysticalElf),
    ],
    aiSecond: true,
    aiDeck: DECKS.kaibaEvolution.deck.main,
    turn: true,
    picks: true,
    forbid: /position face-up attack/,
  },
  {
    name: "de-spell-the-swords",
    why: "review 2026-10-16 (seed 109 T12-T16): under Swords of Revealing Light Kaiba held De-Spell for three turns; in every copy the pick rule aimed it at the set card (Seven Tools, a Trap: nothing happens), never at Swords, so it never freed Luster Dragon #2 (2400) to destroy Zombyra (2100)",
    ai: [monster(C.lusterDragon2, 0), hand(C.deSpell)],
    opponent: [
      monster(C.zombyra, 0), monster(C.beaverWarrior, 1),
      { code: C.swords, location: OcgLocation.SZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK }, setCard(C.sevenTools, 1),
      hand(C.mysticalElf),
    ],
    aiSecond: true,
    aiDeck: DECKS.kaibaEvolution.deck.main,
    turn: true,
    picks: true,
    expect: /activate De-Spell → pick Swords of Revealing Light.*attack with Luster Dragon #2/,
  },
  {
    name: "jar-answers-mst",
    why: "review 2026-10-16 (seed 109 T6-T13, Jar of Greed held 7 turns): user question, does a set Jar at least answer a Mystical Space Typhoon on it?",
    ai: [monster(C.uraby, 0), setCard(C.jarOfGreed, 0)],
    opponent: [setCard(C.mst, 0), hand(C.mysticalElf), hand(C.mysticalElf)],
    aiDeck: DECKS.kaibaEvolution.deck.main,
    opponentActivates: C.mst,
    checkChain: true,
    expect: /^chain Jar of Greed/,
  },
  {
    name: "jar-answers-mst-next-to-another-set-card",
    why: "as jar-answers-mst, with a set Monster Reborn in the zone before it: the replay copy must aim MST at the card the opponent really targeted (the Jar), not its own guess",
    ai: [monster(C.uraby, 0), setCard(C.monsterReborn, 0), setCard(C.jarOfGreed, 1)],
    opponent: [setCard(C.mst, 0), hand(C.mysticalElf), hand(C.mysticalElf)],
    aiDeck: DECKS.kaibaEvolution.deck.main,
    opponentActivates: C.mst,
    opponentTargets: { location: OcgLocation.SZONE, sequence: 1 },
    checkChain: true,
    expect: /^chain Jar of Greed/,
  },
  {
    name: "attack-the-open-field",
    why: "review 2026-10-16 (seed 109 T3): facing an empty field (only a set card), Yugi turned Giant Soldier of Stone to defense and set Man-Eater Bug: no attack, though Giant Soldier (1300) and a summoned Giant Rat (1400) could hit for 2700. The copies' one guessed 1600 attacker walked into Man-Eater Bug in the defensive line and dominated the board in the attack line; fixed by `guessDominance` 0.5",
    ai: [monster(C.giantSoldier, 0), hand(C.manEaterBug), hand(C.mysticalElf), hand(C.beaverWarrior), hand(C.giantRat)],
    opponent: [setCard(C.rushRecklessly, 0), hand(C.mysticalElf), hand(C.mysticalElf), hand(C.mysticalElf), hand(C.mysticalElf)],
    aiSecond: true,
    aiDeck: DECKS.yugiEvolution.deck.main,
    lp: [7850, 8000],
    turn: true,
    expect: /attack with/,
  },
  {
    name: "no-boost-when-nothing-attacks",
    why: "review 2026-10-16 (seed 109 T5): Rush Recklessly chained at the start of the opponent's Battle Phase with nothing able to attack; the replay copy gave them a second Normal Summon in Main 2 (summoned face-up vs Uraby 1500, set vs Uraby 2200), which made the boost look like a gain",
    ai: [monster(C.uraby, 0), setCard(C.rushRecklessly, 0), hand(C.mysticalElf)],
    opponent: [monster(C.giantSoldier, 0, OcgPosition.FACEUP_DEFENSE), hand(C.giantRat), hand(C.mysticalElf), hand(C.mysticalElf)],
    aiDeck: DECKS.kaibaEvolution.deck.main,
    opponentSetsThenBattles: true,
    forbid: /chain Rush Recklessly/,
  },
  {
    name: "no-suicide-when-every-plan-loses",
    why: "review 2026-10-16 (seed 112 T11): at 600 LP every plan lost; dying in our own turn scored -1000 flat, dying in theirs -1000 + a negative board, so the AI used Stamping Destruction on its own Dragon's Bead (500 damage to itself) and attacked; its battle logic aimed at Soul-Absorbing Bone Tower, which can't be attacked while another Zombie is out, and the target prompt fell back to Regenerating Mummy (1800). Behemoth in defense survives Mummy + Bone Tower at 200 LP",
    ai: [
      monster(C.twinHeadedBehemoth, 0, OcgPosition.FACEUP_DEFENSE), hand(C.stampingDestruction),
      { code: C.dragonsBead, location: OcgLocation.SZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK }, { code: C.dragonsRage, location: OcgLocation.SZONE, sequence: 1, position: OcgPosition.FACEUP_ATTACK },
    ],
    opponent: [monster(C.regeneratingMummy, 0), monster(C.boneTower, 1), hand(C.mysticalElf)],
    aiSecond: true,
    aiDeck: DECKS.dragonsRoar.deck.main,
    lp: [600, 8000],
    turn: true,
    picks: true,
    forbid: /activate Stamping Destruction|target Regenerating Mummy/,
  },
  {
    name: "set-compulsory-evacuation",
    why: "review 2026-10-16 (seed 113 T1; also 111 T5, 112 T8 + T10, 114 T2): Compulsory Evacuation Device kept in hand, setting it scored 0.3-2.3 lower; here Master Kyonshee + set CED scored 3.35, Kyonshee alone 3.72",
    ai: [hand(C.masterKyonshee), hand(C.compulsory), hand(C.ryuKokki), hand(C.reload), hand(C.vampireLady), hand(C.vampireGenesis)],
    opponent: [hand(C.noblemanOfCrossout), hand(C.stampingDestruction), hand(C.armedDragonLv3), hand(C.stampingDestruction), hand(C.snatchSteal)],
    aiDeck: DECKS.zombieMadness.deck.main,
    turn: true,
    expect: /set Compulsory Evacuation Device/,
  },
  {
    name: "set-compulsory-before-the-level-up",
    why: "review 2026-10-16 (seed 111 T5): Pyramid Turtle alone facing Armed Dragon LV3 (LV5, 2400, in their Standby Phase) and Twin-Headed Behemoth; Compulsory Evacuation Device kept in hand in Main 2 (set -0.07, hold 0.30); next turn LV5 and LV3 hit for 1600 more",
    ai: [monster(C.pyramidTurtle, 0, OcgPosition.FACEUP_DEFENSE), hand(C.compulsory), hand(C.vampireLord)],
    opponent: [
      monster(C.armedDragonLv3, 0), monster(C.twinHeadedBehemoth, 1, OcgPosition.FACEUP_DEFENSE),
      { code: C.dragonsRage, location: OcgLocation.SZONE, sequence: 1, position: OcgPosition.FACEUP_ATTACK }, setCard(C.coveringFire, 2),
      hand(C.armedDragonLv3), hand(C.stampingDestruction), hand(C.snatchSteal),
    ],
    aiSecond: true,
    aiDeck: DECKS.zombieMadness.deck.main,
    lp: [6500, 6000],
    turn: true,
    expect: /set Compulsory Evacuation Device/,
  },
  {
    name: "no-extra-moves-for-lethal",
    why: "review 2026-10-16 (seed 112 T6): Luster Dragon (taken with Snatch Steal), Regenerating Mummy and Double Coston were lethal (5400 into 2800 LP); every winning plan tied and the tie-break (more damage: 4000 vs 3700) chose Dark Dust Spirit, which destroyed our own monsters, then Book of Life; the set Curse of Anubis stopped the attack and the board was gone",
    ai: [
      monster(C.regeneratingMummy, 1), monster(C.doubleCoston, 2), equip(C.snatchSteal, 0, 0, 0),
      hand(C.darkDustSpirit), hand(C.vampireGenesis), hand(C.bookOfLife),
      grave(C.recklessGreed), grave(C.mst),
    ],
    // Their Luster Dragon, taken by our Snatch Steal (which heals them 1000 in their Standby Phase: 1800 -> 2800).
    opponent: [
      monster(C.lusterDragon, 0), setCard(C.curseOfAnubis, 0),
      { code: C.dragonsRage, location: OcgLocation.SZONE, sequence: 1, position: OcgPosition.FACEUP_ATTACK },
      hand(C.redEyes), hand(C.stampingDestruction), hand(C.noblemanOfCrossout),
      grave(C.dragonsRage), grave(C.elementDragon),
    ],
    aiSecond: true,
    aiDeck: DECKS.zombieMadness.deck.main,
    lp: [8000, 1800],
    turn: true,
    expect: /attack with/,
    forbid: /summon Dark Dust Spirit|activate Book of Life/,
  },
  {
    name: "curse-of-anubis-against-lethal",
    why: "seed 112 replay T6 (2026-10-17): at 2800 LP Luster Dragon hit for 1900, then Regenerating Mummy's attack was lethal; Curse of Anubis (Effect Monsters to Defense) would have stopped it, but the chain replay restarted their turn and let Luster Dragon attack again, so every answer lost (+0.00)",
    ai: [setCard(C.curseOfAnubis, 0), { code: C.dragonsRage, location: OcgLocation.SZONE, sequence: 1, position: OcgPosition.FACEUP_ATTACK }, hand(C.redEyes), hand(C.stampingDestruction), hand(C.noblemanOfCrossout)],
    opponent: [monster(C.lusterDragon, 0), monster(C.regeneratingMummy, 1), monster(C.doubleCoston, 2), hand(C.darkDustSpirit), hand(C.vampireGenesis), hand(C.bookOfLife)],
    aiDeck: DECKS.dragonsRoar.deck.main,
    lp: [2800, 8000],
    opponentAttacks: [0, 1, 2],
    expect: /chain Curse of Anubis/,
  },
  {
    name: "stamping-takes-back-the-luster",
    why: "review 2026-10-16 (seed 112 T3): the opponent's Snatch Steal held our Luster Dragon next to Regenerating Mummy; summoning Element Dragon face-up allows Stamping Destruction on Snatch Steal (Luster back, 500 damage); the AI set Element Dragon (the copies rebuilt the stolen Luster Dragon as the opponent's own card, so destroying Snatch Steal gave nothing back)",
    // Our Luster Dragon, taken by their Snatch Steal (which heals us 1000 in our Standby Phase: 4300 -> 5300).
    ai: [
      monster(C.lusterDragon, 0),
      { code: C.dragonsRage, location: OcgLocation.SZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK },
      { code: C.dragonsRage, location: OcgLocation.SZONE, sequence: 1, position: OcgPosition.FACEUP_ATTACK },
      hand(C.elementDragon), hand(C.redEyes), hand(C.stampingDestruction), hand(C.noblemanOfCrossout),
    ],
    opponent: [
      monster(C.regeneratingMummy, 1), equip(C.snatchSteal, 0, 0, 1),
      hand(C.darkDustSpirit), hand(C.vampireGenesis), hand(C.doubleCoston), hand(C.mst), hand(C.bookOfLife),
      grave(C.recklessGreed),
    ],
    aiSecond: true,
    aiDeck: DECKS.dragonsRoar.deck.main,
    lp: [4300, 8000],
    turn: true,
    picks: true,
    expect: /summon Element Dragon.*activate Stamping Destruction → pick Snatch Steal.*attack with Luster Dragon/,
  },
  {
    name: "ryu-kokki-blocks-in-attack",
    why: "review 2026-10-16 (seed 111 T6): Twin-Headed Behemoth destroyed Pyramid Turtle, whose Ryu Kokki (2400/2000) came out in Defense ('can't win fights': 2400 doesn't beat Armed Dragon LV5's 2400); LV5 destroyed it with Dragon's Rage piercing for 400 and LV3 went direct for 1200. In Attack Position LV5 only trades and LV3 can't attack",
    ai: [monster(C.pyramidTurtle, 0, OcgPosition.FACEUP_DEFENSE)],
    opponent: [
      monster(C.armedDragonLv5, 0), monster(C.twinHeadedBehemoth, 1), monster(C.armedDragonLv3, 2),
      { code: C.dragonsRage, location: OcgLocation.SZONE, sequence: 1, position: OcgPosition.FACEUP_ATTACK },
      hand(C.armedDragonLv3),
    ],
    aiDeck: DECKS.zombieMadness.deck.main,
    lp: [6500, 6000],
    opponentAttacks: [1, 0, 2],
    expect: /position face-up attack/,
  },
  {
    name: "ryu-kokki-defends-against-blue-eyes",
    why: "control for ryu-kokki-blocks-in-attack: the attacker left is Blue-Eyes (3000) and nothing pierces, so Ryu Kokki dies either way and Defense saves the 600 damage",
    ai: [monster(C.pyramidTurtle, 0, OcgPosition.FACEUP_DEFENSE)],
    opponent: [monster(C.blueEyes, 0), monster(C.twinHeadedBehemoth, 1), hand(C.armedDragonLv3)],
    aiDeck: DECKS.zombieMadness.deck.main,
    lp: [6500, 6000],
    opponentAttacks: [1, 0],
    expect: /position face-up defense/,
  },
  {
    name: "attack-with-the-stolen-masked-dragon",
    why: "review 2026-10-16 (seed 111 T3): Snatch Steal on Masked Dragon (1400) with their field empty, then turned it to Defense instead of attacking directly (1400 more damage); Armed Dragon LV3 (1200) destroyed it next turn, in Attack Position it would have survived",
    ai: [
      monster(C.pyramidTurtle, 0, OcgPosition.FACEUP_DEFENSE), setCard(C.magicJammer, 0),
      hand(C.snatchSteal), hand(C.regeneratingMummy), hand(C.masterKyonshee), hand(C.vampireLord), hand(C.callOfTheMummy),
    ],
    opponent: [
      monster(C.maskedDragon, 0), setCard(C.recklessGreed, 0), setCard(C.dragonsRage, 1), setCard(C.coveringFire, 2),
      hand(C.armedDragonLv3), hand(C.armedDragonLv3),
    ],
    aiSecond: true,
    aiDeck: DECKS.zombieMadness.deck.main,
    turn: true,
    picks: true,
    expect: /activate Snatch Steal → pick Masked Dragon.*attack with Masked Dragon/,
    known: "opponent model: in the copies their stand-in attacks Pyramid Turtle when Masked Dragon is in Defense, which hands us Ryu Kokki",
  },
  {
    name: "no-reload-on-a-guessed-draw",
    why: "review 2026-10-16 (seed 113 T4): with Masked Dragon, Element Dragon and Armed Dragon LV5 in hand (Curse of Anubis set) facing Ryu Kokki and Vampire Lady, Dragon played its second Reload because the copy's guessed draw had Luster Dragon (-5.42 vs -7.86 for setting Masked Dragon); it drew LV5, Creature Swap and Stamping Destruction and ended with an empty field. Fixed by scoring plans that draw over 4 orders of our Deck, each played on by the generic brain",
    ai: [
      setCard(C.curseOfAnubis, 0),
      hand(C.reload), hand(C.maskedDragon), hand(C.elementDragon), hand(C.armedDragonLv5),
      grave(C.recklessGreed), grave(C.snatchSteal), grave(C.blackDragonsChick), grave(C.reload),
    ],
    opponent: [
      monster(C.ryuKokki, 0), monster(C.vampireLady, 1), setCard(C.compulsory, 0),
      { code: C.callOfTheMummy, location: OcgLocation.SZONE, sequence: 1, position: OcgPosition.FACEUP_ATTACK },
      hand(C.reload), hand(C.vampireGenesis), grave(C.masterKyonshee),
    ],
    aiSecond: true,
    aiDeck: DECKS.dragonsRoar.deck.main,
    lp: [5800, 7250],
    seeds: 8,
    turn: true,
    // The misplay was shuffling away the only monster we could put on the field; a Reload after Masked Dragon is out
    // (swapping Element Dragon and a stuck LV5) is a fair gamble.
    expect: /^(?:(?!activate Reload).)*(summon|set) Masked Dragon/,
  },
  {
    name: "reload-a-stuck-hand",
    why: "control for no-reload-on-a-guessed-draw: with only Red-Eyes Black Dragon twice and Armed Dragon LV5 (no monster to tribute), Reload's average draw is worth more than the hand",
    ai: [hand(C.reload), hand(C.redEyes), hand(C.redEyes), hand(C.armedDragonLv5)],
    opponent: [monster(C.ryuKokki, 0), monster(C.vampireLady, 1), hand(C.reload), hand(C.vampireGenesis)],
    aiSecond: true,
    aiDeck: DECKS.dragonsRoar.deck.main,
    lp: [5800, 7250],
    seeds: 4,
    turn: true,
    expect: /activate Reload/,
  },
];
