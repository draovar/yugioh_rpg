# Architecture

How the code is organised and how each part works. CLAUDE.md has the commands, rules and engine facts; this file has
the details per module. Keep it in sync when moving or reworking code.

```
src/main.ts, Boot.ts   game config, preload, dev URL routing
src/duel/              engine layer, no Phaser: DuelController, rps
  engine/              DuelSession, loadEngine, cardData, text, hash, rng
  decks/               decks (prebuilt), deckRules (deck editor rules + card list), cardSearch
  ai/                  the opponent AI (+ autoBot, boardText)
src/net/               peer-to-peer networking, no Phaser
src/overworld/         Overworld scene, WorldMenu, DialogBox, TouchPad, characters, npcs, ambush, sortedWalls
src/duel-screen/       DuelScene, duelPrompts and the duel UI (cards, modal, info panel, animator, field, layout)
src/deck-editor/       DeckEditor scene, its layout, list rows, filter panel, dialogs
src/lobby/             multiplayer Lobby scene
src/ui/                shared UI: pixel text, widgets, theme, prefs, textInput, touch
src/dev/               dev-only: &anims / &dialogs previews, &setup boards, frame capture
tools/data|art|maps|ai|test/   Node scripts by purpose; tools/lib/ shared helpers
data/                  pool.json (the card pool, generated) + pool-exceptions.json, card-versions.json (older versions), maps, characters, palette
vendor/                Project Ignis repos, art downloads, paid assets (gitignored)
```

## Engine layer (`src/duel/`)

No Phaser imports: runs unchanged in Node (tools) and the browser.

- `engine/DuelSession.ts`: wraps one duel. `advance()` runs until a prompt/end, `respond()` answers it,
  `snapshot(viewer)` reads the board from the engine with hidden info masked. Options for the AI's copies (defaults =
  a normal duel): `startingLP` per player, `draws` (opening hand / per turn), `extraFlags` (e.g. attack on the first
  turn), `prepared` (an engine duel from `prepareDuel()` with the base scripts already loaded, the slow ~15 ms part;
  LP are then set by a `Duel.SetLP` script after `startDuel`). Start cards (`deck.start`, dev setups and AI copies)
  can carry equip links, persistent Traps' card targets and control handovers (`StartCard.equipTo` / `cardTargets` /
  `control`), linked by a one-off effect at the first draw phase.
- `DuelController.ts`: the local player (`me`, either seat) vs the AI or a `RemotePeer`; emits `onUpdate` / `onPrompt`
  / `onEnd` / `onError`, auto-passes empty chain prompts (both seats, unsent) and, per the local player's chain mode
  (`ChainMode`: auto = only when `spe_count` > 0 like YGOPro, all, off), hides their optional chain prompts (answered
  "no" and sent like any answer). Takes any `AiPlayer` and awaits its decision (started at once, answered after
  `aiDelayMs` at the earliest). Peer-to-peer duels run in **lockstep**: both machines run the same duel (same seed,
  same two decks) and send only the answers to their own prompts, each with `DuelSession.checksum()` from before it
  was applied; a mismatch stops the duel ("out of sync"). Anything that differs between the two machines (non-seeded
  randomness in the engine layer, deck order, data) splits the duel.
- `engine/text.ts`: `DuelText.describe(desc)` resolves system strings and `aux.Stringid` card strings; counter names
  from strings.conf `!counter` (`DuelText.counterName`); `coinCallText` reads a coin call's HINT.
