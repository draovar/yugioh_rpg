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
| `npm run smoke [-- N]` | play N headless bot-vs-bot duels through `DuelSession`; fails on RETRY/crash |
| `npm run smoke-p2p [-- N]` | play N peer-to-peer lockstep duels (two `DuelController`s on an in-memory link); fails if the machines disagree |

Fresh clone: `npm install && npm run fetch-data && npm run build-data && npm run fetch-art && npm run build-art`.
After changing `data/pool.json`, rerun `build-data`, `check-cards`, `fetch-art`, `build-art`, then `smoke` (it validates
the decks in `src/duel/decks.ts` and plays every deck pairing). `fetch-art`/`build-art` read `public/data/cards.json`, so
tokens get art too.

Deploy: every push to `main` runs `.github/workflows/deploy.yml` (the fresh-clone pipeline + `smoke -- 3` + `smoke-p2p -- 3` + `build`)
and publishes `dist/` to GitHub Pages: https://draovar.github.io/yugioh_rpg/ . Never upload a local `dist/`: Vite
copies all of `public/`, including the gitignored paid tilesets.

Multiplayer URLs (work in the deployed game too): `?mp` opens the multiplayer lobby, `?join=CODE` joins a room.
Dev URL options: `&anims` adds a dropdown (top-left) to replay single animations (`src/scenes/animPreview.ts`);
`&dialogs` adds one that opens every prompt UI with sample cards (`src/scenes/dialogPreview.ts`; answers are only
logged, then the real prompt returns; numbers match `docs/duel-ui-checklist.md`);
`/?duel` starts straight in a duel, `&lp=500` sets starting LP, `&seed=N` replays the same duel,
`&deck=NAME` / `&opp=NAME` pick the prebuilt decks (`yugi`, `kaiba`, `goat`; default Yugi vs Kaiba),
`&setup=NAME` starts from a test board (`src/scenes/devSetups.ts`: `tribute`, `scapegoat` (use `&deck=goat`), `fusion`
(`&deck=kaiba`), `equip`, `confiscation`; cards placed in hand/on the field first),
`&timeout` keeps the game loop running when the tab/pane is hidden (rAF pauses there, which freezes the duel).
Use `&timeout` for automated browser testing; a hidden pane still throttles timers to ~1 fps, so animations look
choppy in screenshots. In dev builds `window.duelScene` exposes the scene (`.controller.waitingForHuman`,
`.animator.current`, `.animator.speed`).

## Layout

- `src/duel/` — engine layer, **no Phaser imports**. Runs unchanged in Node (tools) and the browser.
  - `DuelSession.ts` — wraps one duel: `advance()` runs until a prompt/end, `respond()` answers it,
    `snapshot(viewer)` reads the board from the engine with hidden info masked.
  - `DuelController.ts` — the local player (`me`, either seat) vs the AI or a `RemotePeer`; emits `onUpdate`/`onPrompt`/
    `onEnd`/`onError`, auto-passes empty chain prompts (both seats, unsent) and, per the local
    player's chain mode (`ChainMode`: auto = only when `spe_count` > 0 like YGOPro, all, off), hides their optional
    chain prompts (answered "no" and sent like any answer). Peer-to-peer duels run in **lockstep**: both machines run the
    same duel (same seed, same two decks) and send only the answers to their own prompts, each
    with `DuelSession.checksum()` from before it was applied; a mismatch stops the duel ("out of sync"). Anything that
    differs between the two machines (non-seeded randomness in the engine layer, deck order, data) splits the duel.
  - `text.ts` — `DuelText.describe(desc)` resolves system strings and `aux.Stringid` card strings.
  - `autoBot.ts` — always-legal dumb responder (tests, placeholder AI). `freePlaces()` decodes SELECT_PLACE masks.
  - `cardData.ts` — `CardRecord` (JSON shape) → `OcgCardData`; `CardDb` lookup + names.
  - `decks.ts` — prebuilt decks until the deck editor exists (`yugi`, `kaiba`, `goat` + Extra Decks), `deckProblems()` legality check (40-60 main, ≤15 extra, ≤3 copies, no tokens, all in the pool).
  - `loadEngine.ts` — browser only: fetches `public/data/*.json`, inits core once.
