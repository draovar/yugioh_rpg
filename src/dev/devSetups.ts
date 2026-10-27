// Dev-only test boards: `/?duel&setup=NAME` places these cards before the duel starts (you go first), so a
// situation can be tried straight away instead of played into. Both decks are otherwise unchanged.
import { OcgLocation, OcgPosition } from "ocgcore-wasm";
import type { Deck, StartCard } from "../duel/engine/DuelSession.ts";

const BLUE_EYES = 89631139, DARK_MAGICIAN = 46986414, SKULL = 70781052, CELTIC = 91152256, GEMINI = 69140098;
const VORSE = 14898066, MAN_EATER = 54652250;
const BREAKER = 71413901, SKILLED_DM = 73752131, POT_OF_GREED = 55144522, UPSTART_GOBLIN = 70368879, SWORDS = 72302403;
const TRIBE_INFECTING_VIRUS = 33184167, MIND_CRUSH = 15800838, SIXTH_SENSE = 3280747, DNA_TRANSPLANT = 56769674;
const SINISTER_SERPENT = 8131171, SCAPEGOAT = 73915051, METAMORPHOSIS = 46411259, POLYMERIZATION = 24094653, SNATCH_STEAL = 45986603, AXE = 40619825;
const CONFISCATION = 17375316, TIME_WIZARD = 71625222, BIG_EYE = 16768387;
const NEOS = 89943723, AIR_HUMMINGBIRD = 54959865, AIR_NEOS = 11502550, V_TIGER = 51638941, W_WING = 96300057, VW_TIGER = 58859575;
const BESTIARI = 41470137, DARIUS = 25924653, GYZARUS = 48156348;
const X_HEAD = 62651957, Y_DRAGON = 65622692, Z_METAL = 64500000;
const KING_PYRON = 20438745, GOGGLE_GOLEM = 21155323, ASURA_PRIEST = 2134346, TSUKUYOMI = 34853266;
const TOON_WORLD = 15259703, TOON_MERMAID = 65458948, TOON_SKULL = 91842653, TOON_GEMINI_ELF = 42386471, MST = 5318639;
const GROUND_COLLAPSE = 90502999;
const EXODIA = [33396948, 70903634, 7902349, 8124921, 44519536];
const DESTINY_BOARD = 94212438, MESSAGE_I = 31893528, MESSAGE_N = 67287533, MESSAGE_A = 94772232, MESSAGE_L = 30170981;
const WHITE_DRAGON_RITUAL = 9786492, PALADIN = 73398797, KAISER_SEA_HORSE = 17444133, HANE_HANE = 7089711, BATTLE_OX = 5053103;

const hand = (code: number): StartCard => ({ code, location: OcgLocation.HAND });
/** A face-up Spell/Trap (Continuous or Field) in Spell & Trap zone `sequence`. */
const faceUp = (code: number, sequence: number): StartCard => ({ code, location: OcgLocation.SZONE, sequence, position: OcgPosition.FACEUP_ATTACK });
const monster = (code: number, sequence: number): StartCard => ({ code, location: OcgLocation.MZONE, sequence });
/** A Spell/Trap set face-down in Spell & Trap zone `sequence`. */
const set = (code: number, sequence: number): StartCard =>
  ({ code, location: OcgLocation.SZONE, sequence, position: OcgPosition.FACEDOWN_DEFENSE });

