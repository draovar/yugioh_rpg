# Yu-Gi-Oh RPG

A Pokémon-style overworld RPG (Phaser 3) in which every battle is a real Yu-Gi-Oh duel.
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
| `npm run fetch-data` | clone/update ProjectIgnis `CardScripts` + `BabelCDB` into `vendor/` (gitignored) |
| `npm run build-data` | `data/pool.json` → `public/data/{cards,scripts,strings}.json` |
| `npm run fetch-art` | download art-only crops for the pool from YGOPRODeck into `vendor/art/` (gitignored) |
| `npm run build-art` | art → shared palette: `public/cards/art32.png`+`.json` atlas (cards) and `public/cards/art128/<code>.png` (info panel) |
| `npm run build-palette` | **rarely**: regenerate the frozen shared palette `data/palette.gpl` from ~400 sampled GOAT arts (+ frames) |
| `node tools/import-ui.mjs` | copy + trim the UI sprites we use from the Crusenho pack (`assets/`, gitignored) into `public/assets/ui/` |
| `npm run build-fonts` | rebuild bitmap fonts in `public/assets/fonts/` (nerds3 from the TTF, tiny5 from `tools/build-tiny5-font.mjs`) |
| `npm run smoke [-- N]` | play N headless bot-vs-bot duels through `DuelSession`; fails on RETRY/crash |

Fresh clone: `npm install && npm run fetch-data && npm run build-data && npm run fetch-art && npm run build-art`.
After changing `data/pool.json`, rerun `build-data`, `fetch-art`, `build-art`, then `smoke`.

Dev URL options: `&anims` adds a dropdown (top-left) to replay single animations (`src/scenes/animPreview.ts`);
`/?duel` starts straight in a duel, `&lp=500` sets starting LP, `&seed=N` replays the same duel,
`&timeout` keeps the game loop running when the tab/pane is hidden (rAF pauses there, which freezes the duel).
Use `&timeout` for automated browser testing; a hidden pane still throttles timers to ~1 fps, so animations look
choppy in screenshots. In dev builds `window.duelScene` exposes the scene (`.controller.waitingForHuman`,
`.animator.current`, `.animator.speed`).

## Layout

- `src/duel/` — engine layer, **no Phaser imports**. Runs unchanged in Node (tools) and the browser.
  - `DuelSession.ts` — wraps one duel: `advance()` runs until a prompt/end, `respond()` answers it,
    `snapshot(viewer)` reads the board from the engine with hidden info masked.
  - `DuelController.ts` — human (P0) vs AI (P1) loop; emits `onUpdate`/`onPrompt`/`onEnd`, auto-passes empty chain prompts.
  - `text.ts` — `DuelText.describe(desc)` resolves system strings and `aux.Stringid` card strings.
  - `autoBot.ts` — always-legal dumb responder (tests, placeholder AI). `freePlaces()` decodes SELECT_PLACE masks.
  - `cardData.ts` — `CardRecord` (JSON shape) → `OcgCardData`; `CardDb` lookup + names.
  - `loadEngine.ts` — browser only: fetches `public/data/*.json`, inits core once.
- `src/scenes/` — Phaser scenes. `Boot` → `Overworld` (placeholder grid map) → `Duel` (`DuelScene`, takes `DuelSceneData`).
  `DuelScene` redraws the whole board from `snapshot()` after every engine step and maps each SELECT_* prompt to UI:
  card action menus (idle/battle), zone highlights (place), and `Modal` dialogs/card pickers for everything else.
  Rare prompts (announce, counters, sort, RPS) are still auto-answered by `autoBot`.
- `src/ui/` — `pixel.ts` (bitmap text, crisp 1px borders), `widgets.ts` (buttons), `duel/` (CardSprite, Modal,
  layout geometry, log text, DuelAnimator).
  Animation timings live in the `T` table at the top of `DuelAnimator.ts` (pixel-art style: direct moves, no
  squash/overshoot; faces swap instantly). Hover effects are suppressed while `animator.busy`.
  `DuelAnimator.play(messages)` tweens the displayed sprites per message (draw, move, summon, flip, activate,
  attack, LP, turn banner); `DuelController` awaits it before the next prompt/AI move, then the scene redraws
  from the snapshot, so animations only need to *look* right. Speed toggle (1×/2×/4×) is saved in localStorage.
- `tools/` — Node scripts. `.ts` ones run directly with Node 24 type stripping (no tsx).
- `data/pool.json` — the card passcodes the game uses. Source of truth for the card pool.
- `vendor/` — Project Ignis repos (gitignored, ~130 MB).

## Pixel art & assets

