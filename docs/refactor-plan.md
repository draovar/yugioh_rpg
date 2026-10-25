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
DuelScene, DeckEditor, Overworld, DuelAnimator, Modal, tools/ai-bench (positions as data, runner apart).

## Phase 3: code-simplifier per area
engine → AI → duel screen → overworld / deck editor → tools. Remove duplication and dead code. Comments: keep the
"why" (engine quirks, workarounds, non-obvious rules); delete ones that restate the code, narrate history or are stale.
Baseline diff after each area; UI areas also checked in the browser preview.

## Phase 4: docs
CLAUDE.md down to commands, rules, engine facts and a one-screen folder map; module details move to
`docs/architecture.md`.