- `src/net/` — browser-only networking, no Phaser. `p2p.ts`: PeerJS (WebRTC) rooms; the host opens `ygorpg-<CODE>` on
  PeerJS's free public server, the guest connects, handshake checks `PROTOCOL` + `Engine.fingerprint` (hash of the card
  data and scripts), each side sends its deck as a passcode list (checked with `deckProblems`), the host sends the
  seed and its random seat. Pings every 3 s; 20 s of silence or a "bye" =
  opponent left. Room codes use letters that tiny5 can't confuse with digits. `wire.ts`: response encoding (bigints).
- `src/scenes/` — Phaser scenes. `Boot` → `Overworld` (placeholder grid map; bottom bar: deck choice
  saved in localStorage via `src/ui/prefs.ts`, used vs the Rival and in multiplayer; THEME buttons (switch in place);
  MULTIPLAYER button / M key) → `Duel` (`DuelScene`,
  takes `DuelSceneData`); `Lobby` hosts/joins a peer-to-peer duel and passes the `NetDuel` to `Duel`. The duel screen
  draws the local seat at the bottom: player → screen side via `side(player)`, never assume P0 is "you".
  `DuelScene` redraws the whole board from `snapshot()` after every engine step and maps each SELECT_* prompt to UI:
  card action menus (idle/battle), zone highlights (place), and `Modal` dialogs/card pickers for everything else.
  Declarations (`ANNOUNCE_*`): Type / Attribute / number as button dialogs, card names in `Modal.search` (typed search,
  `src/duel/cardSearch.ts`; candidates filtered by the prompt's opcodes via `declarableCards` in `autoBot.ts`). Text entry
  in the canvas = `src/ui/textInput.ts` (card search, lobby room code): an invisible HTML input over the drawn field (phone keyboards, paste); it pauses
  Phaser's global key capture while it exists; the engine's HINT after each one is logged ("You declare
  DARK") and the opponent's declarations pause the duel on a "YOUR OPPONENT DECLARED: …" OK dialog (text only;
  `AnimHost.notice`). Rare prompts (counters to remove, sort, RPS) are still auto-answered by `autoBot`.
- `src/ui/` — `pixel.ts` (bitmap text, crisp 1px borders), `widgets.ts` (buttons), `duel/` (CardSprite, Modal,
  layout geometry, log text, DuelAnimator).
  Animation timings live in the `T` table at the top of `DuelAnimator.ts` (pixel-art style: direct moves, no
  squash/overshoot; faces swap instantly). Hover effects are suppressed while `animator.busy`.
  `DuelAnimator.play(messages)` tweens the displayed sprites per message (draw, move, summon, flip, activate,
  attack, LP, turn banner, reveals); `DuelController` awaits it before the next prompt/AI move, then the scene redraws
  from the snapshot, so animations only need to *look* right. Reveals (CONFIRM_CARDS) flip hidden cards face-up in place;
  they stay up through the prompt that follows (Confiscation's pick: `animator.revealed`, honoured by the redraw) and flip
  back before the next action. Your own revealed cards just rise.
- `tools/` — Node scripts. `.ts` ones run directly with Node 24 type stripping (no tsx).
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
  see `DuelScene.scrollName`.
- Card art uses ONE shared 48-colour palette, `data/palette.gpl` (GIMP palette; editable in GIMP, reusable for other
  art; preview `docs/palette.png`). It is frozen: adding cards never changes it. Style knobs (boost, dither, sizes)
  live in `tools/lib/art-style.mjs`; quantisation is our own k-means/Oklab code in `tools/lib/palette.mjs`
  (sharp's `palette`/`colours` PNG option silently does nothing in this build — don't rely on it).
- Fonts: `tiny5` (our own 3x5, UI + ATK/DEF) and `nerds3` (3x3 Font for Nerds by Norwegian Ink, card names —
  no license found; kept by the owner's choice (non-commercial), don't re-raise). TTFs are converted to BMFont by sampling glyph outlines.
- Card = 38x56 incl. 1px outline. Frames per type in `public/assets/cards/frames/` (drawn by the user; `token.png` for
  tokens); counters on a card show as a pile-style number badge (ocgcore-wasm's parser swaps counter
  kind and count: `DuelSession.counterTotal` reads the counts from the record's keys) on its top-right corner (hidden while animating); regions:
  name bar (2,2) 34x5, stars y 7-10, art window 32x32 at (3,12), bottom bar (2,46) 34x8. Back: `back.png`.
  `attributes.png` = 7 16x16 icons: DARK EARTH FIRE LIGHT WATER WIND DIVINE.
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
  summon flashes) are not themed. Info panel positions derive from `LAYOUT` in DuelScene.
- Card action menu (`CardMenu.ts`): clicking a card squash-flips it to a card-sized Frame01a with FrameList09a
  buttons (09c on hover) inside its rim, plus BACK. 11px buttons, 4 fit (3 actions + BACK); labels max 30px (SUMMON,
  SET, SP.SUM, USE, ATTACK, FLIP / TO ATK / TO DEF). Your own Deck opens the same menu with FORFEIT (ends the duel as
  a loss outside the engine; in a peer-to-peer duel a "surrender" packet makes the opponent win). The same squash flip turns set Spells/Traps face-up (`T.flip`).
- Prompt dialogs (`Modal.dialog`): info-panel wood board, message as plain text, list-row buttons (`makeListButton`
  in `widgets.ts`, shared with the card menu). With a card: card (2x) left, text top-right wrapped to the button
  grid's width, buttons bottom-right; otherwise text over buttons. Boards are 240px wide (408 for 6+ cards).
- Card choices (`pickCards` in DuelScene): SELECT_CARD / TRIBUTE / UNSELECT_CARD are picked on the board when
  every candidate is a field/hand card (yellow 1px outline = choice, orange 2px = picked; `PICK_COLOR`), else in the
  `Modal.picker` dialog. The prompt text is centred in the field strip (`setPrompt`); CONFIRM / CANCEL / FINISH
  sit stacked on a dark plate over your Extra Deck slot, with the n/max counter above them.
- Zone choice (`pickPlaces`): free zones in semi-transparent yellow, more opaque on hover / once picked.

## Engine facts worth knowing

- Use the **sync** core (`createCore({ sync: true })`); the async build needs JSPI.
- After `createDuel`, load `constant.lua` then `utility.lua` before adding cards (`DuelSession` does this).
- Card script lookup order: `goat/` → `official/` → `pre-errata/` → `unofficial/`. Root-level `*.lua` (procs, utility) are always bundled.
- CardScripts is **pinned** (`tools/fetch-data.mjs`) to the last commit before 2026-06-09 ("add Chain namespace"): newer
  helpers query CHAININFO flags the core in ocgcore-wasm 0.1.2 rejects, and the Lua error silently drops effects
  registered mid-chain. Only move the pin with an ocgcore-wasm update; afterwards `smoke` must print no `[ocgcore]` errors.
- Tokens (e.g. Scapegoat's Sheep Tokens, its code + 1..4) are separate cards the engine looks up: `build-data` exports
  every TYPE_TOKEN card a pool script creates. A pool card without its tokens breaks when it resolves.
- ocgcore-wasm's MOVE parser drops the move reason; `DuelSession` re-adds it (`MoveMessage.reason`, REASON_*
  bits) by querying the card at its destination right after each batch. Used to flash only real destructions.
- ocgcore does **not** shuffle decks at start (EDOPro does it client-side); `DuelSession` shuffles with a PRNG seeded from the duel seed.
- `duelQueryField` LP is unsigned (overkill wraps to ~4.29e9) and missing from the TS type; `snapshot()` handles both.
- For SELECT_PLACE the preceding HINT carries the card passcode, not a string id.
- `cards.cdb` `setcode` and `race` exceed 2^53: read with `stmt.setReadBigInts(true)`, store as strings in JSON.
- A `RETRY` message means we sent an illegal response. Treat it as a bug, never retry silently.
- Only the player-facing side may see hidden info: the AI must decide from messages addressed to it, not from `duelQuery` on the opponent's hand/deck.

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
   Next: Runewood card pickers (and turn banner?). Later: chain-link display, deck search UX, sound.
   ✅ Card batch 1: 107-card GOAT staples pool, token export, Yugi / Kaiba / Goat Control decks, `check-cards`.
   Next mechanics (see `check-cards`): equip links, coin/dice feedback. ✅ Token frame, counter badges, declarations.
3. **Opponent AI**: better than `autoBot` (sensible summons/attacks/chain decisions), per-trainer deck + difficulty.
4. **Overworld**: Tiled maps, collisions, NPCs with dialogue, trainer line-of-sight challenges, map transitions.
5. **RPG loop**: card collection, deck editor, rewards/boosters after duels, story progression and gym-like bosses, save to localStorage.
6. Move the duel to a Web Worker if long chains cause frame hitches.
7. **Multiplayer**: ✅ peer-to-peer v1 (lockstep over PeerJS, room codes / invite links, each player's chosen deck, leave
   detection, FORFEIT). Later: own decks once the deck editor exists, a "waiting for opponent" indicator, reconnect,
   a TURN server for networks that block direct connections, maybe a server (hidden info stays hidden).
