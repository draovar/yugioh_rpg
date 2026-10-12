// Turns engine "description" values into readable text.
// A description is either a system string id (strings.conf `!system N`) or
// aux.Stringid(code, n) = (code << 20) | n, pointing at a card's str(n+1).
import type { CardDb } from "./cardData.ts";

export interface SystemStrings {
  system: Record<string, string>;
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

export const PHASE_NAMES: Record<number, string> = {
  0x01: "Draw Phase", 0x02: "Standby Phase", 0x04: "Main Phase 1", 0x08: "Battle Phase",
  0x10: "Battle Step", 0x20: "Damage Step", 0x40: "Damage Calculation", 0x80: "Battle Phase",
  0x100: "Main Phase 2", 0x200: "End Phase",
};