- `engine/rng.ts`: `mulberry32`, `shuffle`: seeded randomness (deck shuffle, the AI's rng from the duel seed).
- `engine/cardData.ts`: `CardRecord` (JSON shape) → `OcgCardData`; `CardDb` lookup + names; `TYPE` = named card type bits.
- `engine/hash.ts`: `fnv1a`, used for board checksums and the data fingerprint (both machines must hash the same way).
- `engine/loadEngine.ts`: browser only: fetches `public/data/*.json`, inits the core once.
- `decks/decks.ts`: prebuilt decks (NPCs, the AI, the deck editor's LOAD): `yugi`, `kaiba`, `goat` + Extra Decks;
  starter decks `kaibaEvolution`, `yugiEvolution` (the Evolution starter decks with the owner's swaps); structure
  decks `zombieMadness` (as printed), `dragonsRoar` (owner's swaps). `deckProblems()` = legality check (40-60 main,
  ≤15 extra, ≤3 copies, no tokens, all in the pool).
- `decks/deckRules.ts`: the deck editor's rules and card list: `DECK_RULES`, `addProblem` (3 copies, 60 main, 15
  extra; Fusions go to the Extra Deck), `CardList.find` (every word in the name or, after the name matches, in the
  card text; filters; sort TYPE / NAME / LEVEL / ATK / DEF), filter groups (CARD, MONSTER, ATTRIBUTE, LEVEL, TYPE,
  SPELL/TRAP; only options some pool card has; one-value groups (`single`: all but MONSTER) keep one pick
  (`toggleFilter`), MONSTER picks are alternatives, groups combine), `sortDeck` (how the deck is laid out).
- `decks/cardSearch.ts`: typed card-name search for declarations.
- `rps.ts`: rock-paper-scissors before each duel (`rpsWinner`, `RpsOpponent`: the AI picks at random and goes first
  when it wins; peer-to-peer via `NetDuel.rps`). The winner picks first/second, which sets the seats (seat 0 goes first).

## Opponent AI (`src/duel/ai/`)

Plan and milestones: `docs/ai-plan.md`; current work: `docs/ai-rework-plan.md`; misplay log: `docs/ai-reports.md`.

- **The gate**: `AiSeat` is the only AI code touching the engine. `observe()` gets every step's raw messages and runs
  them through `redact()` (the one gate: hidden codes → 0, other players' prompts and private hints dropped, like
  ygopro's server) into `AiMemory` (turn/phase, open chain + targets, attacks and Normal Summons this turn, `seen`
  codes per owner, the pending select hint). `decide()` builds an `AiView` (`snapshot(seat)`, memory, hint, seeded rng)
  for a `Brain`, which returns a `Decision` (response + reason + scored options). Brains never get the session or raw
  messages, and are built with a `BrainContext` holding the rules engine (`core`, `cards`, `readScript`), never the
  duel. A boss that peeks at your hand would be an explicit `AiSeat` option, never a brain reading the session.
- `trace.ts` turns decisions into lines (`&aitrace`, `arena --trace`); `boardText.ts` prints the whole board (the
  L key with `&aitrace`).
- `brains.ts`: brains by name. `generic` (card data alone, fast), `planner` (the default, `DEFAULT_BRAIN`: generic + a
  `Simulator`, which makes it plan turns and replay chains), `autobot` (`autoBot.ts`: always-legal dumb responder, also
  the fallback when a brain throws; `freePlaces()` decodes SELECT_PLACE masks, `declarableCards` filters declaration
  candidates by the prompt's opcodes, `pickTributes` handles Double Tribute monsters).
- `board.ts`: card values in "cards" (all constants in `Weights` / `DEFAULT_WEIGHTS`; a brain's own weights ride on
  `AiView.weights` into its simulations), `evaluate()`, finding cards in the snapshot. The LP and hand-card weights are
  fitted to who won (`tools/ai/fit-eval.ts`).
- `generic/` = the M1 brain from card data alone:
  - `idle`: scores every main-phase action (summon vs set by survival, tribute cost, sets wait for Main 2 when attacking).
  - `battle`: lethal first (`lethalAttacks` tries every way to clear known monsters, even trades included, and go
    direct); else best killable target, weakest attacker that kills it, target remembered for the 549 prompt.
  - `chain`: responds only to the opponent and only when `spe_count` > 0, never to its own link; timing margins per
    situation for the planner's chain replays.
  - `select`: by the HINT_SELECTMSG purpose: bad for the owner → their best / our worst, good → best, equip → our best,
    or their best when only theirs fit.
  - `misc`: position (attack when it beats or can destroy one of theirs, unless that costs all our LP or, with the
    simulator, a copy shows attacks locked this turn (`Simulator.canAttackThisTurn`); a monster of ours summoned in the
    opponent's turn instead gets the position that comes out best when the rest of their turn is replayed,
    `decidePositionInTheirTurn` / `replayPositions`); declarations.
  - `plan.ts`: follows the planner's plan step by step while the real board matches the plan's `checkpoints`
    (`boardDigest`), replans otherwise, battles with the usual logic after a finished plan and plans Main Phase 2 afresh.
- `sim/` = the simulator:
  - `world.ts` lays the AiView out as a fresh duel (AI = team 0; the opponent's hidden cards and Decks become blank
    stand-ins, codes 1-4 with empty scripts, one of them an average 1600 ATK monster in their hand, a guess that gets
    only `guessDominance` (0.5) of the beats-their-best bonus; the AI's Deck = its decklist minus the cards it can see).
    The copy loses once-per-turn uses, counters and the turn number (equip links and persistent Traps' card targets,
    e.g. Shadow Spell's lock, are kept; a monster the other side controls goes back to its owner's side and is handed
    over as the copy starts, `CardView.owner` / `StartCard.control`, so destroying Snatch Steal returns it); such moves
    fall back to the M1 score. `copyScripts` skips the rule files GOAT never uses (Synchro, Xyz, Pendulum, Link, Skill,
    Rush; not Maximum, Polymerization's helpers need it).
  - `simulator.ts` plays one main-phase action in a copy (`idleAction`: activations, summons, special/flip summons;
    follow-up prompts by the generic brain, the opponent passes) and returns `evaluate(after) − evaluate(before)`.
    When no plan can be made, the planner scores activations by it and adds to its summon scores the "surprise": what
    the copy shows beyond the rule of thumb (a Monarch's effect, with no other target, destroying itself; a flip
    effect). It keeps a pool of up to 24 prepared copies (`prepareOne`), filled while the human thinks (`Brain.idle` ←
    `AiSeat.idle` ← `DuelController`, one copy per 40 ms step) and freed at the duel's end (`dispose`). Copy from the
    pool ≈ 2.6 ms vs 19 ms built from scratch. (Sampled opponent worlds, rework phase 2, measured no better and were
    removed; they're in git history at 1095a52.)
  - `sequence.ts` = the turn planner's building block: `Simulator.sequence(view, steps, { opponentTurn })` plays a
    list of the AI's own moves (`PlanStep`: main-phase action, attack with a target zone, leaving the battle phase) in
    one copy, follow-ups answered by the generic brain, and returns how many steps worked, the board value (after the
    opponent's next turn if asked) and the next possible steps.
  - `options.ts`: finding an option again in a copy's prompt (`idleList`, `findSame`).
  - `planner.ts` = the turn planner: `planTurn` beam-searches move sequences (root moves from the real prompt, deeper
    ones from each copy's `next`; a move whose first pick hit one of the opponent's cards is also tried on each other
    card of theirs it could pick, `PlanStep.pick`, followed in the real duel via `BrainState.pickTarget`), scoring each
    plan by playing it, then a battle phase with the generic battle logic (`battleAfter`), then the opponent's turn.
    Plans reaching the same board merge; all copies of one search share one order for the AI's unknown Deck (else a
    luckier Pot of Greed draw, not the better move, wins a comparison); a plan that draws from that Deck (Pot of Greed,
    Reload; the copy reports it, `SequenceResult.drewAt`) ends with the draw and scores the average over `drawSamples`
    (4) Deck orders, each played on with the drawn cards (summons and sets only, `SequenceOptions.playOn`), so Reload
    isn't judged on one guessed draw. Budgets: `DEFAULT_PLAN_SETTINGS` (beam 3, depth 6, 8 children, 60 copies, 2 s;
    plus up to 2 plans whose last move unlocked a new summon or activation, e.g. Soul Exchange → a Tribute Summon,
    kept however bad they look so far). Plans within 0.05 of the best count as tied: the one dealing more damage in our
    turn wins, then the one with more summons. It enforces what copies don't know (Normal Summon used, monsters that
    attacked, no battle on turn 1 / after Main 2).
  - `replay.ts` = M3 (the planner's chain answers): a chain prompt in the opponent's turn (or their chain link in the
    AI's turn, `replayLink`) is answered by replaying what they did (`situationOf`: their chain link with its real
    targets, attack, summon, or the phase) in a copy where they move first, trying each candidate during that action,
    playing on to the end of their turn (no more Normal Summons than they have left, no second attack for monsters that
    already attacked), and comparing. `replayPositions` plays positions the same way.
- `worker/` = the AI in a Web Worker (the game's default; `&noworker` = main thread): `AiWorkerClient` (main thread, an
  `AiPlayer` like `AiSeat`) redacts messages and masks the board before posting them, so hidden info never leaves the
  main thread; `aiWorker.ts` runs an AiSeat with its own engine and fills its copy pool between decisions; a shadow
  AiSeat on the main thread sees the same messages and answers if the worker can't start or fails.

## Networking (`src/net/`)

Browser only, no Phaser. `p2p.ts`: PeerJS (WebRTC) rooms; the host opens `ygorpg-<CODE>` on PeerJS's free public
server, the guest connects, the handshake checks `PROTOCOL` + `Engine.fingerprint` (hash of the card data and scripts),
each side sends its deck as a passcode list (checked with `deckProblems`), the host sends the seed; then
rock-paper-scissors packets (`rps` hands, the winner's `order`) decide the seats. Pings every 3 s; 20 s of silence or a
"bye" = opponent left; a "surrender" packet (FORFEIT) makes the opponent win. Room codes use letters that tiny5 can't
confuse with digits. `wire.ts`: response encoding (bigints). The `Lobby` scene (`src/lobby/`) hosts/joins a duel and
passes the `NetDuel` to `Duel`.

## Overworld (`src/overworld/`)

`Boot` → `Overworld`: the Tiled map from `build-tiles`, Arcade physics (scene-local config), arrow keys, hold Z to run
(`RUN_SPEED` 1.5x, the run frames).

- Player: `player` / `player-run` or `player-girl` / `player-girl-run` (`PLAYER_LOOKS`, world menu PLAYER: BOY / GIRL,
  `playerLook()` in `prefs.ts`). 32px character frames (`characters.png`, by name: `frameOf`, `walkAnim` in
  `characters.ts`) drawn at 2x.
- Map layers: ground layers (every `ground*` layer, in map order) and wall layers (every `walls*` layer: walls,
  walls2...; they collide and y-sort together, a later layer drawn over an earlier one on the same base) are baked into
  RenderTextures once (`bake` in `sortedWalls.ts`: live tilemap layers re-culled every tile each frame, 4.2 → 0.6 ms a
  frame on a desktop). Wall tiles are redrawn in layers y-sorted with the characters by their base row
  (`buildSortedWalls`). An optional hidden `collision` tile layer blocks wherever it has a tile and counts as collision
  for the y-sort (walls' own tiles collide by the tileset's `collision` property).
- Warps: maps link through `warp` rectangles in their `objects` layer (properties `map`, `spawn` = the arrival point's
  name there, `keepY` = keep the height: town and maze sit side by side, tops aligned, town's right edge ↔ maze's left
  meadow, by the entrance); a warp fades out and restarts the scene on the target map (loaded on first visit in
  `preload`); an arrival on something solid is nudged to the nearest free spot (`freeY`). `&map=NAME` starts on another
  map at its `spawn` point.
- NPCs (`NPCS` in `npcs.ts`, per map: name, `sprite` = character name, optional `facing`, text, their own deck; they turn
  to the player while talking) talk with X / Enter / Space in a `DialogBox` (tiny5 at 2x, clickable options); YES
  starts a duel, and the player comes back to the same spot (`savePosition`) with the NPC's line about the result.
- Hedge ambushes (`ambush.ts`, `AMBUSHERS` in `npcs.ts` per map): every tile walked in the maze has a 1/150
  chance to ready an ambush (about 35 s of walking; none for 2100 px, ~30 s, after one; `&ambush`: the first one is
  ready at once). At the next spot that fits, recognised by the hedge tiles' `sheetId`: walking sideways, the hedge face
  ahead (3 face tiles wide) shakes, a dark hollow with eyes opens in it, the NPC pushes their head out and leaps in
  front of the player; walking up or down, a vertical hedge beside the path ahead (3 tiles of its side) shakes and the
  NPC leaps out of it sideways onto the path, 64 px ahead (frames from `build-ambush`, leaf particles, the "!" balloon
  over the player). The scene keeps the player still while `busy`.
  The ambusher is picked at random from the map's list. Placeholder until ambush duels exist: the NPC says their
  line, then leaps back into the hedge.
- Touch devices: a semi-transparent D-pad (diagonals, keeps steering when the finger slides off) and X button
  (`TouchPad.ts`), with the dialog between them. `TOUCH` in `src/ui/touch.ts` = coarse pointer (`&touch` forces it).
- `WorldMenu`: overlay scene launched by Overworld (so it doesn't scroll). MENU (M) button top right opens the settings
  panel: PLAYER (boy / girl), your deck (drop-down lists, `makeDropDown` in `src/ui/widgets.ts`, saved in localStorage
  via `src/ui/prefs.ts`, used vs NPCs and in multiplayer), THEME (switch in place), DECK EDITOR, MULTIPLAYER; testing
  aids: AI DECK (only for QUICK DUEL; NPCs bring their own decks), AI CARDS = show the AI's hand and set cards in duels
  (`DuelControllerOptions.revealOpponent`: the human's view only, never in multiplayer; set cards drawn face-up at 60%
  alpha), QUICK DUEL, FULL SCREEN where the browser supports it.
- Decks offered everywhere come from `prefs.ts`: `deckEntries()` = prebuilt + custom decks with 40+ Main Deck cards,
  keyed `custom:<id>`, which YOUR DECK / AI DECK, NPC duels and multiplayer use (`chosenDeck()` / `aiDeck()` return
  the deck itself).

## Duel screen (`src/duel-screen/`)

`Duel` scene = `DuelScene`, takes `DuelSceneData`.

- **Seats**: the duel screen draws the local seat at the bottom: player → screen side via `side(player)`; never assume
  P0 is "you". Before the engine starts, `DuelScene.decideFirst` plays rock-paper-scissors on the board (`RpsIntro.ts`:
  both draw ROCK/PAPER/SCISSORS, set one face-down in the middle Monster Zone, both flip, the loser's card flashes red,
  the winner gets a FIRST/SECOND dialog; a draw replays); `me` is only known after it.
- **Redraw**: `DuelScene` redraws the whole board from `snapshot()` after every engine step (`BoardView`: cards, piles,
  hand, counter badges, equip links). The phase boxes are `PhaseColumn`, the corner buttons `cornerButtons.ts`, the
  prompt strip `PromptBand`, the `&aitrace` replay line and L-key board log `aiTrace.ts`. In dev builds
  `window.duelScene` exposes the scene (`.controller.waitingForHuman`, `.animator.current`, `.animator.speed`).
- **Prompts**: `duelPrompts.ts` (`showPrompt`, through a `PromptHost`) maps each SELECT_* prompt to UI: card action menus
  (idle/battle), board picks and zone highlights (`BoardPick`), and `Modal` dialogs/card pickers for everything else.
  - Calling a coin (`SELECT_OPTION` between system strings 60/61) gets `Modal.coinCall` (the two coin faces); the call
    comes back as HINT type 4 (`coinCallText`): logged, and the opponent's pauses on a "YOUR OPPONENT CALLED: …" notice.
  - Declarations (`ANNOUNCE_*`): Type / Attribute / number as button dialogs, card names in `Modal.search` (typed
    search, `cardSearch.ts`; candidates filtered by the prompt's opcodes via `declarableCards` in `autoBot.ts`). The
    engine's HINT after each one is logged ("You declare DARK") and the opponent's declarations pause the duel on a
    "YOUR OPPONENT DECLARED: …" OK dialog (text only; `AnimHost.notice`).
  - Removing counters (`SELECT_COUNTER`) is picked on the board like tributes (`BoardPick.counters`: one counter per
    click, badges count down).
  - Ordering cards (`SORT_CARD`, Big Eye) = `Modal.sortCards`: click the cards in order, number badges, RESET / CONFIRM;
    ocgcore-wasm's encoder adds a length byte the core doesn't expect, worked around in `DuelSession.respond`
    (`rawSortOrder`).
  - Rare prompts (`SORT_CHAIN`, RPS) are still auto-answered by `autoBot` (none came up in 150 bot duels with the
    current pool).
- **Card choices** (`BoardPick.cards`, else the dialog): SELECT_CARD / TRIBUTE / UNSELECT_CARD are picked on the board
  when every candidate is a field/hand card (yellow 1px outline = choice, orange 2px = picked; `THEME.pick`), else in
  the `Modal.picker` dialog. The prompt text is centred in the field strip (`PromptBand`); CONFIRM / CANCEL / FINISH sit
  stacked on a dark plate over your Extra Deck slot, with the n/max counter above them.
- **Zone choice** (`BoardPick.places`): free zones in semi-transparent yellow, more opaque on hover / once picked.
- **Card action menu** (`CardMenu.ts`): clicking a card squash-flips it to a card-sized Frame01a with FrameList09a
  buttons (09c on hover) inside its rim, plus BACK. 11px buttons, 4 fit (3 actions + BACK); labels max 30px (SUMMON,
  SET, SP.SUM, USE, ATTACK, FLIP / TO ATK / TO DEF). Your own Deck opens the same menu with FORFEIT (ends the duel as a
  loss outside the engine; in a peer-to-peer duel a "surrender" packet makes the opponent win). The same squash flip
  turns set Spells/Traps face-up (`T.flip`).
- **Prompt dialogs** (`Modal.dialog`): info-panel wood board, message as plain text, list-row buttons (`makeListButton`
  in `widgets.ts`, shared with the card menu). With a card: card (2x) left, text top-right wrapped to the button grid's
  width, buttons centred under it at the bottom; otherwise text over buttons. Boards are 240px wide (408 for 6+ cards).
  Dialogs shade the whole screen; the info panel is drawn above the shade (`INFO_DEPTH`) so it stays bright.
- **Info panel** (`InfoPanel.ts`; the card part is `CardInfo.ts`, shared with the deck editor; positions derive from
  `LAYOUT` in InfoPanel.ts). **Card mode** (default) keeps the last hovered card (starts with the first card you draw);
  **log mode** shows the log and previews cards only while hovered. Long names scroll (marquee) after a short hover
  (Phaser 4 mask filter, `InfoPanel.scrollName`). Counters are listed per kind at the bottom of the type plate
  ("SPELL CTR 2").
- **Corner buttons** (field top-right, stacked above the mat, all 24px wide, saved in localStorage): speed 1X/2X/4X,
  LOG/CARD info panel mode, chain mode AUTO/ALL/OFF (`ChainMode`).
- **Animations** (`DuelAnimator.ts`): timings live in the `T` table at its top (pixel-art style: direct moves, no
  squash/overshoot; faces swap instantly). `DuelAnimator.play(messages)` tweens the displayed sprites per message (draw,
  move, summon, flip, activate, attack, LP, turn banner, reveals, hand shuffles, coin/dice); `DuelController` awaits it
  before the next prompt/AI move, then the scene redraws from the snapshot, so animations only need to *look* right.
  Hover effects are suppressed while `animator.busy`. Reveals (CONFIRM_CARDS) flip hidden cards face-up in place; they
  stay up through the prompt that follows (Confiscation's pick: `animator.revealed`, honoured by the redraw) and flip
  back before the next action. Your own revealed cards just rise. Destroyed cards flash red (only real destructions:
  `MoveMessage.reason`).
- **Layout** (`layout.ts`): info panel 0-219, divider 220-223, phase column x230 (6 boxes 16x56, clickable BATTLE /
  MAIN 2 / END P.), zones are card-sized slots at 58px pitch, piles in the side columns. Banished cards have no zone: a
  `B<n>` badge under the Graveyard, listed when browsing it. Your own Extra Deck can be browsed the same way (the
  opponent's is hidden: `snapshot()` masks face-down cards).
- **Field** (`field.ts`, baked into one RenderTexture: it never changes): cream plank table (the info panel's paper
  colour) with a dark green felt playmat in a Frame01a rim around the four zone rows; zones outlined light green,
  monster zones tinted, empty piles labelled FIELD / EXTRA / GY / DECK.
- **Cards** (`CardSprite.ts`): 38x56 incl. 1px outline. Frames per type in `public/assets/cards/frames/` (drawn by the
  user; `token.png` for tokens); regions: name bar (2,2) 34x5, stars y 7-10, art window 32x32 at (3,12), bottom bar
  (2,46) 34x8. Back: `back.png`. `attributes.png` = 7 16x16 icons: DARK EARTH FIRE LIGHT WATER WIND DIVINE.
  - Counters show as a pile-style number badge on the card's top-right corner (all kinds added up; hidden while
    animating; ocgcore-wasm's parser swaps counter kind and count: `DuelSession.counterList` reads the counts from the
    record's keys).
  - Chain links: `public/assets/duel/chain.png` (32x32 ring, drawn by the user) over the art window with the link
    number at 2x in it (`CardSprite.setChainMark`), from CHAINING until that link's CHAIN_SOLVED, only once the chain
    has 2+ links; `DuelAnimator.chainLinks` keeps the open chain (sprite keys, follows MOVEs) and the redraw re-applies it.
  - Equip links (`CardView.equipTarget`, from the EQUIP_CARD query): hovering an equip card or an equipped monster
    shows the semi-transparent Equip Spell icon (`spells.png` #2) over the partner card's art (`CardSprite.setEquipMark`).
  - Coin toss / die roll sprites (not themed): `public/assets/duel/coin_flip.png` (8 frames 32x32, loop; heads = frame
    0, tails = 4) and `dice.png` (6 frames 16x16, faces 1-6), played at 2x mid-field by `DuelAnimator.toss`.
  - Rock-paper-scissors art: `public/assets/duel/rps.png` (3 frames 32x32: rock, paper, scissors; drawn by the user),
    shown in the token frame via `CardSprite.showPlain`.
- **Themes** (`src/ui/theme.ts`: `runewood` (default), `hologram`; `&theme=NAME`, or the world menu's THEME buttons:
  localStorage "theme"; `setTheme` swaps `THEME`'s contents and reloads the `ui-*` textures, no page reload). A theme
  only changes the look: its template (`mat` = framed playmat like Runewood, `open` = zones straight on the table like
  Hologram), sprites for the `UI_ROLES` (`public/assets/ui/<theme>/<role>.png`, loaded as `ui-<role>`, file mapping +
  trim/flatten/recolor/replace in `tools/art/import-ui.mjs`) described by their nine-slice insets and button-face text
  offsets, the table pattern, and every UI colour. Insets: `*Slice` = sprite border kept when stretching, `rim` /
  `paperRim` = layout insets, equal across themes so the info panel and dialogs lay out identically. Cards and gameplay
  feedback (attack red, summon flashes) are not themed.
- **Dev previews** (`src/dev/`): `&anims` (`animPreview.ts`) replays single animations, `&dialogs` (`dialogPreview.ts`)
  opens every prompt UI with sample cards (numbers match `docs/duel-ui-checklist.md`); both are written for seat 0 =
  you (`previewSeats.ts` swaps seats). `devSetups.ts` = the `&setup` boards. `capture.ts` + `tools/art/make-gif.mjs` =
  frame capture to GIFs.

## Deck editor (`src/deck-editor/`)

The `DeckEditor` scene (world menu → DECK EDITOR); themed like the duel, both templates (felt mat with outlined slots, or slot plates on the
table). Geometry in `layout.ts`.

- Left: the deck (Main Deck 4 rows of 10, squeezed together past 40; Extra Deck under it). Nothing ever covers the deck.
- Right, where the duel's info panel sits: the card list. Search box = an HTML input via `textInput.ts`, with an ALL /
  NAME toggle (card text too or names only); SORT drop-down; FILTERS (`filterPanel.ts`, shown in the list's place:
  toggle buttons per group on a 5-column grid, long labels two cells, LEVEL half cells in one row; `FILTER_COLUMNS = 0`
  = buttons as wide as their labels); 8 rows with art (`listRow.ts`: frame-colour strip, text lines, the eye icon),
  scroll by wheel / drag / scrollbar.
- Click a listed card = add, a deck card = remove. Hovering a listed card's art shows an eye over it; clicking the art
  opens the card's details (`CardInfo`) over the list with ADD / CLOSE (Esc). Hovering a deck card (touch: holding it)
  shows its details over the list while hovered (and closes an opened card: the list is back afterwards).
- Top bar: deck slot drop-down (+ NEW DECK), RENAME, SAVE, DELETE, LOAD (a prebuilt deck or empty), EXIT (unsaved
  changes ask SAVE / DISCARD / CANCEL); the message and rename dialogs are in `dialogs.ts`.
- Custom decks live in localStorage (`prefs.ts`: `customDecks`, up to `MAX_CUSTOM_DECKS`).

## Shared UI (`src/ui/`)

`pixel.ts` (bitmap text via `text()`, crisp 1px borders, `GlyphSnapSubmitter`), `widgets.ts` (wood / list buttons,
drop-downs), `theme.ts` (see Themes above), `prefs.ts` (everything saved in localStorage), `textInput.ts` (text entry
in the canvas: an invisible HTML input over the drawn field for phone keyboards and paste; it pauses Phaser's global
key capture while it exists; card search, lobby room code, deck names), `touch.ts`.

Phones: the page is `100dvh` tall (100vh = the height without the browser bar, which pushed the canvas under it) and
the zoom may go below 1x so the whole screen fits; the first tap goes full screen (`fullscreenOnFirstTap`, Android /
desktop; iPhones have no Fullscreen API: there `manifest.webmanifest` + the apple-mobile-web-app meta tags make the
home-screen app open without the browser bar).

## Tools (`tools/`)

Node scripts; `.ts` ones run directly with Node 24 type stripping (no tsx). CLAUDE.md lists the commands.

- `lib/engine.ts`: shared core + card data loader, `newDuel`, `runDuel` (AI vs AI to the end), `seedFrom(n)` (four
  64-bit seed words from one number). `lib/match.ts`: brain vs brain matches on worker threads (`matchJobs`,
  `runMatch`, `winRate`, `PassivityStats`; also the workers' entry), used by arena and tune. `lib/args.ts`: `--name
  value` option parsing. `lib/palette.mjs` / `art-style.mjs` / `bmfont.mjs` / `indexed-png.mjs`: art quantisation, style knobs, BMFont output, lossless indexed PNG output (card art).
- `data/`: `fetch-data` (CardScripts at the pinned commit + BabelCDB), `build-pool` (TCG products up to the cutoff
  from YGOPRODeck set lists, mapped to BabelCDB passcodes (an alias with the same name is an alt art, one with another
  name a card of its own, e.g. Harpie Lady 1), ± `pool-exceptions.json` by name → `data/pool.json`), `build-data` (pool → `public/data/*.json`, modern versions except the GOAT / pre-errata ones `card-versions.json` picks, under the real passcodes,
  plus the tokens pool scripts create), `check-cards`.
- `art/`: `fetch-art` / `build-art` (YGOPRODeck crops → the shared palette, `art32` atlas + `art128`), `build-palette`,
  `import-ui` (Crusenho pack → theme sprites), `build-pixel-font` / `build-tiny5-font`, `make-gif`.
  - `build-characters`: `data/characters/reshef-sheet.png` (every Reshef of Destruction character, green cells on a
    purple grid) sliced per `data/characters/characters.json` (name → 3x3 block or explicit cells per direction,
    `nudge` = move single frames by pixels; `{ "sheet": "x.png" }` = a ready-made 96x96 sheet in the same layout, drawn
    for this game: `player-girl`, `player-girl-run`; `{ "recolor": base, "hair": [...], "shirt": [...] }` = the base
    with its hair / shirt colour ramps from `recolors` swapped: the `hopper-*` ambushers) → `public/assets/overworld/characters.png`+`.json` (one row of 9
    32x32 frames per character: down / side (facing right) / up × stand, step, step), `props.png`+`.json`,
    `balloons.png`+`.json` (16x16 reaction balloons: heart, dots, exclaim, anger, sweat, question), and the contact
    sheet `docs/characters.png` with every name.
  - `build-ambush` (run by `build-characters`): for each name in characters.json's `ambush` list, a row of 10 32x32
    frames drawn from that character's down and side frames → `public/assets/overworld/ambush/<name>.png`: a dark
    hollow in the hedge face, eyes in it (2), head out through the leaves, crouch, leap, land, 2 leaves (particles), a
    sideways leap. Leaves use the hedge face's greens; no pixels come from the paid tileset.
- `maps/`: `build-tiles` (Tiled map + its external tileset `data/maps/modern-exteriors.tsj`, whose image is the paid
  sheet in `vendor/paid/` → `public/maps/<name>.png` with only the tiles the map uses + `<name>.json` with tile ids
  remapped; each tile keeps its id in the full sheet as the `sheetId` tile property).
  - `hedge-maze.mjs`: maze layout (walls per grid line, extracted from the owner's maze picture) → hedge maze map:
    hedges auto-tiled from the sheet's hedge ring (flowered hedges after each fork of the right path, a subtle hint),
    meadows left/right, pine forests above/below (the only way across is the maze), ground decorations, the hidden
    `collision` layer and a `spawn` point at the entrance. **Overwrites** the .tmj (Tiled edits lost); the maze has
    been edited by hand since.
- `ai/`:
  - `arena`: brain vs brain win rates over seeded duels (every deck pairing, both seat orders) on all CPU cores.
    `--losses` lists A's lost duels, `--only K --trace` replays one duel's decisions, `--sim-trace` adds what happened
    inside each simulated copy, `--stats` prints passivity per side (skipped summons, empty field, unused
    Spells/Traps, attacks into set cards), `--record` writes each turn's starting position (as the turn player sees
    it) and who won, for `fit-eval`. `--a baseline` = the planner in `vendor/baseline` (an older checkout).
  - `tune`: the AI's `Weights` by self-play: random 1-3 weight changes vs the current best, kept at ≥ 53.5% over 720
    duels; writes `vendor/tune/best.json` (resumed) + `log.jsonl`; winners are copied into `DEFAULT_WEIGHTS` by hand.
  - `fit-eval`: fits `evaluate()`'s weights to who won ("Texel tuning": logistic regression on positions from
    `arena --record`, monster values are the unit; held-out duels and bootstrap error bars).
  - `ai-bench` (positions in `ai-bench-positions.ts`): fixed positions with a known right/wrong main-phase choice,
    plan, chain answer or whole turn (`turn: true`: every main-phase and battle choice in order). Every reported
    misplay becomes one, logged in `docs/ai-reports.md`; `known: "<phase>"` positions are misplays waiting for a
    planned fix (`docs/ai-rework-plan.md`) and don't fail the run; positions can place Graveyard cards (`grave()`) and
    script the opponent's turn (`opponentSetsThenBattles`, `opponentAttacks`).
  - `test-ai`: the AI can't see hidden cards: hand-made `redact()` cases + N real duels.
- `test/`: `smoke-duel` (bot-vs-bot duels through `DuelSession`, every deck pairing, deck legality), `smoke-p2p`
  (lockstep duels on an in-memory link).
- `patch-ocgcore.mjs`: npm `postinstall` fix for ocgcore-wasm's message parser (see CLAUDE.md, Engine facts).

## Maps and the Tiled MCP server

Maps can be edited through the Tiled MCP server (`tiled` in `.mcp.json`, local paths: PengLx/TiledMCP built in
`D:/Programming/tools/TiledMCP`, branch `windows-dir-fsync` = a local fix, directory fsync fails with EPERM on Windows).
It edits only maps whose tilesets are external `.tsj` files inside the repo; edits go preview →
`tiled_apply_change_set`, with undo checkpoints in `.tiledmcp/` (gitignored). `tiled_render_preview` refuses the 92 MP
LimeZu sheet (16 MP limit): check maps with `build-tiles` + the game instead. Edited tile layers are saved on one line;
Tiled re-wraps them on save.
