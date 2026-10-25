# Refactor plan (2026-10-25)

Goal: make things easy to find, without changing behaviour. Branch `refactor/structure`, one commit per phase.

## Phase 0: safety net
Baseline outputs in `vendor/refactor-baseline/` (gitignored), made by `vendor/refactor-baseline/run.sh <dir>`:
typecheck, `smoke`, `smoke-p2p`, `test-ai`, `ai-bench`, seeded `arena --record` runs (generic vs autobot, planner vs
generic) and one `--trace` duel. The AI is deterministic for a seed, so after every phase the deterministic outputs must
match the baseline exactly (`run.sh after`, then `compare.sh after`); anything that changes the order of seeded
randomness shows up here. `smoke` / `smoke-p2p` play unseeded duels, so for them only failures, engine warnings and the
exit code are compared. A full run takes ~5 minutes; two runs on the untouched code matched exactly.

## Phase 1: folder restructure (moves only)
`git mv`, then fix imports, `package.json` scripts, `deploy.yml`, the `postinstall` path, CLAUDE.md paths.
```
src/
  duel/          engine layer, no Phaser
    engine/      DuelSession, loadEngine, cardData, text, hash, rng
    decks/       decks, deckRules (was deckEditor.ts), cardSearch
    ai/          as now + autoBot, boardText
    DuelController.ts, rps.ts
  net/
  overworld/     Overworld, WorldMenu, DialogBox, TouchPad, touch, npcs.ts
  duel-screen/   DuelScene, prompts, everything from ui/duel/
  deck-editor/   DeckEditor
  lobby/
  ui/            shared: pixel, widgets, theme, prefs, textInput
  dev/           anim/dialog previews, devSetups, previewSeats, capture
tools/
  data/ art/ maps/ ai/ test/ lib/
```

## Phase 2: split the big files
- Overworld (456 → 305 lines): `characters.ts` (frames, walk animations), `npcs.ts` (NPC data), `sortedWalls.ts`
  (wall y-sorting, baking).
- DuelScene (826 → 541): `BoardView.ts` (cards, piles, hand, badges, equip links), `PhaseColumn.ts`, `PromptBand.ts`,
  `cornerButtons.ts`, `aiTrace.ts` (`&aitrace` replay line, L-key board log).
- DeckEditor (859 → 681): `layout.ts` (geometry), `listRow.ts` (row colours, text lines, eye icon),
  `filterPanel.ts`, `dialogs.ts` (message and rename dialogs).
- ai-bench (895 → 149): positions in `tools/ai/ai-bench-positions.ts`.
- Kept whole: DuelAnimator and Modal. Each is one cohesive class whose parts share its state (sprites, hand counts,
  tween helpers / the open dialog, cleanups, board geometry); splitting would thread that state through every function.

## Phase 3: code-simplifier per area
Five parallel code-simplifier passes (engine, AI, duel screen, overworld/editor/UI, tools): duplicates folded into
helpers, dead exports removed, nested ternaries untangled. Comments: kept the "why" (engine quirks, workarounds,
non-obvious rules, measured results); deleted ones that restated the code, narrated history or were stale. Baseline,
generated outputs and the browser checked afterwards.

## Phase 4: docs
CLAUDE.md (412 → 180 lines) keeps the folder map, commands, setup/deploy, URL options, rules, engine facts and
licensing; module details moved to `docs/architecture.md`, the roadmap to `docs/roadmap.md`. Every backticked term
of the old CLAUDE.md is still in one of the three.
