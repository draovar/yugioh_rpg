// Prebuilt decks (NPCs, the AI, starting points in the deck editor). Every card must be in data/pool.json (the smoke tests check).
import { TYPE, type CardDb } from "../engine/cardData.ts";
import type { Deck } from "../engine/DuelSession.ts";
import { DECK_RULES } from "./deckRules.ts";

/** Passcodes of the cards the decks use, by name. */
const C = {
  // monsters
  blueEyes: 89631139, darkMagician: 46986414, summonedSkull: 70781052, celticGuardian: 91152256, geminiElf: 69140098,
  vorseRaider: 14898066, laJinn: 97590747, sangan: 26202165, blackLuster: 72989439, chaosSorcerer: 9596126,
  breaker: 71413901, jinzo: 77585513, airknight: 18036057, tsukuyomi: 34853266, magicianOfFaith: 31560081,
  morphingJar: 33508719, sinisterSerpent: 8131171, spiritReaper: 23205979, exiledForce: 74131780, ddWarriorLady: 7572887,
  asuraPriest: 2134346, abyssSoldier: 18318842, zaborg: 51945556, mobius: 4929256, cyberJar: 34124316,
  nightAssailant: 16226786, mysticTomato: 83011277, witch: 78010363, darkMagicianGirl: 38033121,
  skilledDarkMagician: 73752131, kuriboh: 40640057, lordOfD: 17985575, mysticalElf: 15025844, gaia: 6368038,
  tribeInfectingVirus: 33184167, battleOx: 5053103, koumoriDragon: 67724379, rogueDoll: 91939608, kojikocy: 1184620,
  uraby: 1784619, mysticHorseman: 68516705, ryuKishinPowered: 24611934, skullRedBird: 10202894, hyozanryu: 62397231,
  opticlops: 14531242, dragonDwellingInTheCave: 93346024, lusterDragon2: 17658803, kaiserSeaHorse: 17444133,
  mysteriousPuppeteer: 54098121, trapMaster: 46461247, haneHane: 7089711, madSwordBeast: 79870141, spiritRyu: 67957315,
  manEaterBug: 54652250, giantRat: 97017120, feralImp: 41392891, wingedDragon1: 87796900, beaverWarrior: 32452818,
  greatWhite: 13429800, giantSoldierOfStone: 13039848, mysticClown: 47060154, neo: 50930991, gazelle: 5818798,
  warriorDaiGrepher: 75953262, darkBlade: 11321183, wallOfIllusion: 13945283, sonicBird: 57617178,
  zombyra: 88472456, royalMagicalLibrary: 70791313, vampireGenesis: 22056710, masterKyonshee: 24530661,
  vampireLord: 53839837, darkDustSpirit: 89111398, pyramidTurtle: 77044671, despairFromTheDark: 71200730,
  ryuKokki: 57281778, boneTower: 63012333, vampireLady: 26495087, doubleCoston: 44436472, regeneratingMummy: 70821187,
  redEyes: 74677422, redEyesDarkness: 96561011, lusterDragon: 11091375, twinHeadedBehemoth: 43586926,
  armedDragonLv3: 980973, armedDragonLv5: 46384672, redEyesChick: 36262024, elementDragon: 30314994,
  maskedDragon: 39191307, mirageDragon: 15960641,
  // rituals
  paladinOfWhiteDragon: 73398797, blackLusterSoldier: 5405694,
  // fusions (Extra Deck)
  thousandEyesRestrict: 63519819, blueEyesUltimate: 23995346,
  // spells
  potOfGreed: 55144522, darkHole: 53129443, raigeki: 12580477, monsterReborn: 83764718, mst: 5318639,
  changeOfHeart: 4031928, swords: 72302403, heavyStorm: 19613556, scapegoat: 73915051, gracefulCharity: 79571449,
  delinquentDuo: 44763025, snatchSteal: 45986603, prematureBurial: 70828912, nobleman: 71044499, bookOfMoon: 14087893,
  smashingGround: 97169186, enemyController: 98045062, brainControl: 87910978, confiscation: 17375316,
  metamorphosis: 46411259, shrink: 55713623, fissure: 66788016, polymerization: 24094653, flute: 43973174,
  sixthSense: 3280747, dnaTransplant: 56769674, whiteDragonRitual: 9786492, deSpell: 19159413, soulExchange: 68005187,
  tributeToTheDoomed: 79759861, rushRecklessly: 70046172, megamorph: 22046459, fairyMeteorCrush: 97687912,
  blackLusterRitual: 55761792, dianKeto: 84257639, lastWill: 85602018, cardDestruction: 72892473, removeTrap: 51482758,
  reliableGuardian: 16430187, axeOfDespair: 40619825, malevolentNuzzler: 99597615, mysticPlasmaZone: 18161786,
  creatureSwap: 31036355, giantTrunade: 42703248, cardOfSafeReturn: 57953380, bookOfLife: 2204140,
  callOfTheMummy: 4861205, reload: 22589918, stampingDestruction: 81385346,
  // traps
  mirrorForce: 44095762, sakuretsu: 56120475, trapHole: 4206964, callOfTheHaunted: 97077563, ringOfDestruction: 83555666,
  torrential: 53582587, bottomless: 29401950, magicCylinder: 62279055, waboku: 12607053, dustTornado: 60082869,
  solemn: 41420027, compulsory: 94192409, threateningRoar: 36361633, recklessGreed: 37576645,
  mindCrush: 15800838, prohibition: 43711255, dnaSurgery: 74701381, shadowSpell: 29267084, justDesserts: 24068492,
  lightOfIntervention: 62867251, jarOfGreed: 83968380, riryokuField: 70344351, burstBreath: 80163754,
  magicJammer: 77414722, sevenTools: 3819470, spellbindingCircle: 18807108, backupSoldier: 36280194, shift: 59560625,
  disappear: 24623598, raigekiBreak: 4178474, ceasefire: 36468556, dragonsBead: 92408984, dragonsRage: 54178050,
  trapJammer: 19252988, curseOfAnubis: 66742250, coveringFire: 74458486,
} as const;

