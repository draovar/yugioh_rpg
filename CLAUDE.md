# Yu-Gi-Oh RPG

A Pokémon-style overworld RPG (Phaser 4.2) in which every battle is a real Yu-Gi-Oh duel.
Rendered natively at **640x360** pixel art (`pixelArt: true`), scaled up by whole numbers (2x/3x); the duel
screen follows `docs/layout-sketch.png` exactly.
Duel rules are **not** hand-written: they run on **ocgcore** (Project Ignis / EDOPro core),
compiled to WebAssembly (`ocgcore-wasm` on npm) and started in `MODE_GOAT` (classic / GOAT-era rules).
The reference project this approach comes from is circlenline/DUELIST_KINGDOM_ROGUELIKE (vanilla JS, same engine).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server at http://localhost:5173 (preview config name: `dev`) |
| `npm run typecheck` | `tsc --noEmit` over `src/` and `tools/` |
| `npm run build` | typecheck + production build to `dist/` |
| `npm run fetch-data` | clone/update ProjectIgnis `CardScripts` (**pinned commit**, see Engine facts) + `BabelCDB` (latest) into `vendor/` (gitignored) |
| `npm run build-data` | `data/pool.json` → `public/data/{cards,scripts,strings}.json` (plus the tokens pool cards create) |
| `npm run check-cards` | list pool cards using mechanics the UI doesn't fully support yet (declare, counters, equips, tokens, fusions...) |
| `npm run fetch-art` | download art-only crops for the pool from YGOPRODeck into `vendor/art/` (gitignored) |
| `npm run build-art` | art → shared palette: `public/cards/art32.png`+`.json` atlas (cards) and `public/cards/art128/<code>.png` (info panel) |
| `npm run build-palette` | **rarely**: regenerate the frozen shared palette `data/palette.gpl` from ~400 sampled GOAT arts (+ frames) |
| `node tools/import-ui.mjs [theme]` | copy each theme's UI sprites from the Crusenho pack (`assets/`, gitignored) into `public/assets/ui/<theme>/` |
| `npm run build-fonts` | rebuild bitmap fonts in `public/assets/fonts/` (nerds3 from the TTF, tiny5 from `tools/build-tiny5-font.mjs`) |
| `npm run smoke [-- N]` | play N headless bot-vs-bot duels through `DuelSession` (bots in `AiSeat`s); fails on RETRY/crash |
| `npm run smoke-p2p [-- N]` | play N peer-to-peer lockstep duels (two `DuelController`s on an in-memory link); fails if the machines disagree |
| `npm run arena -- [--a B1] [--b B2] [--n N] [--decks ...] [--seed S] [--wa W.json] [--wb W.json] [--jobs N] [--only K] [--trace] [--sim-trace] [--losses]` | brain vs brain win rates over seeded duels (every deck pairing, both seat orders), on all CPU cores (worker threads); `--losses` lists A's lost duels, `--only K --trace` replays one duel's decisions, `--sim-trace` adds what happened inside each simulated copy |
| `npm run tune -- [--brain sim] [--rounds 20] [--quick 10] [--long 30] [--seed S]` | tune the AI's `Weights` by self-play: random 1-3 weight changes vs the current best, kept at ≥ 53.5% over 720 duels; writes `vendor/tune/best.json` (resumed) + `log.jsonl`; winners are copied into `DEFAULT_WEIGHTS` by hand |
| `npm run ai-bench [-- --brain NAME] [-- --show]` | fixed positions with a known right/wrong main-phase choice (`tools/ai-bench.ts`); every reported misplay becomes one |
| `npm run test-ai [-- N]` | the AI can't see hidden cards: hand-made `redact()` cases + N real duels (default 30) |

Fresh clone: `npm install && npm run fetch-data && npm run build-data && npm run fetch-art && npm run build-art`.
After changing `data/pool.json`, rerun `build-data`, `check-cards`, `fetch-art`, `build-art`, then `smoke` (it validates
the decks in `src/duel/decks.ts` and plays every deck pairing). `fetch-art`/`build-art` read `public/data/cards.json`, so
tokens get art too.

Deploy: every push to `main` runs `.github/workflows/deploy.yml` (the fresh-clone pipeline + `smoke -- 3` + `smoke-p2p -- 3` + `test-ai` + `build`)
and publishes `dist/` to GitHub Pages: https://draovar.github.io/yugioh_rpg/ . Never upload a local `dist/`: Vite
copies all of `public/`, including the gitignored paid tilesets.

