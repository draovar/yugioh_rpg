// The starter and structure decks the deck shop sells, in release order: name and TCG release (YGOPRODeck's set
// list), the price (placeholders: a starter deck 200 chips, a structure deck 250). For now only the 12 whose box
// pictures are cut out; the others (commented out) come back once theirs are.
// Box pictures: public/deck-boxes/<code>.png (`npm run build-deck-boxes`); card lists: public/data/decks.json
// (`npm run build-data`).

export interface DeckStock {
  /** Set code; also the picture's name. */
  code: string;
  name: string;
  kind: "starter" | "structure";
  /** TCG release date, YYYY-MM-DD. */
  released: string;
  /** In chips. */
  price: number;
}

/** A deck's entry in public/data/decks.json (data/decks.json, from build-pool): each card is [number, passcode, rarity, copies]. */
export interface DeckList {
  code: string;
  name: string;
  /** TCG release date, YYYY-MM-DD. */
  released: string;
  cards: [string, number, string, number][];
}

const starter = (code: string, name: string, released: string): DeckStock => ({ code, name, kind: "starter", released, price: 200 });
const structure = (code: string, name: string, released: string): DeckStock => ({ code, name, kind: "structure", released, price: 250 });

export const DECKS: DeckStock[] = [
  // starter("SDY", "Starter Deck: Yugi", "2002-03-29"),
  // starter("SDK", "Starter Deck: Kaiba", "2002-03-29"),
  // starter("SDJ", "Starter Deck: Joey", "2003-03-30"),
  // starter("SDP", "Starter Deck: Pegasus", "2003-03-30"),
  starter("SYE", "Starter Deck: Yugi Evolution", "2004-03-01"),
  starter("SKE", "Starter Deck: Kaiba Evolution", "2004-03-01"),
  structure("SD1", "Structure Deck: Dragon's Roar", "2005-01-01"),
  structure("SD2", "Structure Deck: Zombie Madness", "2005-01-01"),
  structure("SD3", "Structure Deck: Blaze of Destruction", "2005-05-09"),
  structure("SD4", "Structure Deck: Fury from the Deep", "2005-05-09"),
  structure("SD5", "Structure Deck: Warrior's Triumph", "2005-10-28"),
  structure("SD6", "Structure Deck: Spellcaster's Judgment", "2006-01-18"),
  starter("YSD", "Starter Deck 2006", "2006-03-23"),
  structure("SD7", "Structure Deck: Invincible Fortress", "2006-05-15"),
  structure("SD8", "Structure Deck: Lord of the Storm", "2006-07-12"),
  structure("SD09", "Structure Deck: Dinosaur's Rage", "2006-10-20"),
  // structure("SD10", "Structure Deck: Machine Re-Volt", "2007-01-17"),
  // starter("YSDJ", "Starter Deck: Jaden Yuki", "2007-07-25"),
  // starter("YSDS", "Starter Deck: Syrus Truesdale", "2007-07-25"),
  // structure("SDRL", "Structure Deck: Rise of the Dragon Lords", "2007-10-24"),
  // structure("SDDE", "Structure Deck: The Dark Emperor", "2008-04-02"),
];
