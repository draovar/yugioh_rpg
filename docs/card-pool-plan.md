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

### 4. Engine check of every card ✅ (`npm run smoke-random`)

- `tools/test/smoke-random.ts`: each pass shuffles the pool into decks (20 different cards x2 + 15 Fusions), autoBot vs
  autoBot, on all cores (one duel per worker at a time; a duel with no engine answer in 60 s kills its worker and
  counts as a hang). Fails on RETRY, crash, a duel that never ends, a hang or a new `[ocgcore]` error, naming the
  cards that acted last; `--duel K` replays one duel, `--unplayed FILE` lists the cards that never acted.
- Results: 200 passes (13,800 duels, 130 s on 8 threads): 0 failures; 2,456 of 2,841 cards (86%) summoned or
  activated. The rest are cards random decks can't set up (archetype support, Nomi / Ritual monsters, Fusion
  materials, combo pieces): untested rather than broken, phase 5 and NPC decks cover them.
- Found and fixed: autoBot finished SELECT_UNSELECT_CARD short of `min` (Panther Warrior's attack tribute, retried
  forever); "yes" to the same optional effect over and over (Manticore of Darkness reviving itself) is now capped at
  20 per card per turn in `AiSeat` (any brain).
- Broken, removed from the pool (`pool-exceptions.json` "remove"): **Last Turn**. ocgcore-wasm 0.1.2 loops forever inside
  `duelProcess` after its forced attack when both monsters die in battle and the turn reaches Main Phase 2 (the only
  pool card using `Duel.ForceAttack`). Recheck on an ocgcore-wasm update.
- Known, accepted script error (`KNOWN_ERRORS` in the script): Steel Scorpion copied by Phantom of Chaos reads the
  copy's deleted effects at the End Phase; the check just fails, the duel goes on.

### 5. UI checks for untested mechanics ✅

One `&setup` board each, checked in the browser with the user, in the order NPC decks need them:
contact fusions (19: Neos, Gladiator Beasts, VWXYZ), Union (18), Gemini (21), Spirit (12), Toon (9), zone disabling
(5: Ground Collapse, Ojama King...), alternate wins (6: Destiny Board, Final Countdown, Vennominaga), counter kinds
told apart on the badge (62 cards use counters).

Progress:
- Contact fusions: the Extra Deck / Graveyard browsers now offer a card's own actions (before, a Special Summon from
  the Extra Deck by a card's own rule couldn't be chosen at all). `&setup=contact`: Air Neos (shuffled back), VW-Tiger
  Catapult (banished), Gyzarus (returned) all summon through the UI. The pile pulses (yellow outline, ~1.8 s cycle)
  and its count badge turns yellow while it holds a usable card (user's pick from four mockups: pulse + yellow badge).
- Union: works with the existing UI, no changes. `&setup=union`: USE on W-Wing Catapult / Y-Dragon Head / Z-Metal Tank
  (menu label "Use"; the engine's own is "Equip") → pick the target on the board; the Union sits in the S/T row as a
  monster card with the equip link, the stats update (X-Head Cannon 1800 → 2800 with Y and Z). Next turn USE on the
  equipped Union unequips it (zone, position). The AI's Mobius destroyed equipped Unions as Spells/Traps correctly. Not
  seen: the destruction substitute (engine logic; the UI just shows the Union going to the Graveyard).
- Gemini: works with the existing UI, no changes. `&setup=gemini`: face-up King Pyron / Goggle Golem show SUMMON in
  their menu (the second Normal Summon, no tributes for the Level 5); afterwards King Pyron's USE burns 1000 once per
  turn. Open: nothing shows whether a Gemini on the field has been Gemini Summoned (the query gives no type in
  ocgcore-wasm 0.1.2; the UI would have to remember the summons).
- Spirit: works with the existing UI, no changes. `&setup=spirit`: Flip Summon Asura Priest, Normal Summon Tsukuyomi
  (its trigger picks a face-up target on the board and sets it face-down); at the End Phase both return triggers come
  as a forced "You must activate an effect" chain picker (you order them), both cards go back to the hand, then the
  hand-size discard. Since then a forced chain prompt with a single effect answers itself (`DuelController`, sent to a
  peer like any answer): one Spirit returns without a dialog. With several the picker stays, because a forced list can
  also hold optional effects of the same moment (seen in random duels: Labyrinth of Nightmare + Sinister Serpent, Venom
  Swamp + Manticore of Darkness) and the message doesn't mark which are which. Not seen: Asura Priest attacking every
  monster (setup boards start on turn 1, which has no Battle Phase; in a later turn the AI's Ring of Destruction got
  it first). The picker's caption "SEND TO HAND" is cut to "SEND TO HAN" (card-width captions).
- Toon: works with the existing UI, no changes. `&setup=toon` (Toon World face-up): Toon Mermaid SP.SUM from the hand,
  Toon Summoned Skull SP.SUM tributing Celtic Guardian (picked on the board), Toon Gemini Elf Normal Summoned;
  Mystical Space Typhoon on your Toon World sends all three Toons to the Graveyard with it (no dialog). Not seen:
  Toon attacks (direct attacks, Toon Summoned Skull's 500 LP to attack): setup boards start on turn 1.
- Zone disabling: picking the zones (SELECT_DISFIELD) already worked (the board's zone picker, free zones of both
  sides). New: disabled zones are shown, darkened with a faint X in the field's line colour (user's pick of four
  mockups): `DuelSession` keeps the last FIELD_DISABLED mask in the snapshot (`disabledZones`), `BoardView` draws it
  under the cards. `&setup=zones`: Ground Collapse on your and the opponent's leftmost Monster Zone, both marked; a
  later summon's zone choice skips the disabled one. Not seen: the mark clearing when Ground Collapse leaves. Ojama King
  / Ojama Knight are Fusions (not tried here).
- Alternate wins: the engine ends the duel itself (WIN message with a reason). New: the end dialog says why under
  WIN / LOST / DRAW ("LP REACHED 0", 'BY THE EFFECT OF "DESTINY BOARD"'): `build-data` exports strings.conf `!victory`,
  `DuelSession` passes the WIN reason on (`StepResult.winReason`, `onEnd(winner, reason)`). `&setup=exodia` wins at
  once (checked in the browser). Destiny Board, checked headless against a passive opponent: placed "I"/"N"/"A"/"L"
  on turns 2/4/6/8, then won (reason 0x15); it counts only the messages it placed itself, so `&setup=destiny` starts
  with the four in hand (in the browser the AI's Heavy Storm + Prohibition stopped it). Final Countdown / Vennominaga:
  not tried (20 turns / 3 counters); same WIN path.
- Counter kinds: already handled before phase 5 (user confirmed): the badge on the card shows the total, the info
  panel lists each kind with its own count.

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
