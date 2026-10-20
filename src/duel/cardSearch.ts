// Card-name search for typed input (card declarations). No Phaser.
//
// Case and punctuation don't matter ("blue eyes" finds "Blue-Eyes White Dragon"); every typed word must
// appear in the name, in any order ("white blue" works too); typing without spaces matches across them
// ("blueeyes"); a one-letter word must start a word. Best matches first: the name starts with the query, then a
// word of it does, then anywhere.

export interface NamedCard {
  code: number;
  name: string;
}

/** Lowercase words: punctuation and runs of spaces become single spaces. */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Prepared candidates (normalize once, search on every keystroke). */
export class CardSearch {
  private readonly entries: { card: NamedCard; norm: string; compact: string; words: string[] }[];

  constructor(cards: NamedCard[]) {
    this.entries = cards.map((card) => {
      const norm = normalize(card.name);
      return { card, norm, compact: norm.replace(/ /g, ""), words: norm.split(" ") };
    });
  }

  get size(): number {
    return this.entries.length;
  }

  /** All matches, best first (an empty query lists everything A-Z). */
  find(query: string): NamedCard[] {
    const q = normalize(query);
    const byName = (a: NamedCard, b: NamedCard) => a.name.localeCompare(b.name);
    if (!q) return this.entries.map((e) => e.card).sort(byName);
    const tokens = q.split(" ");
    const qCompact = q.replace(/ /g, "");
    const scored: { card: NamedCard; score: number }[] = [];
    for (const e of this.entries) {
      // A one-letter word ("d" of "d.d.") only matches a word's start, else it would match almost every name.
      const has = (t: string) => (t.length === 1 ? e.words.some((w) => w.startsWith(t)) : e.norm.includes(t));
      const hit = tokens.every(has) || (qCompact.length > 1 && e.compact.includes(qCompact));
      if (!hit) continue;
      const score = e.norm.startsWith(q) || e.compact.startsWith(qCompact) ? 0 : e.words.some((w) => w.startsWith(tokens[0])) ? 1 : 2;
      scored.push({ card: e.card, score });
    }
    return scored.sort((a, b) => a.score - b.score || byName(a.card, b.card)).map((s) => s.card);
  }
}
