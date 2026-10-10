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

export const PHASE_NAMES: Record<number, string> = {
  0x01: "Draw Phase", 0x02: "Standby Phase", 0x04: "Main Phase 1", 0x08: "Battle Phase",
  0x10: "Battle Step", 0x20: "Damage Step", 0x40: "Damage Calculation", 0x80: "Battle Phase",
  0x100: "Main Phase 2", 0x200: "End Phase",
};
