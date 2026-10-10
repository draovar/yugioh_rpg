# Yu-Gi-Oh RPG

A Pokémon-style overworld RPG (Phaser 3) in which every battle is a real Yu-Gi-Oh duel.
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
| `npm run build-data` | `data/pool.json` → `public/data/cards.json` + `public/data/scripts.json` |
| `npm run smoke [-- N]` | play N headless bot-vs-bot duels through `DuelSession`; fails on RETRY/crash |

Fresh clone: `npm install && npm run fetch-data && npm run build-data`.
After changing `data/pool.json`, rerun `build-data`, then `smoke`.

## Layout

- `src/duel/` — engine layer, **no Phaser imports**. Runs unchanged in Node (tools) and the browser.
  - `DuelSession.ts` — wraps one duel: `advance()` runs until a prompt/end, `respond()` answers it.
  - `autoBot.ts` — always-legal dumb responder (tests, placeholder AI). `freePlaces()` decodes SELECT_PLACE masks.
  - `cardData.ts` — `CardRecord` (JSON shape) → `OcgCardData`; `CardDb` lookup + names.
  - `loadEngine.ts` — browser only: fetches `public/data/*.json`, inits core once.
- `src/scenes/` — Phaser scenes. `Boot` → `Overworld` (placeholder grid map) → `DuelTest` (bot-vs-bot log; to be replaced by the real duel UI).
- `tools/` — Node scripts. `.ts` ones run directly with Node 24 type stripping (no tsx).
- `data/pool.json` — the card passcodes the game uses. Source of truth for the card pool.
- `vendor/` — Project Ignis repos (gitignored, ~130 MB).

## Engine facts worth knowing

- Use the **sync** core (`createCore({ sync: true })`); the async build needs JSPI.
- After `createDuel`, load `constant.lua` then `utility.lua` before adding cards (`DuelSession` does this).
- Card script lookup order: `goat/` → `official/` → `pre-errata/` → `unofficial/`. Root-level `*.lua` (procs, utility) are always bundled.
- `cards.cdb` `setcode` and `race` exceed 2^53: read with `stmt.setReadBigInts(true)`, store as strings in JSON.
- A `RETRY` message means we sent an illegal response. Treat it as a bug, never retry silently.
- Only the player-facing side may see hidden info: the AI must decide from messages addressed to it, not from `duelQuery` on the opponent's hand/deck.

## Conventions

- TypeScript strict, ES modules, relative imports **with `.ts` extensions** (needed so Node can run the same files).
- Keep `src/duel/` UI-agnostic; scenes talk to it only through `DuelSession` / future duel controller.
- Verify engine changes with `npm run smoke`, and UI changes in the browser preview.

## Licensing

ocgcore and CardScripts are **AGPL-3.0**, so a distributed build of this game must be AGPL-3.0 with source available.
Card names/text/art are Konami's (non-commercial fan project). Paid art packs (e.g. LimeZu Modern Exteriors in
`public/assets/tilesets/`) must not go into a public repo. They're gitignored for that reason.

## Roadmap

1. ✅ Environment: Vite + TS + Phaser 3.88, ocgcore-wasm, data pipeline, headless smoke test, engine runs in the browser.
2. **Duel UI scene**: render the field from the message stream (DRAW, MOVE, POS_CHANGE, SUMMONING, CHAINING, DAMAGE, LPUPDATE…),
   and a prompt layer for each SELECT_* message (idle/battle commands, card select, chain yes/no, place, position, tribute).
   Card art: YGOPRODeck images by passcode (loaded at runtime, not redistributed).
3. **Opponent AI**: better than `autoBot` (sensible summons/attacks/chain decisions), per-trainer deck + difficulty.
4. **Overworld**: Tiled maps, collisions, NPCs with dialogue, trainer line-of-sight challenges, map transitions.
5. **RPG loop**: card collection, deck editor, rewards/boosters after duels, story progression and gym-like bosses, save to localStorage.
6. Move the duel to a Web Worker if long chains cause frame hitches.