- Everything is laid out in native 640x360 pixels; keep coordinates integer (odd sizes → round). Text is
  `BitmapText` only (`text()` in `src/ui/pixel.ts`); TTF text blurs at this size.
- Card art uses ONE shared 48-colour palette, `data/palette.gpl` (GIMP palette; editable in GIMP, reusable for other
  art; preview `docs/palette.png`). It is frozen: adding cards never changes it. Style knobs (boost, dither, sizes)
  live in `tools/lib/art-style.mjs`; quantisation is our own k-means/Oklab code in `tools/lib/palette.mjs`
  (sharp's `palette`/`colours` PNG option silently does nothing in this build — don't rely on it).
- Fonts: `tiny5` (our own 3x5, UI + ATK/DEF) and `nerds3` (3x3 Font for Nerds by Norwegian Ink, card names —
  **check its license before release**). TTFs are converted to BMFont by sampling glyph outlines.
- Card = 38x56 incl. 1px outline. Frames per type in `public/assets/cards/frames/` (drawn by the user); regions:
  name bar (2,2) 34x5, stars y 7-10, art window 32x32 at (3,12), bottom bar (2,46) 34x8. Back: `back.png`.
  `attributes.png` = 7 16x16 icons: DARK EARTH FIRE LIGHT WATER WIND DIVINE.
- Duel layout (`src/ui/duel/layout.ts`): info panel 0-219, divider 220-223, phase column x230 (6 boxes 16x56,
  clickable BATTLE / MAIN 2 / END P.), zones are 58px-pitch crosses, piles in the side columns. Banished cards
  have no zone: a `B<n>` badge under the Graveyard, listed when browsing it.
- Info panel modes (LOG/CARD button under the 1X speed button, field top-right): **card mode** (default) keeps
  the last hovered card (starts with the first card you draw); **log mode** shows the log and previews cards
  only while hovered. Long names scroll (marquee) after a short hover.
- Duel UI chrome is Runewood (Crusenho pack): phase buttons (`phaseThemes.ts`), LP bars (`LPBar.ts`), info
  panel = light wood board + cream paper inset for description/log (`panelStyles.ts`). Sprites are nine-sliced;
  insets come from the sprites' pixel rows (see comments). Info panel positions derive from `LAYOUT` in DuelScene.

## Engine facts worth knowing

- Use the **sync** core (`createCore({ sync: true })`); the async build needs JSPI.
- After `createDuel`, load `constant.lua` then `utility.lua` before adding cards (`DuelSession` does this).
- Card script lookup order: `goat/` → `official/` → `pre-errata/` → `unofficial/`. Root-level `*.lua` (procs, utility) are always bundled.
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
- Keep `src/duel/` UI-agnostic; scenes talk to it only through `DuelSession` / future duel controller.
- Verify engine changes with `npm run smoke`, and UI changes in the browser preview.

## Licensing

See `CREDITS.md` — keep it up to date when adding third-party assets. The Crusenho UI pack is CC BY 4.0
(attribution required in the game's credits).

ocgcore and CardScripts are **AGPL-3.0**, so a distributed build of this game must be AGPL-3.0 with source available.
Card names/text/art are Konami's (non-commercial fan project). Paid art packs (e.g. LimeZu Modern Exteriors in
`public/assets/tilesets/`) must not go into a public repo. They're gitignored for that reason.

## Roadmap

1. ✅ Environment: Vite + TS + Phaser 3.88, ocgcore-wasm, data pipeline, headless smoke test, engine runs in the browser.
2. ✅ **Duel screen v1**: playable human-vs-bot duel with all common prompts, card art, info panel, log, LP, end screen.
   ✅ Animations for draws, moves, summons, flips, activations, attacks, LP and turn changes.
   ✅ 640x360 pixel-art duel screen from the layout sketch, custom frames, downscaled art, bitmap fonts.
   ✅ Animation review pass (#1-#12 reviewed with the user; `&anims` dropdown replays each).
   Next: Runewood look for the remaining UI (action menu SUMMON/SET…, prompt dialogs, card pickers, turn
   banner?) and a rework of the card action menus. Later: chain-link display, deck search UX, sound.
3. **Opponent AI**: better than `autoBot` (sensible summons/attacks/chain decisions), per-trainer deck + difficulty.
4. **Overworld**: Tiled maps, collisions, NPCs with dialogue, trainer line-of-sight challenges, map transitions.
5. **RPG loop**: card collection, deck editor, rewards/boosters after duels, story progression and gym-like bosses, save to localStorage.
6. Move the duel to a Web Worker if long chains cause frame hitches.