type Name = keyof typeof C;
const list = (cards: Partial<Record<Name, number>>): number[] =>
  Object.entries(cards).flatMap(([name, n]) => Array<number>(n).fill(C[name as Name]));

interface DeckDef {
  label: string;
  deck: Deck;
}

export const DECKS = {
  /** Yugi: Dark Magician and friends, Kuriboh, Magic Cylinder. */
  yugi: {
    label: "Yugi",
    deck: {
      main: list({
        darkMagician: 2, darkMagicianGirl: 2, skilledDarkMagician: 2, magicianOfFaith: 2, kuriboh: 2, mysticalElf: 2,
        breaker: 1, geminiElf: 1, sangan: 1, summonedSkull: 1, gaia: 1, sixthSense: 1,
        potOfGreed: 1, monsterReborn: 1, darkHole: 1, raigeki: 1, mst: 2, swords: 1, bookOfMoon: 1, gracefulCharity: 1,
        changeOfHeart: 1, brainControl: 1, nobleman: 1,
        mirrorForce: 1, magicCylinder: 2, waboku: 1, callOfTheHaunted: 1, sakuretsu: 2, trapHole: 1, dustTornado: 1,
        mindCrush: 1,
      }),
    },
  },
  /** Kaiba: Blue-Eyes, Lord of D. + Flute, Blue-Eyes Ultimate Dragon, heavy removal. */
  kaiba: {
    label: "Kaiba",
    deck: {
      main: list({
        blueEyes: 3, lordOfD: 2, vorseRaider: 2, laJinn: 1, sangan: 1, mysticTomato: 2, cyberJar: 1, zaborg: 1, mobius: 1,
        jinzo: 1,
        flute: 2, polymerization: 1, potOfGreed: 1, monsterReborn: 1, raigeki: 1, darkHole: 1, mst: 1, heavyStorm: 1,
        enemyController: 1, dnaTransplant: 1, shrink: 1, fissure: 1, smashingGround: 1, prematureBurial: 1,
        ringOfDestruction: 1, torrential: 1, bottomless: 2, mirrorForce: 1, compulsory: 1, callOfTheHaunted: 1, solemn: 1,
        prohibition: 1, dnaSurgery: 1,
      }),
      extra: list({ blueEyesUltimate: 1 }),
    },
  },
  /** Goat Control: the April 2005 format's signature deck (Scapegoat, Metamorphosis into Thousand-Eyes Restrict). */
  goat: {
    label: "Goat Control",
    deck: {
      main: list({
        blackLuster: 1, chaosSorcerer: 1, breaker: 1, jinzo: 1, airknight: 1, tsukuyomi: 1, magicianOfFaith: 1,
        morphingJar: 1, sinisterSerpent: 1, spiritReaper: 1, exiledForce: 1, ddWarriorLady: 1, sangan: 1,
        abyssSoldier: 1, asuraPriest: 1, tribeInfectingVirus: 1, witch: 1, cyberJar: 1,
        scapegoat: 2, metamorphosis: 1, gracefulCharity: 1, delinquentDuo: 1, snatchSteal: 1, prematureBurial: 1,
        nobleman: 1, bookOfMoon: 1, potOfGreed: 1, monsterReborn: 1, raigeki: 1, darkHole: 1, heavyStorm: 1, mst: 1,
        confiscation: 1, changeOfHeart: 1, brainControl: 1,
        mirrorForce: 1, ringOfDestruction: 1, torrential: 1, callOfTheHaunted: 1,
      }),
      extra: list({ thousandEyesRestrict: 1 }),
    },
  },
  /** Starter Deck: Kaiba Evolution (2009), with Ookazi, The Inexperienced Spy, Gift of the Mystical Elf, D. Tribe and
   *  Mountain swapped for 2 more Blue-Eyes, 2 more Mystic Tomato and Pot of Greed. Paladin of White Dragon is its Ritual. */
  kaibaEvolution: {
    label: "Kaiba Evolution",
    deck: {
      main: list({
        blueEyes: 3, battleOx: 1, koumoriDragon: 1, rogueDoll: 1, kojikocy: 1, uraby: 1, mysticHorseman: 1,
        ryuKishinPowered: 1, laJinn: 1, skullRedBird: 1, hyozanryu: 1, opticlops: 1, dragonDwellingInTheCave: 1,
        lusterDragon2: 1,
        mysticTomato: 3, kaiserSeaHorse: 1, lordOfD: 1, mysteriousPuppeteer: 1, trapMaster: 1, haneHane: 1, witch: 1,
        madSwordBeast: 1, spiritRyu: 1, paladinOfWhiteDragon: 1,
        whiteDragonRitual: 1, potOfGreed: 1, fissure: 1, deSpell: 1, monsterReborn: 1, flute: 1, changeOfHeart: 1,
        soulExchange: 1, tributeToTheDoomed: 1, rushRecklessly: 1, megamorph: 1, nobleman: 1, prematureBurial: 1,
        fairyMeteorCrush: 1,
        shadowSpell: 1, trapHole: 1, justDesserts: 1, dustTornado: 1, lightOfIntervention: 1, jarOfGreed: 1,
        riryokuField: 1, burstBreath: 1,
      }),
    },
  },
  /** Starter Deck: Yugi Evolution (2006), with The Eye of Truth swapped for a second Giant Rat. Black Luster Soldier is
   *  its Ritual. */
  yugiEvolution: {
    label: "Yugi Evolution",
    deck: {
      main: list({
        darkMagician: 1, mysticalElf: 1, feralImp: 1, wingedDragon1: 1, summonedSkull: 1, beaverWarrior: 1, gaia: 1,
        celticGuardian: 1, greatWhite: 1, giantSoldierOfStone: 1, mysticClown: 1, neo: 1, gazelle: 1, warriorDaiGrepher: 1,
        darkBlade: 1,
        wallOfIllusion: 1, manEaterBug: 1, sangan: 1, kuriboh: 1, giantRat: 2, sonicBird: 1, zombyra: 1,
        royalMagicalLibrary: 1, blackLusterSoldier: 1,
        blackLusterRitual: 1, darkHole: 1, dianKeto: 1, fissure: 1, monsterReborn: 1, changeOfHeart: 1, lastWill: 1,
        cardDestruction: 1, removeTrap: 1, reliableGuardian: 1, axeOfDespair: 1, malevolentNuzzler: 1, mst: 1,
        mysticPlasmaZone: 1, swords: 1, potOfGreed: 1,
        trapHole: 1, waboku: 1, magicJammer: 1, sevenTools: 1, spellbindingCircle: 1, backupSoldier: 1, shift: 1,
        disappear: 1, raigekiBreak: 1,
      }),
    },
  },
  /** Structure Deck: Zombie Madness (2005), as printed. Vampire Genesis is its ace. */
  zombieMadness: {
    label: "Zombie Madness",
    deck: {
      main: list({
        vampireGenesis: 1, masterKyonshee: 1, vampireLord: 1, darkDustSpirit: 1, pyramidTurtle: 3, spiritReaper: 1,
        despairFromTheDark: 2, ryuKokki: 2, boneTower: 1, vampireLady: 1, doubleCoston: 1, regeneratingMummy: 2,
        snatchSteal: 1, mst: 1, giantTrunade: 1, nobleman: 1, potOfGreed: 1, cardOfSafeReturn: 1, heavyStorm: 1,
        creatureSwap: 2, bookOfLife: 2, callOfTheMummy: 3, reload: 2,
        dustTornado: 1, torrential: 1, magicJammer: 1, recklessGreed: 1, compulsory: 3,
      }),
    },
  },
  /** Structure Deck: Dragon's Roar (2005), with Interdimensional Matter Transporter x2 swapped for Covering Fire x2
   *  and The Graveyard in the Fourth Dimension for Mirage Dragon. Red-Eyes Darkness Dragon is its ace. */
  dragonsRoar: {
    label: "Dragon's Roar",
    deck: {
      main: list({
        redEyesDarkness: 1, redEyes: 1, lusterDragon: 2, twinHeadedBehemoth: 1, armedDragonLv3: 2, armedDragonLv5: 2,
        redEyesChick: 1, elementDragon: 1, maskedDragon: 3, mirageDragon: 1,
        snatchSteal: 1, mst: 1, nobleman: 2, prematureBurial: 1, swords: 1, potOfGreed: 1, heavyStorm: 1,
        stampingDestruction: 3, creatureSwap: 2, reload: 2,
        callOfTheHaunted: 1, ceasefire: 1, dragonsBead: 1, dragonsRage: 2, recklessGreed: 1, coveringFire: 2,
        trapJammer: 1, curseOfAnubis: 1,
      }),
    },
  },
} satisfies Record<string, DeckDef>;

