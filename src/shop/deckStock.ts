// The starter and structure decks the deck shop sells (DECKS), in release order: name and TCG release (YGOPRODeck's
// set list), a short name for menus and for the deck slot a bought one is saved in (at most 16 characters, as the deck
// editor allows), the price (placeholders: a starter deck 200 chips, a structure deck 250). The first four starter
// decks (STARTER_DECKS) aren't sold: the player takes one of them at the start of the game (StarterDecks.ts). Plain
// data (no Phaser), also read by the world menu's deck lists (ui/prefs.ts).
export interface DeckStock {
  /** Set code; also the picture's name. */
  code: string;
  name: string;
  /** The saved deck's name, and the deck's name in menus. */
  short: string;
  kind: "starter" | "structure";
  /** TCG release date, YYYY-MM-DD. */
  released: string;
  /** In chips. */
  price: number;
}

const starter = (code: string, name: string, short: string, released: string): DeckStock =>
  ({ code, name, short, kind: "starter", released, price: 200 });
const structure = (code: string, name: string, short: string, released: string): DeckStock =>
  ({ code, name, short, kind: "structure", released, price: 250 });

/** The 2002-03 starter decks (blister packs: flat pictures), one of them the player's first deck; free, never sold. */
export const STARTER_DECKS: DeckStock[] = [
  { ...starter("SDY", "Starter Deck: Yugi", "STARTER YUGI", "2002-03-29"), price: 0 },
  { ...starter("SDK", "Starter Deck: Kaiba", "STARTER KAIBA", "2002-03-29"), price: 0 },
  { ...starter("SDJ", "Starter Deck: Joey", "STARTER JOEY", "2003-03-30"), price: 0 },
  { ...starter("SDP", "Starter Deck: Pegasus", "STARTER PEGASUS", "2003-03-30"), price: 0 },
];

export const DECKS: DeckStock[] = [
  starter("SYE", "Starter Deck: Yugi Evolution", "YUGI EVOLUTION", "2004-03-01"),
  starter("SKE", "Starter Deck: Kaiba Evolution", "KAIBA EVOLUTION", "2004-03-01"),
  structure("SD1", "Structure Deck: Dragon's Roar", "DRAGON'S ROAR", "2005-01-01"),
  structure("SD2", "Structure Deck: Zombie Madness", "ZOMBIE MADNESS", "2005-01-01"),
  structure("SD3", "Structure Deck: Blaze of Destruction", "BLAZE OF DESTR.", "2005-05-09"),
  structure("SD4", "Structure Deck: Fury from the Deep", "FURY FROM DEEP", "2005-05-09"),
  structure("SD5", "Structure Deck: Warrior's Triumph", "WARRIOR TRIUMPH", "2005-10-28"),
  structure("SD6", "Structure Deck: Spellcaster's Judgment", "SPELL JUDGMENT", "2006-01-18"),
  starter("YSD", "Starter Deck 2006", "STARTER 2006", "2006-03-23"),
  structure("SD7", "Structure Deck: Invincible Fortress", "INVINCIBLE FORT", "2006-05-15"),
  structure("SD8", "Structure Deck: Lord of the Storm", "LORD OF STORM", "2006-07-12"),
  structure("SD09", "Structure Deck: Dinosaur's Rage", "DINOSAUR'S RAGE", "2006-10-20"),
  structure("SD10", "Structure Deck: Machine Re-Volt", "MACHINE RE-VOLT", "2007-01-17"),
  starter("YSDJ", "Starter Deck: Jaden Yuki", "JADEN YUKI", "2007-07-25"),
  starter("YSDS", "Starter Deck: Syrus Truesdale", "SYRUS TRUESDALE", "2007-07-25"),
  structure("SDRL", "Structure Deck: Rise of the Dragon Lords", "DRAGON LORDS", "2007-10-24"),
  structure("SDDE", "Structure Deck: The Dark Emperor", "DARK EMPEROR", "2008-04-02"),
];
