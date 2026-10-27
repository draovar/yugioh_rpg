// Turns engine "description" values into readable text.
// A description is either a system string id (strings.conf `!system N`) or
// aux.Stringid(code, n) = (code << 20) | n, pointing at a card's str(n+1).
import type { CardDb } from "./cardData.ts";

export interface SystemStrings {
  system: Record<string, string>;
  /** Counter names by counter type (decimal), from strings.conf `!counter`. */
  counter?: Record<string, string>;
  /** Why a duel ended, by WIN reason (decimal), from strings.conf `!victory`. */
  victory?: Record<string, string>;
}

export class DuelText {
  private readonly cards: CardDb;
  private readonly strings: SystemStrings;

  constructor(cards: CardDb, strings: SystemStrings) {
    this.cards = cards;
    this.strings = strings;
  }

  system(id: number | bigint): string {
    return this.strings.system[String(id)] ?? `#${id}`;
  }

  /** Resolves a description; `%ls` placeholders are filled with `cardName` when given. */
  describe(desc: bigint | number, cardName?: string): string {
    const d = BigInt(desc);
    let text: string | undefined;
    if (d >= 1n << 20n) {
      const code = Number(d >> 20n);
      const idx = Number(d & 0xfffffn);
      text = this.cards.records.get(code)?.strings[idx] || undefined;
    } else {
      text = this.strings.system[String(d)];
    }
    if (!text) return d === 0n ? "" : `#${d}`;
    return cardName ? text.replace(/%ls/g, cardName) : text;
  }

  /**
   * A counter type's name ("Spell Counter"). strings.conf lists some types with the 0x1000 flag
   * (COUNTER_WITHOUT_PERMIT) set, so try both. Unnamed ones ('Counter ("Ancient City")') are just "Counter".
   */
  counterName(kind: number): string {
    const names = this.strings.counter ?? {};
    const name = names[kind] ?? names[kind | 0x1000] ?? names[kind & 0xfff];
    return !name || name.startsWith("Counter (") ? "Counter" : name;
  }

  /**
   * Why a duel ended, from the WIN message's reason ("LP reached 0", 'By the effect of "Destiny Board"'), or "" if
   * unknown. "Victory by" is shortened to "By": the line also explains a loss.
   */
  winReason(reason: number): string {
    return (this.strings.victory?.[reason] ?? "").replace(/^Victory by/, "By");
  }

  name(code: number): string {
    return this.cards.name(code);
  }
}

/** Monster Types (race bits), in the engine's bit order. */
export const RACES: [bigint, string][] = [
  [0x1n, "WARRIOR"], [0x2n, "SPELLCASTER"], [0x4n, "FAIRY"], [0x8n, "FIEND"], [0x10n, "ZOMBIE"], [0x20n, "MACHINE"],
  [0x40n, "AQUA"], [0x80n, "PYRO"], [0x100n, "ROCK"], [0x200n, "WINGED BEAST"], [0x400n, "PLANT"], [0x800n, "INSECT"],
  [0x1000n, "THUNDER"], [0x2000n, "DRAGON"], [0x4000n, "BEAST"], [0x8000n, "BEAST-WARRIOR"], [0x10000n, "DINOSAUR"],
  [0x20000n, "FISH"], [0x40000n, "SEA SERPENT"], [0x80000n, "REPTILE"], [0x100000n, "PSYCHIC"], [0x200000n, "DIVINE-BEAST"],
];
/** Attributes (bits), in the engine's bit order. */
export const ATTRIBUTES: [number, string][] = [
  [0x01, "EARTH"], [0x02, "WATER"], [0x04, "FIRE"], [0x08, "WIND"], [0x10, "LIGHT"], [0x20, "DARK"], [0x40, "DIVINE"],
];

/** Names of the Types set in a race mask ("WARRIOR, DRAGON"). */
export function raceNames(mask: bigint): string {
  return RACES.filter(([bit]) => mask & bit).map(([, n]) => n).join(", ");
}

/** Names of the Attributes set in a mask ("LIGHT"). */
export function attributeNames(mask: number): string {
  return ATTRIBUTES.filter(([bit]) => mask & bit).map(([, n]) => n).join(", ");
}

/**
 * What a declaration hint says was declared (the engine sends HINT_RACE 6 / HINT_ATTRIB 7 / HINT_CODE 8 /
 * HINT_NUMBER 9 after each declaration, `player` = who declared), or null for any other hint.
 */
export function declarationText(hintType: number, value: bigint, cardName: (code: number) => string): string | null {
  switch (hintType) {
    case 6: return raceNames(BigInt(value));
    case 7: return attributeNames(Number(value));
    case 8: return cardName(Number(value));
    case 9: return String(value);
    default: return null;
  }
}

/** System strings "Heads" / "Tails": the options of a coin call (Duel.AnnounceCoin). */
export const COIN_HEADS_STRING = 60, COIN_TAILS_STRING = 61;

/**
 * The call of a coin toss, from the hint the engine sends after it (HINT_OPSELECTED 4 with system string 60 / 61,
 * `player` = who called), or null for any other hint.
 */
export function coinCallText(hintType: number, value: bigint): string | null {
  if (hintType !== 4) return null;
  if (Number(value) === COIN_HEADS_STRING) return "Heads";
  if (Number(value) === COIN_TAILS_STRING) return "Tails";
  return null;
}

export const PHASE_NAMES: Record<number, string> = {
  0x01: "Draw Phase", 0x02: "Standby Phase", 0x04: "Main Phase 1", 0x08: "Battle Phase",
  0x10: "Battle Step", 0x20: "Damage Step", 0x40: "Damage Calculation", 0x80: "Battle Phase",
  0x100: "Main Phase 2", 0x200: "End Phase",
};
