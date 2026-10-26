# Roadmap

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
   Full pool (`docs/card-pool-plan.md`): every TCG card up to Premium Pack 2 (2,842 cards). ✅ Phase 1: `build-pool`.
   Next: GOAT / pre-errata versions, full-size data + art, random-deck smoke, UI checks, May 2008 banlist, NPC decks as data.
   ✅ Token frame, counter badges, declarations, equip links, coin/dice animations (`check-cards` lists what's left).
   Starter decks: ✅ Kaiba Evolution (first Ritual: Paladin of White Dragon), ✅ Yugi Evolution.
   Structure decks: ✅ Zombie Madness, ✅ Dragon's Roar.
   ✅ Rock-paper-scissors before each duel (cards on the board); the winner chooses to go first or second.
   ✅ Code cleanup: DuelScene split into InfoPanel / BoardPick / duelPrompts, dead code and duplicates removed, comments
   brought up to date.
   ✅ Structure refactor (2026-10-25, `docs/refactor-plan.md`): feature folders, the biggest files split,
   code-simplifier pass, CLAUDE.md slimmed with `docs/architecture.md`.
3. **Opponent AI** (`docs/ai-plan.md`: one universal brain + per-card knowledge + trainer profiles; levels Rookie /
   Duelist / Expert, Expert as strong as possible, with lookahead later; no cheating by default).
   ✅ M0 plumbing: `AiSeat` / `redact` / `AiMemory` / brains / trace, `arena`, `test-ai`.
   ✅ M1 generic brain: ~82% vs autobot over 1008 duels.
   ✅ M2 `sim` brain (since folded into the planner): main-phase activations judged by playing them on a rebuilt copy of the board
   (`docs/ai-plan.md` §6a); 54% vs generic, 84% vs autobot.
   ✅ M3: chain responses by replaying the opponent's action, then the turn planner (`planner`, the
   default opponent): 64% vs generic, but measurably passive (skips summons, holds Spells/Traps).
   **Now: `docs/ai-rework-plan.md`** (2026-10-15). ✅ phase 0 (tag `ai-baseline-2026-10-15`), ✅ phase 1
   (`arena --stats`), ✅ phase 4 (report log `docs/ai-reports.md`, `known` bench positions), ✅ phase 2: sampled
   opponent worlds built, measured no better and removed (git 1095a52); the passivity was the evaluation: LP and hand-card weights
   fitted to who won (`tools/ai/fit-eval.ts`), ~30% fewer skipped summons / unused Spells/Traps, even win rate, all bench
   positions pass. Next: phase 3 (more fitting, then retune). User reports go into the log; only clear bugs are fixed right away.
   ✅ Trace reviews 101-114 (2026-10-16/17: Claude plays traced planner-vs-planner duels and reads them for misplays): fixes so far
   cover battle (probes, lethal search, refused targets), copies (equip links, card-target locks, stolen monsters), chain replays,
   positions in the opponent's turn, draw plans averaged over Deck orders; open findings stay in `docs/ai-reports.md`. No arena
   run yet on df34ec9 / b795a67.
4. **Overworld**: ✅ first Tiled map (ported from the owner's Phaser 3 prototype), collisions, y-sorted walls, NPCs with
   dialogue who duel with their own decks, settings menu (M). ✅ touch controls + full screen on phones. ✅ hedge maze map east of the town (`tools/maps/hedge-maze.mjs`, then edited by hand), map transitions (warps).
   ✅ Character sprites from the Reshef of Destruction sheet, hold Z to run, a girl player option.
   Next: trainer line-of-sight challenges.
5. **RPG loop**: ✅ deck editor v1 (every pool card, custom deck slots, both themes; later: limited to your collection).
   Next: card collection, rewards/boosters after duels, story progression and gym-like bosses, save to localStorage.
6. Move the duel to a Web Worker if long chains cause frame hitches.
7. **Multiplayer**: ✅ peer-to-peer v1 (lockstep over PeerJS, room codes / invite links, each player's chosen deck, leave
   detection, FORFEIT). Later: own decks once the deck editor exists, a "waiting for opponent" indicator, reconnect,
   a TURN server for networks that block direct connections, maybe a server (hidden info stays hidden).