Multiplayer URLs (work in the deployed game too): `?mp` opens the multiplayer lobby, `?join=CODE` joins a room.
Dev URL options: `&anims` adds a dropdown (top-left) to replay single animations (`src/scenes/animPreview.ts`);
`&dialogs` adds one that opens every prompt UI with sample cards (`src/scenes/dialogPreview.ts`; answers are only
logged, then the real prompt returns; numbers match `docs/duel-ui-checklist.md`);
`/?duel` starts straight in a duel, `&lp=500` sets starting LP, `&seed=N` replays the same duel,
`&deck=NAME` / `&opp=NAME` pick the prebuilt decks (`yugi`, `kaiba`, `goat`, `kaibaEvolution`, `yugiEvolution`; default Yugi vs Kaiba),
`&first=you` / `&first=opp` skip rock-paper-scissors (`&seed` and `&setup` skip it too, you going first),
`&setup=NAME` starts from a test board (`src/scenes/devSetups.ts`: `tribute`, `scapegoat` (use `&deck=goat`), `fusion`
(`&deck=kaiba`), `declare`, `counters`, `equip`, `coin`, `sort`, `confiscation`, `ritual` (`&deck=kaibaEvolution`); cards placed in hand/on the field first),
`&ai=NAME` picks the opponent's brain (`src/duel/ai/brains.ts`: `planner` (default, `DEFAULT_BRAIN`), `replay`, `sim`, `generic`, `autobot`),
`&noworker` makes the AI think on the main thread instead of its Web Worker, `&reveal` shows the AI's hand and set cards
(also the world menu's AI CARDS toggle), `&aitrace` prints every AI decision
to the console (also in the deployed game, for misplay reports), after a first line with the duel seed, who went first,
the decks and brain and a `?duel&seed=…&first=…` URL that replays the same duel (duels vs the AI always use a seed that fits `&seed=N`); with it, the L key logs the whole board, both hands and set
cards included (`src/duel/boardText.ts`),
`&timeout` keeps the game loop running when the tab/pane is hidden (rAF pauses there, which freezes the duel).
Use `&timeout` for automated browser testing; a hidden pane still throttles timers to ~1 fps, so animations look
choppy in screenshots. In dev builds `window.duelScene` exposes the scene (`.controller.waitingForHuman`,
`.animator.current`, `.animator.speed`).

## Layout

- `src/duel/` — engine layer, **no Phaser imports**. Runs unchanged in Node (tools) and the browser.
  - `DuelSession.ts` — wraps one duel: `advance()` runs until a prompt/end, `respond()` answers it,
    `snapshot(viewer)` reads the board from the engine with hidden info masked.
    Options for the AI's copies (defaults = a normal duel): `startingLP` per player, `draws` (opening hand / per turn),
    `extraFlags` (e.g. attack on the first turn), `prepared` (an engine duel from `prepareDuel()` with the base scripts
    already loaded, the slow ~15 ms part; LP are then set by a `Duel.SetLP` script after `startDuel`).
  - `DuelController.ts` — the local player (`me`, either seat) vs the AI or a `RemotePeer`; emits `onUpdate`/`onPrompt`/
    `onEnd`/`onError`, auto-passes empty chain prompts (both seats, unsent) and, per the local
    player's chain mode (`ChainMode`: auto = only when `spe_count` > 0 like YGOPro, all, off), hides their optional
    chain prompts (answered "no" and sent like any answer). Peer-to-peer duels run in **lockstep**: both machines run the
    same duel (same seed, same two decks) and send only the answers to their own prompts, each
    with `DuelSession.checksum()` from before it was applied; a mismatch stops the duel ("out of sync"). Anything that
    differs between the two machines (non-seeded randomness in the engine layer, deck order, data) splits the duel.
  - `text.ts` — `DuelText.describe(desc)` resolves system strings and `aux.Stringid` card strings.
  - `autoBot.ts` — always-legal dumb responder (the `autobot` brain, fallback when a brain throws). `freePlaces()` decodes SELECT_PLACE masks.
  - `ai/` — the opponent AI (plan and milestones: `docs/ai-plan.md`). `AiSeat` is the only AI code touching the engine:
    `observe()` gets every step's raw messages and runs them through `redact()` (the one gate: hidden codes → 0, other
    players' prompts and private hints dropped, like ygopro's server) into `AiMemory` (turn/phase, open chain + targets,
    attacks this turn, `seen` codes per owner, the pending select hint); `decide()` builds an `AiView` (`snapshot(seat)`,
    memory, hint, seeded rng) for a `Brain`, which returns a `Decision` (response + reason + scored options). Brains never
    get the session or raw messages. `trace.ts` turns decisions into lines (`&aitrace`, `arena --trace`). Brains by name
    in `brains.ts`. A boss that peeks at your hand would be an explicit `AiSeat` option, never a brain reading the session.
    `board.ts`: card values in "cards" (all constants in `Weights` / `DEFAULT_WEIGHTS`; a brain's own weights ride on
    `AiView.weights` into its simulations), `evaluate()`, finding cards in the snapshot. `generic/` = the M1 brain from card
    data alone: `idle` scores every main-phase action (summon vs set by survival, tribute cost, sets wait for Main 2 when
    attacking), `battle` (best killable target, weakest attacker that kills it, target remembered for the 549 prompt),
    `chain` (responds only to the opponent and only when `spe_count` > 0, never to its own link), `select` (the
    HINT_SELECTMSG purpose: bad for the owner → their best / our worst, good → best), `misc` (position, declarations).
    `sim/` = M2: `world.ts` lays the AiView out as a fresh duel (AI = team 0; the opponent's hidden cards and Decks
    become blank stand-ins, codes 1-3 with empty scripts; the AI's Deck = its decklist minus the cards it can see),
    `simulator.ts` plays one main-phase action there (`idleAction`: activations, summons, special/flip summons; follow-up
    prompts by the generic brain, the opponent passes) and returns `evaluate(after) − evaluate(before)`; the `sim` brain
    scores activations by it, and adds to its summon scores the "surprise": what the copy shows beyond the rule of thumb
    (a Monarch's effect, with no other target, destroying itself; a flip effect). Brains are built with a
    `BrainContext` holding the rules engine (`core`, `cards`, `readScript`), never the duel. The copy loses
    once-per-turn uses, counters and the turn number (equip links are kept: `StartCard.equipTo`); such moves fall back to the M1 score.
    Copies are fast: `copyScripts` skips the rule files GOAT never uses (Synchro, Xyz, Pendulum, Link, Skill, Rush;
    not Maximum, Polymerization's helpers need it), and the `Simulator` keeps a pool of up to 24 prepared copies
    (`prepareOne`), filled while the human thinks (`Brain.idle` ← `AiSeat.idle` ← `DuelController`, one copy per 40 ms
    step) and freed at the duel's end (`dispose`). Copy from the pool ≈ 2.6 ms vs 19 ms built from scratch.
    `sim/sequence.ts` = the turn planner's building block: `Simulator.sequence(view, steps, { opponentTurn })` plays
    a list of the AI's own moves (`PlanStep`: main-phase action, attack with a target zone, leaving the battle phase)
    in one copy, follow-ups answered by the generic brain, and returns how many steps worked, the board value (after
    the opponent's next turn if asked) and the next possible steps. `sim/options.ts`: finding an option again in a
    copy's prompt (`idleList`, `findSame`).
    `sim/planner.ts` = the turn planner (brain `planner`): `planTurn` beam-searches move sequences (root moves from the
    real prompt, deeper ones from each copy's `next`), scoring each plan by playing it, then a battle phase with the
    generic battle logic (`battleAfter`), then the opponent's turn; plans reaching the same board merge; all copies of one search share one order
    for the AI's unknown Deck (else a luckier Pot of Greed draw, not the better move, wins a comparison); budgets
    `DEFAULT_PLAN_SETTINGS` (beam 3, depth 6, 8 children, 60 copies, 2 s). It enforces what copies don't know (Normal
    Summon used, monsters that attacked, no battle on turn 1 / after Main 2). `generic/plan.ts` follows the plan step by
    step while the real board matches the plan's `checkpoints` (`boardDigest`), replans otherwise, battles with the
    usual logic after a finished plan and plans Main Phase 2 afresh.
    `worker/` = the AI in a Web Worker (the game's default): `AiWorkerClient` (main thread, an `AiPlayer` like `AiSeat`)
    redacts messages and masks the board before posting them, so hidden info never leaves the main thread; `aiWorker.ts`
    runs an AiSeat with its own engine and fills its copy pool between decisions; a shadow AiSeat on the main thread
    sees the same messages and answers if the worker can't start or fails. `DuelController` takes any `AiPlayer` and
    awaits its decision (started at once, answered after `aiDelayMs` at the earliest).
    `sim/replay.ts` = M3 (brain `replay`): a chain prompt in the opponent's turn is answered by replaying what they did
    (`situationOf`: their chain link, attack, summon, or the phase) in a copy where they move first, trying each
    candidate during that action, playing on to the end of their turn, and comparing; timing margins per situation in
    `generic/chain.ts`.
  - `rng.ts` — `mulberry32`, `shuffle`: seeded randomness (deck shuffle, the AI's rng from the duel seed).
  - `cardData.ts` — `CardRecord` (JSON shape) → `OcgCardData`; `CardDb` lookup + names; `TYPE` = named card type bits.
  - `hash.ts` — `fnv1a`, used for board checksums and the data fingerprint (both machines must hash the same way).
  - `decks.ts` — prebuilt decks until the deck editor exists (`yugi`, `kaiba`, `goat` + Extra Decks; starter decks like
    `kaibaEvolution`, `yugiEvolution` = the Evolution starter decks with the owner's swaps), `deckProblems()` legality check (40-60 main, ≤15 extra, ≤3 copies, no tokens, all in the pool).
  - `rps.ts` — rock-paper-scissors before each duel (`rpsWinner`, `RpsOpponent`: the AI picks at random and goes
    first when it wins; peer-to-peer via `NetDuel.rps`). The winner picks first/second, which sets the seats (seat 0 goes first).
  - `loadEngine.ts` — browser only: fetches `public/data/*.json`, inits core once.
- `src/net/` — browser-only networking, no Phaser. `p2p.ts`: PeerJS (WebRTC) rooms; the host opens `ygorpg-<CODE>` on
  PeerJS's free public server, the guest connects, handshake checks `PROTOCOL` + `Engine.fingerprint` (hash of the card
  data and scripts), each side sends its deck as a passcode list (checked with `deckProblems`), the host sends the
  seed; then rock-paper-scissors packets (`rps` hands, the winner's `order`) decide the seats. Pings every 3 s; 20 s of silence or a "bye" =
  opponent left. Room codes use letters that tiny5 can't confuse with digits. `wire.ts`: response encoding (bigints).
- `src/scenes/` — Phaser scenes. `Boot` → `Overworld` (placeholder grid map; bottom bar: deck choice (drop-up lists, `makeDropUp` in
  `src/ui/widgets.ts`) saved in localStorage via `src/ui/prefs.ts`, used vs the Rival and in multiplayer; THEME buttons (switch in place);
  MULTIPLAYER button / M key; second row (testing aids): AI DECK = the Rival's deck, AI CARDS = show the AI's hand and
  set cards in duels (`DuelControllerOptions.revealOpponent`: the human's view only, never in multiplayer; set cards
  drawn face-up at 60% alpha)) → `Duel` (`DuelScene`,
  takes `DuelSceneData`); `Lobby` hosts/joins a peer-to-peer duel and passes the `NetDuel` to `Duel`. The duel screen
  draws the local seat at the bottom: player → screen side via `side(player)`, never assume P0 is "you".
  Before the engine starts, `DuelScene.decideFirst` plays rock-paper-scissors on the board (`src/ui/duel/RpsIntro.ts`:
  both draw ROCK/PAPER/SCISSORS, set one face-down in the middle Monster Zone, both flip, the loser's card flashes red,
  the winner gets a FIRST/SECOND dialog; a draw replays); `me` is only known after it.
  `DuelScene` redraws the whole board from `snapshot()` after every engine step; `src/scenes/duelPrompts.ts`
  (`showPrompt`, through a `PromptHost`) maps each SELECT_* prompt to UI: card action menus (idle/battle), board picks
  and zone highlights (`BoardPick`), and `Modal` dialogs/card pickers for everything else. The info panel is
  `src/ui/duel/InfoPanel.ts`. The `&anims` / `&dialogs` previews are written for seat 0 = you (`previewSeats.ts` swaps seats).
  Calling a coin (`SELECT_OPTION` between system strings 60/61) gets `Modal.coinCall` (the two coin faces); the call
  comes back as HINT type 4 (`coinCallText`): logged, and the opponent's pauses on a "YOUR OPPONENT CALLED: …" notice.
  Declarations (`ANNOUNCE_*`): Type / Attribute / number as button dialogs, card names in `Modal.search` (typed search,
  `src/duel/cardSearch.ts`; candidates filtered by the prompt's opcodes via `declarableCards` in `autoBot.ts`). Text entry
  in the canvas = `src/ui/textInput.ts` (card search, lobby room code): an invisible HTML input over the drawn field (phone keyboards, paste); it pauses
  Phaser's global key capture while it exists; the engine's HINT after each one is logged ("You declare
  DARK") and the opponent's declarations pause the duel on a "YOUR OPPONENT DECLARED: …" OK dialog (text only;
  `AnimHost.notice`). Removing counters (`SELECT_COUNTER`) is picked on the board like tributes (`BoardPick.counters`: one counter per
  click, badges count down). Ordering cards (`SORT_CARD`, Big Eye) = `Modal.sortCards`: click the cards in order, number
  badges, RESET / CONFIRM; ocgcore-wasm's encoder adds a length byte the core doesn't expect, worked around in
  `DuelSession.respond` (`rawSortOrder`). Rare prompts (`SORT_CHAIN`, RPS) are still auto-answered by `autoBot`.
- `src/ui/` — `pixel.ts` (bitmap text, crisp 1px borders), `widgets.ts` (buttons), `duel/` (CardSprite, Modal,
  InfoPanel, BoardPick, layout geometry, log text, DuelAnimator).
  Animation timings live in the `T` table at the top of `DuelAnimator.ts` (pixel-art style: direct moves, no
  squash/overshoot; faces swap instantly). Hover effects are suppressed while `animator.busy`.
  `DuelAnimator.play(messages)` tweens the displayed sprites per message (draw, move, summon, flip, activate,
  attack, LP, turn banner, reveals); `DuelController` awaits it before the next prompt/AI move, then the scene redraws
  from the snapshot, so animations only need to *look* right. Reveals (CONFIRM_CARDS) flip hidden cards face-up in place;
  they stay up through the prompt that follows (Confiscation's pick: `animator.revealed`, honoured by the redraw) and flip
  back before the next action. Your own revealed cards just rise.
- `tools/` — Node scripts. `.ts` ones run directly with Node 24 type stripping (no tsx). `tools/lib/engine.ts`: shared
  core + card data loader, `newDuel`, `runDuel` (AI vs AI to the end), `seedFrom(n)`. `tools/lib/match.ts`: brain vs
  brain matches on worker threads (`matchJobs`, `runMatch`, `winRate`; also the workers' entry), used by arena and tune.
- `data/pool.json` — the card passcodes the game uses. Source of truth for the card pool.
- `vendor/` — Project Ignis repos (gitignored, ~130 MB).

## Pixel art & assets

- Everything is laid out in native 640x360 pixels; keep coordinates integer (odd sizes → round). Text is
  `BitmapText` only (`text()` in `src/ui/pixel.ts`); TTF text blurs at this size.
- Phaser 4 pixel snapping: `roundPixels: true` is set explicitly (v4 defaults to false) but only snaps objects whose
  transform is a pure translation (`vertexRoundMode` "safeAuto"); scaled/rotated ones (2x cards, squash flips, defense
  rotation) stay crisp through `pixelArt` nearest sampling, so keep their resting positions integer. BitmapText glyphs
  are never rounded by v4: `text()` gives each one a `GlyphSnapSubmitter` render node that snaps glyphs like v3 did
  (otherwise half-pixel glyphs, e.g. a centred wrapped line, break up). Create text only through `text()`.
- Phaser 4 masks are filters: `obj.enableFilters().filters!.internal.addMask(graphics)` (GeometryMask is Canvas-only),
  see `InfoPanel.scrollName`.
- Card art uses ONE shared 48-colour palette, `data/palette.gpl` (GIMP palette; editable in GIMP, reusable for other
  art; preview `docs/palette.png`). It is frozen: adding cards never changes it. Style knobs (boost, dither, sizes)
  live in `tools/lib/art-style.mjs`; quantisation is our own k-means/Oklab code in `tools/lib/palette.mjs`
  (sharp's `palette`/`colours` PNG option silently does nothing in this build — don't rely on it).
- Fonts: `tiny5` (our own 3x5, UI + ATK/DEF) and `nerds3` (3x3 Font for Nerds by Norwegian Ink, card names —
  no license found; kept by the owner's choice (non-commercial), don't re-raise). TTFs are converted to BMFont by sampling glyph outlines.
- Card = 38x56 incl. 1px outline. Frames per type in `public/assets/cards/frames/` (drawn by the user; `token.png` for
  tokens); counters on a card show as a pile-style number badge (all kinds added up; ocgcore-wasm's parser swaps counter
  kind and count: `DuelSession.counterList` reads the counts from the record's keys) on its top-right corner (hidden while animating),
  and the info panel lists them per kind at the bottom of the type plate ("SPELL CTR 2", names from strings.conf
  `!counter` via `DuelText.counterName`); regions:
  name bar (2,2) 34x5, stars y 7-10, art window 32x32 at (3,12), bottom bar (2,46) 34x8. Back: `back.png`.
  Coin toss / die roll sprites (not themed): `public/assets/duel/coin_flip.png` (8 frames 32x32, loop; heads = frame 0,
  tails = 4) and `dice.png` (6 frames 16x16, faces 1-6), played at 2x mid-field by `DuelAnimator.toss`.
  Rock-paper-scissors art: `public/assets/duel/rps.png` (3 frames 32x32: rock, paper, scissors; drawn by the user),
  shown in the token frame via `CardSprite.showPlain`.
  Chain links: `public/assets/duel/chain.png` (32x32 ring, drawn by the user) over the art window with the link number
  at 2x in it (`CardSprite.setChainMark`), from CHAINING until that link's CHAIN_SOLVED, only once the chain has 2+ links; `DuelAnimator.chainLinks` keeps
  the open chain (sprite keys, follows MOVEs) and the redraw re-applies it.
  `attributes.png` = 7 16x16 icons: DARK EARTH FIRE LIGHT WATER WIND DIVINE.
  Equip links (`CardView.equipTarget`, from the EQUIP_CARD query): hovering an equip card or an equipped monster shows
  the semi-transparent Equip Spell icon (`spells.png` #2) over the partner card's art (`CardSprite.setEquipMark`).
- Duel layout (`src/ui/duel/layout.ts`): info panel 0-219, divider 220-223, phase column x230 (6 boxes 16x56,
  clickable BATTLE / MAIN 2 / END P.), zones are card-sized slots at 58px pitch, piles in the side columns. Banished cards
  have no zone: a `B<n>` badge under the Graveyard, listed when browsing it. Your own Extra Deck can be browsed the
  same way (the opponent's is hidden: `snapshot()` masks face-down cards).
- Corner buttons (field top-right, stacked above the mat, all 24px wide, saved in localStorage): speed 1X/2X/4X, LOG/CARD
  info panel mode, chain mode AUTO/ALL/OFF (`ChainMode`). Info panel **card mode** (default) keeps
  the last hovered card (starts with the first card you draw); **log mode** shows the log and previews cards
  only while hovered. Long names scroll (marquee) after a short hover.
- Field (`src/ui/duel/field.ts`): cream plank table (the info panel's paper colour) with a dark green felt
  playmat in a Frame01a rim around the four zone rows; zones outlined light green, monster zones tinted, empty
  piles labelled FIELD / EXTRA / GY / DECK. Dialogs shade the whole screen; the info panel is drawn above the
  shade (`INFO_DEPTH`) so it stays bright. Theme insets: `*Slice` = sprite border kept when stretching, `rim` /
  `paperRim` = layout insets, equal across themes so the info panel and dialogs lay out identically.
- Duel UI chrome is themed (`src/ui/theme.ts`: `runewood` (default), `hologram`; `&theme=NAME`, or the world
  menu's THEME buttons (localStorage "theme"; `setTheme` swaps `THEME`'s contents and reloads the `ui-*` textures, no page reload)). **Positions and sizes are global** (`INSET`, `LIST_BUTTON` in `layout.ts`); a theme
  only changes the look: its template (`mat` = framed playmat like Runewood, `open` = zones straight on the table
  like Hologram), sprites for the `UI_ROLES` (`public/assets/ui/<theme>/<role>.png`, loaded as `ui-<role>`, file
  mapping + trim/flatten/recolor/replace in `tools/import-ui.mjs`) described by their nine-slice insets and
  button-face text offsets, the table pattern, and every UI colour. Code reads `THEME.*` when drawing (never copy theme
  values into module-level constants: they'd go stale after a switch), `ui(role)`, `INSET`;
  never hard-code UI colours, `ui-` keys or per-theme positions. Cards and gameplay feedback (attack red,
  summon flashes) are not themed. Info panel positions derive from `LAYOUT` in InfoPanel.ts.
- Card action menu (`CardMenu.ts`): clicking a card squash-flips it to a card-sized Frame01a with FrameList09a
  buttons (09c on hover) inside its rim, plus BACK. 11px buttons, 4 fit (3 actions + BACK); labels max 30px (SUMMON,
  SET, SP.SUM, USE, ATTACK, FLIP / TO ATK / TO DEF). Your own Deck opens the same menu with FORFEIT (ends the duel as
  a loss outside the engine; in a peer-to-peer duel a "surrender" packet makes the opponent win). The same squash flip turns set Spells/Traps face-up (`T.flip`).
- Prompt dialogs (`Modal.dialog`): info-panel wood board, message as plain text, list-row buttons (`makeListButton`
  in `widgets.ts`, shared with the card menu). With a card: card (2x) left, text top-right wrapped to the button
  grid's width, buttons centred under it at the bottom; otherwise text over buttons. Boards are 240px wide (408 for 6+ cards).
- Card choices (`BoardPick.cards`, else the dialog): SELECT_CARD / TRIBUTE / UNSELECT_CARD are picked on the board when
  every candidate is a field/hand card (yellow 1px outline = choice, orange 2px = picked; `THEME.pick`), else in the
  `Modal.picker` dialog. The prompt text is centred in the field strip (`setPrompt`); CONFIRM / CANCEL / FINISH
  sit stacked on a dark plate over your Extra Deck slot, with the n/max counter above them.
- Zone choice (`BoardPick.places`): free zones in semi-transparent yellow, more opaque on hover / once picked.

## Engine facts worth knowing

- Use the **sync** core (`createCore({ sync: true })`); the async build needs JSPI.
- After `createDuel`, load `constant.lua` then `utility.lua` before adding cards (`DuelSession` does this).
- Card script lookup order: `goat/` → `official/` → `pre-errata/` → `unofficial/`. Root-level `*.lua` (procs, utility) are always bundled.
- CardScripts is **pinned** (`tools/fetch-data.mjs`) to the last commit before 2026-06-09 ("add Chain namespace"): newer
  helpers query CHAININFO flags the core in ocgcore-wasm 0.1.2 rejects, and the Lua error silently drops effects
  registered mid-chain. Only move the pin with an ocgcore-wasm update; afterwards `smoke` must print no `[ocgcore]` errors.
- Tokens (e.g. Scapegoat's Sheep Tokens, its code + 1..4) are separate cards the engine looks up: `build-data` exports
  every TYPE_TOKEN card a pool script creates. A pool card without its tokens breaks when it resolves.
- ocgcore-wasm 0.1.2 misreads MSG_SHUFFLE_SET_CARD (u32 count, interleaved places; the core writes a u8 count and two
  lists) and throws "eof", killing the duel (Cyber Jar summoning face-down), and MSG_SELECT_SUM (Ritual tributes: the
  core writes the must list first and a position per card). `tools/patch-ocgcore.mjs` fixes the dist
  file as npm's `postinstall`; it fails loudly if the package changes. SELECT_SUM's `select_max` field is really the
  mode: 0 = exact sum (with min/max cards), else "at least" (min = max = 0; no card may be unnecessary, `sumMatches`).
- SELECT_TRIBUTE `min` counts tributes, not cards: Double Tribute monsters (Kaiser Sea Horse) have `release_param` 2
  (`pickTributes` in `autoBot.ts`).
- ocgcore-wasm's MOVE parser drops the move reason; `DuelSession` re-adds it (`MoveMessage.reason`, REASON_*
  bits) by querying the card at its destination right after each batch. Used to flash only real destructions.
- ocgcore does **not** shuffle decks at start (EDOPro does it client-side); `DuelSession` shuffles with a PRNG seeded from the duel seed.
- `duelQueryField` LP is unsigned (overkill wraps to ~4.29e9) and missing from the TS type; `snapshot()` handles both.
- For SELECT_PLACE the preceding HINT carries the card passcode, not a string id.
- `cards.cdb` `setcode` and `race` exceed 2^53: read with `stmt.setReadBigInts(true)`, store as strings in JSON.
- The same duel (seed + answers) always reaches the same boards, but some cosmetic messages (CARD_HINT order) can
  differ between runs in one engine instance (memory layout). Compare boards (`checksum()`), never message streams.
- A `RETRY` message means we sent an illegal response. Treat it as a bug, never retry silently.
- Only the player-facing side may see hidden info: the AI must decide from messages addressed to it, not from `duelQuery` on the opponent's hand/deck.
  ocgcore's raw messages carry hidden codes (a DRAW lists the drawn cards for either player, a SET names the card,
  the other player's SELECT_* lists their candidates): the AI only ever sees them through `redact()`.

## Conventions

- TypeScript strict, ES modules, relative imports **with `.ts` extensions** (needed so Node can run the same files).
- Keep `src/duel/` UI-agnostic; scenes talk to it only through `DuelSession` / `DuelController`.
- Verify engine changes with `npm run smoke`, and UI changes in the browser preview.

## Licensing

See `CREDITS.md` — keep it up to date when adding third-party assets. The Crusenho UI pack is CC BY 4.0
(attribution required in the game's credits).

ocgcore and CardScripts are **AGPL-3.0**, so a distributed build of this game must be AGPL-3.0 with source available.
Card names/text/art are Konami's (non-commercial fan project). Paid art packs (e.g. LimeZu Modern Exteriors in
`public/assets/tilesets/`) must not go into a public repo. They're gitignored for that reason.

## Roadmap

1. ✅ Environment: Vite + TS + Phaser 3.88 (migrated to Phaser 4.2), ocgcore-wasm, data pipeline, headless smoke test, engine runs in the browser.
2. ✅ **Duel screen v1**: playable human-vs-bot duel with all common prompts, card art, info panel, log, LP, end screen.
   ✅ Animations for draws, moves, summons, flips, activations, attacks, LP and turn changes, revealed cards
   (CONFIRM_CARDS, e.g. a searched card) and hand shuffles (stack, then spread in the new order).
   ✅ 640x360 pixel-art duel screen from the layout sketch, custom frames, downscaled art, bitmap fonts.
   ✅ Animation review pass (#1-#12 reviewed with the user; `&anims` dropdown replays each).
   ✅ Runewood card action menu (on the card) and prompt dialogs.
   ✅ Runewood card pickers; the turn banner stays as it is (owner's choice). ✅ Chain-link marks on cards. Later: deck search UX, sound.
   ✅ Counter removal on the board, counters per kind in the info panel. ✅ Card ordering dialog (Big Eye, `&setup=sort`).
   Auto-answered prompts (SORT_CHAIN, RPS) wait until a card batch
   needs them (none came up in 150 bot duels with the current pool).
   ✅ Card batch 1: 107-card GOAT staples pool, token export, Yugi / Kaiba / Goat Control decks, `check-cards`.
   ✅ Token frame, counter badges, declarations, equip links, coin/dice animations (`check-cards` lists what's left).
   Starter decks: ✅ Kaiba Evolution (first Ritual: Paladin of White Dragon), ✅ Yugi Evolution.
   ✅ Rock-paper-scissors before each duel (cards on the board); the winner chooses to go first or second.
   ✅ Code cleanup: DuelScene split into InfoPanel / BoardPick / duelPrompts, dead code and duplicates removed, comments
   brought up to date.
3. **Opponent AI** (`docs/ai-plan.md`: one universal brain + per-card knowledge + trainer profiles; levels Rookie /
   Duelist / Expert, Expert as strong as possible, with lookahead later; no cheating by default).
   ✅ M0 plumbing: `AiSeat` / `redact` / `AiMemory` / brains / trace, `arena`, `test-ai`.
   ✅ M1 generic brain: ~82% vs autobot over 1008 duels.
   ✅ M2 `sim` brain: main-phase activations judged by playing them on a rebuilt copy of the board
   (`docs/ai-plan.md` §6a); 54% vs generic, 84% vs autobot.
   M3 in progress: `replay` brain (chain responses by replaying the opponent's action), 53% ± 3 vs sim; the default
   opponent since 2026-10-14 (the user's first test duel showed the simple chain rule Shrinking its own monster).
4. **Overworld**: Tiled maps, collisions, NPCs with dialogue, trainer line-of-sight challenges, map transitions.
5. **RPG loop**: card collection, deck editor, rewards/boosters after duels, story progression and gym-like bosses, save to localStorage.
6. Move the duel to a Web Worker if long chains cause frame hitches.
7. **Multiplayer**: ✅ peer-to-peer v1 (lockstep over PeerJS, room codes / invite links, each player's chosen deck, leave
   detection, FORFEIT). Later: own decks once the deck editor exists, a "waiting for opponent" indicator, reconnect,
   a TURN server for networks that block direct connections, maybe a server (hidden info stays hidden).
