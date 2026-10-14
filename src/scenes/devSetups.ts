// Dev-only test boards: `/?duel&setup=NAME` places these cards before the duel starts (you go first), so a
// situation can be tried straight away instead of played into. Both decks are otherwise unchanged.
import { OcgLocation, OcgPosition } from "ocgcore-wasm";
import type { Deck, StartCard } from "../duel/DuelSession.ts";

const BLUE_EYES = 89631139, DARK_MAGICIAN = 46986414, SKULL = 70781052, CELTIC = 91152256, GEMINI = 69140098;
const VORSE = 14898066, MAN_EATER = 54652250;
const BREAKER = 71413901, SKILLED_DM = 73752131, POT_OF_GREED = 55144522, UPSTART_GOBLIN = 70368879, SWORDS = 72302403;
const TRIBE_INFECTING_VIRUS = 33184167, MIND_CRUSH = 15800838, SIXTH_SENSE = 3280747, DNA_TRANSPLANT = 56769674;
const SINISTER_SERPENT = 8131171, SCAPEGOAT = 73915051, METAMORPHOSIS = 46411259, POLYMERIZATION = 24094653, SNATCH_STEAL = 45986603, AXE = 40619825;
const CONFISCATION = 17375316, TIME_WIZARD = 71625222, BIG_EYE = 16768387;
const WHITE_DRAGON_RITUAL = 9786492, PALADIN = 73398797, KAISER_SEA_HORSE = 17444133, HANE_HANE = 7089711, BATTLE_OX = 5053103;

const hand = (code: number): StartCard => ({ code, location: OcgLocation.HAND });
const monster = (code: number, sequence: number): StartCard => ({ code, location: OcgLocation.MZONE, sequence });
/** A Spell/Trap set face-down in Spell & Trap zone `sequence`. */
const set = (code: number, sequence: number): StartCard =>
  ({ code, location: OcgLocation.SZONE, sequence, position: OcgPosition.FACEDOWN_DEFENSE });

const SETUPS: Record<string, { you: StartCard[]; opponent: StartCard[] }> = {
  /**
   * Tribute Summons: three monsters to tribute from, Blue-Eyes (2 tributes) and Summoned Skull / Dark
   * Magician (1 tribute) in hand, and two opponent monsters to attack.
   */
  tribute: {
    you: [monster(CELTIC, 1), monster(VORSE, 2), monster(MAN_EATER, 3), hand(BLUE_EYES), hand(SKULL), hand(DARK_MAGICIAN)],
    opponent: [monster(GEMINI, 1), monster(CELTIC, 3)],
  },
  /**
   * Tokens + Extra Deck: Metamorphosis on the Level 1 Sinister Serpent -> Thousand-Eyes Restrict, and Scapegoat
   * (its tokens are Level 1 too, but Scapegoat forbids other Special Summons that turn). Use &deck=goat.
   */
  scapegoat: {
    you: [monster(SINISTER_SERPENT, 0), hand(SCAPEGOAT), hand(METAMORPHOSIS)],
    opponent: [monster(VORSE, 2)],
  },
  /** Fusion: three Blue-Eyes + Polymerization -> Blue-Eyes Ultimate Dragon. Use &deck=kaiba. */
  fusion: {
    you: [hand(BLUE_EYES), hand(BLUE_EYES), hand(BLUE_EYES), hand(POLYMERIZATION)],
    opponent: [monster(GEMINI, 2)],
  },
  /**
   * Declarations: Tribe-Infecting Virus (discard, declare a Type), Mind Crush (a card name), Sixth Sense (two
   * numbers), DNA Transplant (an Attribute).
   */
  declare: {
    you: [monster(TRIBE_INFECTING_VIRUS, 0), set(MIND_CRUSH, 0), set(SIXTH_SENSE, 1), set(DNA_TRANSPLANT, 2)],
    opponent: [monster(GEMINI, 1), monster(CELTIC, 3)],
  },
  /**
   * Counters: Normal Summon Breaker (1 Spell Counter); each Spell you activate gives Skilled Dark Magician 1 (Pot of
   * Greed, Upstart Goblin, Swords: 3, then it can tribute itself for Dark Magician).
   */
  counters: {
    you: [monster(SKILLED_DM, 1), hand(BREAKER), hand(POT_OF_GREED), hand(UPSTART_GOBLIN), hand(SWORDS)],
    opponent: [],
  },
  /** Equip Spells: Snatch Steal the opponent's Summoned Skull, Axe of Despair on your monster. */
  equip: {
    you: [monster(CELTIC, 2), hand(SNATCH_STEAL), hand(AXE)],
    opponent: [monster(SKULL, 2)],
  },
  /** Coin call: Time Wizard's effect (call heads/tails, then toss): right destroys the opponent's monsters, wrong yours. */
  coin: {
    you: [monster(TIME_WIZARD, 2), monster(CELTIC, 1)],
    opponent: [monster(SKULL, 2), monster(GEMINI, 3)],
  },
  /** Sorting: Flip Summon the set Big Eye (TO ATK in its menu) to order the top 5 cards of your Deck. */
  sort: {
    you: [{ code: BIG_EYE, location: OcgLocation.MZONE, sequence: 2, position: OcgPosition.FACEDOWN_DEFENSE }],
    opponent: [],
  },
  /**
   * Ritual: White Dragon Ritual for Paladin of White Dragon (Level 4), tributes by Level from hand or field (Hane-Hane 2,
   * Kaiser Sea Horse / Battle Ox 4); Paladin can then tribute itself for a Blue-Eyes from the Deck (&deck=kaibaEvolution).
   * Kaiser Sea Horse also counts as 2 tributes for the LIGHT Blue-Eyes in hand.
   */
  ritual: {
    you: [monster(KAISER_SEA_HORSE, 1), monster(HANE_HANE, 3), hand(WHITE_DRAGON_RITUAL), hand(PALADIN), hand(BATTLE_OX), hand(BLUE_EYES)],
    opponent: [monster(VORSE, 2)],
  },
  /** Reveals: Confiscation flips the opponent's hand face-up while you pick the card to discard. */
  confiscation: {
    you: [hand(CONFISCATION)],
    opponent: [],
  },
};

/** Adds the named setup's cards to the two decks (unknown names are reported and ignored). */
export function withDevSetup(decks: [Deck, Deck], name: string | undefined): [Deck, Deck] {
  if (!name) return decks;
  const setup = SETUPS[name];
  if (!setup) {
    console.warn(`unknown &setup=${name}; known: ${Object.keys(SETUPS).join(", ")}`);
    return decks;
  }
  return [{ ...decks[0], start: setup.you }, { ...decks[1], start: setup.opponent }];
}