export type DeckName = keyof typeof DECKS;

export function deckByName(name: string | null | undefined, fallback: DeckName): Deck {
  return (DECKS[name as DeckName] ?? DECKS[fallback]).deck;
}

/** The name of a prebuilt deck (the same object, as passed around by the scenes), or null for any other deck. */
export function deckNameOf(deck: Deck): DeckName | null {
  return (Object.keys(DECKS) as DeckName[]).find((name) => DECKS[name].deck === deck) ?? null;
}

/** Why a deck isn't legal: 40-60 main, up to 15 extra, max 3 copies, every card known (tokens excluded). */
export function deckProblems(deck: Deck, cards: CardDb): string[] {
  const out: string[] = [];
  const main = deck.main, extra = deck.extra ?? [];
  if (main.length < DECK_RULES.mainMin || main.length > DECK_RULES.mainMax) out.push(`main deck has ${main.length} cards`);
  if (extra.length > DECK_RULES.extraMax) out.push(`extra deck has ${extra.length} cards`);
  const counts = new Map<number, number>();
  for (const code of [...main, ...extra]) counts.set(code, (counts.get(code) ?? 0) + 1);
  for (const [code, n] of counts) {
    const r = cards.records.get(code);
    if (!r) out.push(`unknown card ${code}`);
    else if (r.type & TYPE.TOKEN) out.push(`${r.name} is a token`);
    if (n > DECK_RULES.copies) out.push(`${r?.name ?? code} x${n}`);
  }
  return out;
}
