// Prebuilt decks until the deck editor exists. Every card must be in data/pool.json (the smoke tests check).
import { TYPE, type CardDb } from "./cardData.ts";
import type { Deck } from "./DuelSession.ts";

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
  tribeInfectingVirus: 33184167,
  // fusions (Extra Deck)
  thousandEyesRestrict: 63519819, blueEyesUltimate: 23995346,
  // spells
  potOfGreed: 55144522, darkHole: 53129443, raigeki: 12580477, monsterReborn: 83764718, mst: 5318639,
  changeOfHeart: 4031928, swords: 72302403, heavyStorm: 19613556, scapegoat: 73915051, gracefulCharity: 79571449,
  delinquentDuo: 44763025, snatchSteal: 45986603, prematureBurial: 70828912, nobleman: 71044499, bookOfMoon: 14087893,
  smashingGround: 97169186, enemyController: 98045062, brainControl: 87910978, confiscation: 17375316,
  metamorphosis: 46411259, shrink: 55713623, fissure: 66788016, polymerization: 24094653, flute: 43973174,
  sixthSense: 3280747, dnaTransplant: 56769674,
  // traps
  mirrorForce: 44095762, sakuretsu: 56120475, trapHole: 4206964, callOfTheHaunted: 97077563, ringOfDestruction: 83555666,
  torrential: 53582587, bottomless: 29401950, magicCylinder: 62279055, waboku: 12607053, dustTornado: 60082869,
  solemn: 41420027, compulsory: 94192409, threateningRoar: 36361633, recklessGreed: 37576645,
  mindCrush: 15800838, prohibition: 43711255, dnaSurgery: 74701381,
} as const;

type Name = keyof typeof C;
const list = (cards: Partial<Record<Name, number>>): number[] =>
  Object.entries(cards).flatMap(([name, n]) => Array<number>(n).fill(C[name as Name]));

export interface DeckDef {
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
} satisfies Record<string, DeckDef>;

export type DeckName = keyof typeof DECKS;

export function deckByName(name: string | null | undefined, fallback: DeckName): Deck {
  return (DECKS[name as DeckName] ?? DECKS[fallback]).deck;
}

/** Why a deck isn't legal: 40-60 main, up to 15 extra, max 3 copies, every card known (tokens excluded). */
export function deckProblems(deck: Deck, cards: CardDb): string[] {
  const out: string[] = [];
  const main = deck.main, extra = deck.extra ?? [];
  if (main.length < 40 || main.length > 60) out.push(`main deck has ${main.length} cards`);
  if (extra.length > 15) out.push(`extra deck has ${extra.length} cards`);
  const counts = new Map<number, number>();
  for (const code of [...main, ...extra]) counts.set(code, (counts.get(code) ?? 0) + 1);
  for (const [code, n] of counts) {
    const r = cards.records.get(code);
    if (!r) out.push(`unknown card ${code}`);
    else if (r.type & TYPE.TOKEN) out.push(`${r.name} is a token`);
    if (n > 3) out.push(`${r?.name ?? code} x${n}`);
  }
  return out;
}
