# Card pool plan: every TCG card before Synchros (2026-10-26)

## Goal

The game's card pool becomes **every TCG card released up to and including Premium Pack 2** (PP02, 2008-07-31):
all sets through Light of Destruction (May 2008) plus PP02's 19 new cards. The TCG's first Synchros came a week
later (5D's Starter Deck, August 2008), so this is "everything before Synchros". Rules stay `MODE_GOAT`. Any card
outside that range (OCG-only, later releases) can be hand-picked through an exceptions list.

Then NPCs get decks built from it.

## Decisions

- **TCG, not OCG.** The OCG cutoff before Synchros (2008-03-15) gives 3,117 cards: 316 the TCG pool lacks (211 are
  old Normal Monsters, 151 never released in the TCG) and 40 TCG-first cards it loses (Lonefire Blossom, Allure of
  Darkness, Gladiator Beast Torax...). `MODE_GOAT`'s rulings and the GOAT script versions are TCG ones too.
- **Banlist base: TCG May 2008** (in effect 2008-05-09 to 2008-08-31, Yugipedia "May_2008_Lists"). The user will
  change it later, so it's a data file.
- **Pool from set lists, not card dates.** YGOPRODeck's `enddate` filter on card dates silently drops cards (Monster
  Reborn, Dark Magician). Every card printed in a TCG product dated on or before the cutoff is in.
- **Passcodes from BabelCDB.** YGOPRODeck's card `id` is sometimes an alt-art id (Monster Reborn 83764719 instead of
  83764718); the generator picks the id BabelCDB has as the base card (no alias). Cards with no BabelCDB entry are
  video-game promos (Meteo the Matchless, Ulevo...) and are dropped.

## Measured (test build of the full pool, 2026-10-26)

- 2,841 cards + 37 tokens; every effect card has a script.
- `scripts.json` 4.2 MB (600 KB gzipped), `cards.json` 1.1 MB (200 KB gzipped): loading everything at boot is fine.
- `art32` atlas 1024x2880 (fits a 4096 texture limit); `art128` about 2,900 files, loaded on demand.
- Sixth Sense (in the Goat deck) was first released in the TCG in 2013: it is only in the pool as an exception.
- GOAT / pre-errata scripts live under codes of their own in BabelCDB `goat-entries.cdb` / `cards-unofficial.cdb`
  (e.g. 504700000 "Skull Dice (GOAT)", aliasing the real card), so looking scripts up by passcode never finds them.

## Phases

### 1. Pool generator (`tools/data/build-pool.mjs`)

- Downloads YGOPRODeck's set list and card database once into `vendor/ygoprodeck/` (`--refresh` to update).
- Pool = cards in TCG products dated ≤ the cutoff, mapped to BabelCDB passcodes, game-only cards dropped,
  plus/minus `data/pool-exceptions.json` (by card name, with a reason).
- Writes `data/pool.json` (still the file everything else reads, committed so builds need no network).

### 2. Card versions ✅ (2026-10-26)

- **Modern versions by default** (user's choice after comparing: today's text is clearer and the scripts the most
  tested); the banlist is edited to match (phase 6). Hand-picked cards play an older version instead:
  `data/card-versions.json` lists them by name under `goat` or `pre-errata`, with a reason. `build-data` gives a picked
  card that version's script, text and type under the real passcode, so decks keep the real codes; stats stay official.
  It fails on an unknown name, a card outside the pool or one without that version. Empty for now.
- 232 pool cards have an older version (191 GOAT, 47 pre-errata, 6 both). Most GOAT ones only differ in wording;
  real differences: no once-per-turn on Sangan / Witch of the Black Forest, Ring of Destruction (pre-errata: any
  monster, any turn, both players take damage), Crush Card Virus (pre-errata: checks draws for 3 turns), Sinister
  Serpent (pre-errata: back every Standby Phase).
- Tried with every older version on: one `ai-bench` position failed. Armed Dragon LV3's GOAT version can be activated
  with no LV5 to summon (it just sends itself to the GY), so the AI's copies (whose opponent Deck is blank stand-ins)
  had their LV3 throw itself away and the AI expected the threat to go by itself. Copy gap to fix before picking it.
  The bench's do-nothing opponent now declines optional triggers (it had said yes to that LV3).

### 3. Data and art at full size ✅ (2026-10-26, phone check after the next deploy)

- `fetch-art`: 2,306 new artworks, ~45 min (about 1.2 s each, mostly the image host's latency); `vendor/art` is
  321 MB. CI caches it, so only the first deploy pays that once. `build-art`: 95 s.
- `build-art` now writes lossless 8-bit indexed PNGs (`tools/lib/indexed-png.mjs`; sharp's palette output shifts
  colours): art32 atlas 1024x2880, 2.31 → 1.74 MB; art128 33 → 25 MB (2,879 files, loaded one at a time).
- Boot downloads ~7.5 MB, ~2.6 MB on the wire (Pages gzips JSON): atlas 1.74 MB, `scripts.json` 4.2 MB (620 KB
  gzipped), `cards.json` 1.1 MB (200 KB), `art32.json` 465 KB (23 KB). Locally every file loads in < 30 ms.
  If phones feel slow: load the atlas and engine data at the first duel / deck editor instead of at boot.
- Deck editor with 2,842 cards (browser): search 1.2-1.7 ms per keystroke (card-text search too), scrolling 0.3 ms
  (it only draws the visible rows). Atlas checked in the browser: all 2,879 frames, pixels as built.

### 4. Engine check of every card (random-deck mode for `smoke`)

- Bot vs bot duels with random legal 40-card decks drawn from the whole pool, many seeds, so every card gets played.
- Any RETRY, crash or `[ocgcore]` error points at a card: fix it, or put it on a "broken" list no deck may use.

### 5. UI checks for untested mechanics

One `&setup` board each, checked in the browser with the user, in the order NPC decks need them:
contact fusions (19: Neos, Gladiator Beasts, VWXYZ), Union (18), Gemini (21), Spirit (12), Toon (9), zone disabling
(5: Ground Collapse, Ojama King...), alternate wins (6: Destiny Board, Final Countdown, Vennominaga), counter kinds
told apart on the badge (62 cards use counters).

### 6. Banlist

- `data/banlist.json`: the May 2008 TCG list, edited for the modern card versions (e.g. Witch / Sangan are once per
  turn now) and for any older version picked in `card-versions.json`.
- `deckRules` enforces it (deck editor, deck validation); `smoke` checks the prebuilt decks against it.

### 7. NPC decks as data files

- Decks move from the passcode table in `src/duel/decks/decks.ts` to files listing cards by name
  (e.g. `data/decks/joey.json`), checked against the pool, banlist and broken list.
- A deck editor export button, so a deck built in the game can be pasted in.
- New decks go through `arena` to check the AI plays them sensibly.

NPC deck building can start after phase 4 with any card not on the broken list; a deck using a phase 5 mechanic
waits for that check.

## Open

- Sixth Sense: kept as an exception for the Goat deck for now; keep it or drop it from the deck.