/** `extra`: cards added to your Extra Deck. */
const SETUPS: Record<string, { you: StartCard[]; opponent: StartCard[]; extra?: number[] }> = {
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
  /**
   * Contact fusions (Special Summoned from the Extra Deck by its own rule, no Polymerization; browse your Extra Deck):
   * Neos + Air Hummingbird -> Air Neos (both shuffled into the Deck), V-Tiger Jet + W-Wing Catapult -> VW-Tiger Catapult
   * (banished), then Normal Summon Darius next to Bestiari -> Gladiator Beast Gyzarus (both returned to the Deck).
   */
  contact: {
    you: [monster(NEOS, 0), monster(AIR_HUMMINGBIRD, 1), monster(V_TIGER, 2), monster(W_WING, 3), monster(BESTIARI, 4), hand(DARIUS)],
    opponent: [monster(VORSE, 2)],
    extra: [AIR_NEOS, VW_TIGER, GYZARUS],
  },
  /**
   * Union monsters: equip W-Wing Catapult to V-Tiger Jet, Y-Dragon Head and Z-Metal Tank to X-Head Cannon (USE on the
   * Union, then pick the target); the equipped monster gains ATK/DEF and is protected (the Union is destroyed instead).
   * Next turn, USE on the equipped Union unequips it (Special Summoned in Attack Position). Opponent's Vorse Raider to
   * attack into.
   */
  union: {
    you: [monster(V_TIGER, 0), monster(W_WING, 1), monster(X_HEAD, 2), monster(Y_DRAGON, 3), monster(Z_METAL, 4)],
    opponent: [monster(VORSE, 2)],
  },
  /**
   * Gemini monsters (Normal Monsters until Normal Summoned again on the field): SUMMON on face-up King Pyron uses your
   * Normal Summon and gives it its effect (USE: 1000 damage, once per turn); Goggle Golem's ATK becomes 2100 the same
   * way (next turn: one Normal Summon per turn).
   */
  gemini: {
    you: [monster(KING_PYRON, 1), monster(GOGGLE_GOLEM, 3)],
    opponent: [monster(VORSE, 2)],
  },
  /**
   * Spirit monsters (can't be Special Summoned, return to the hand in the End Phase of the turn they're summoned or
   * flipped): Flip Summon the set Asura Priest (it can attack every opponent's monster), Normal Summon Tsukuyomi (turns
   * a face-up monster face-down), then end the turn: both go back to your hand.
   */
  spirit: {
    you: [{ code: ASURA_PRIEST, location: OcgLocation.MZONE, sequence: 1, position: OcgPosition.FACEDOWN_DEFENSE }, hand(TSUKUYOMI)],
    opponent: [monster(VORSE, 2), monster(CELTIC, 3)],
  },
  /**
   * Toons (need Toon World; can't attack the turn they're summoned): Toon Mermaid is Special Summoned from the hand
   * (SP.SUM), Toon Summoned Skull too by tributing 1 (Celtic Guardian), Toon Gemini Elf is Normal Summoned. Then
   * Mystical Space Typhoon on your own Toon World: every Toon is destroyed with it.
   */
  toon: {
    you: [{ code: TOON_WORLD, location: OcgLocation.SZONE, sequence: 2, position: OcgPosition.FACEUP_ATTACK }, monster(CELTIC, 2),
      hand(TOON_MERMAID), hand(TOON_SKULL), hand(TOON_GEMINI_ELF), hand(MST)],
    opponent: [monster(VORSE, 2)],
  },
  /**
   * Zone disabling: Ground Collapse (pick 2 empty Monster Zones, either side: nobody can use them). The board marks
   * them (darkened, with an X), and later zone choices skip them.
   */
  zones: {
    you: [monster(CELTIC, 1), monster(VORSE, 3), hand(GROUND_COLLAPSE)],
    opponent: [monster(VORSE, 2)],
  },
  /** Alternate win: all five Exodia pieces in hand (the end dialog says why the duel ended). */
  exodia: {
    you: EXODIA.map(hand),
    opponent: [],
  },
  /**
   * Alternate win: Destiny Board face-up, the four Spirit Messages in hand; each opponent's End Phase it places the
   * next one ("I", "N", "A", "L"; it counts only the ones it placed), and the fourth wins the duel on turn 8 (if the
   * AI leaves it alone).
   */
  destiny: {
    you: [faceUp(DESTINY_BOARD, 0), ...[MESSAGE_I, MESSAGE_N, MESSAGE_A, MESSAGE_L].map(hand)],
    opponent: [],
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
  return [{ ...decks[0], start: setup.you, extra: [...(decks[0].extra ?? []), ...(setup.extra ?? [])] }, { ...decks[1], start: setup.opponent }];
}
