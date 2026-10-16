# AI rework plan: from patching reports to fixing causes (2026-10-15)

## Why

A day of the report → fix loop (2026-10-15) kept turning up the same two mistakes: the AI **doesn't summon monsters
it should** and **doesn't use Spells/Traps it should**. Each report was fixed on its own, often with a hand-picked
weight that made that one position come out right. Results:

- The same mistakes came back in the next duel, in a slightly different position.
- Every weight change came back neutral or slightly worse in the arena: stuckMonster split 46.9%, openField 48.4%,
  setTrap 45.9%, lpScale 49.7% (each ±5.5%, 320 planner-vs-planner duels). Kept on the user's call, not on evidence.
- The arena can't see the problem: it plays the AI against a copy of itself, so a passivity both sides share never
  shows up as lost games.

Most reports trace back to **one cause**: the AI's picture of the opponent's next turn. In every copy
(`sim/world.ts`) the opponent's hidden hand is exactly one average 1600 ATK monster plus blanks, and their face-down
cards never do anything. So:

| What the user sees | Why |
|---|---|
| Monsters under 1600 ATK stay in hand (Mystic Clown, Celtic Guardian) | in the copy they always die to the guessed 1600 attacker |
| Protective Traps stay in hand (Magic Jammer) | the opponent's stand-ins never play anything to protect against |
| Attacks into set cards without fear (Mirror Force risk) | the opponent's set stand-ins never activate |
| Holding cards always looks safe | nothing in the copy punishes a passive turn beyond one 1600 hit |

Weights can't fix a wrong picture of the opponent; they only move where the mistakes show up.

## The plan

### Phase 0: clean baseline (small)

- Tag the current main as `ai-baseline-2026-10-15` so every later number compares against the same AI.
- Today's hand-picked weights (`stuckMonster`/`stuckMonster2`, `openField`, `setTrap`/`setTrapStep`) stay for now
  but are **candidates**: phase 3 retunes them, and phase 2 may make `openField` unnecessary.
- The clear bug fixes of 2026-10-15 stay as they are (equip links in copies, losing lines by overkill, replay of
  their chain link in our turn, boost targets, finished activations, fallback chain check, draw spells first,
  ritual pairing and tributes).

### Phase 1: measure what the user sees (a few hours)

Add **passivity statistics** to `tools/lib/match.ts` (`Result`) and print them in `arena` per brain, per 100 turns:

1. **Skipped summons**: the AI ended its turn (TO_EP) while the main-phase prompt still offered a Normal Summon or
   Set and none was used that turn.
2. **Open field**: the AI ended its turn with no monster while the opponent held cards.
3. **Unused Spells/Traps**: activatable Spells/Traps left in hand at end of turn (from the idle prompt's `activates`
   and `spell_sets`), and Spells/Traps still in hand when the duel ended.
4. **Attacks into set cards**: attacks declared while the opponent had face-down Spells/Traps (for phase 2b).

Record the baseline numbers (planner vs planner and planner vs `generic`) in this file. From then on every change
reports **win rate and passivity numbers**, and "less passive" is a measured claim.

Done when: `npm run arena -- --stats` prints the four numbers for both sides; baseline recorded here.

✅ Done 2026-10-15 (`PassivityStats` in `match.ts`: the AiSeats are wrapped, counts come from their own prompts and
answers, the board as the turn player sees it at the turn's last decision). "Unused S/T" counts the hand
Spells/Traps the turn's last main-phase prompt offered to activate or set that are still in hand at the turn's end.

**Baseline** (`--n 10 --decks yugiEvolution,kaibaEvolution,yugi,kaiba --stats`, seeds from 1, 320 duels each):

| Match | Side | Win rate | Skipped summons | Open field | Unused S/T | Attacks into sets | S/T in hand at end |
|---|---|---|---|---|---|---|---|
| planner vs planner | A planner (2631 turns) | 46.6% ± 5.5 | 11.1 | 26.5 | 183.3 | 40.6 (58% of attacks) | 1.89 |
| | B planner (2625 turns) | | 11.1 | 24.8 | 182.6 | 42.6 (57%) | 1.78 |
| planner vs generic | A planner (2270 turns) | 64.1% ± 5.3 | 11.7 | 23.9 | 191.7 | 25.8 (31%) | 2.02 |
| | B generic (2305 turns) | | 2.8 | 30.1 | 54.0 | 35.7 (55%) | 0.56 |

Per 100 own turns, except the last column (per duel). What it shows: the planner skips a Normal Summon it could make
in about 1 turn in 9 (generic: 1 in 36) and leaves about 1.8 playable Spells/Traps in hand per turn (generic: 0.5),
so its passivity is measurable and much stronger than the M1 brain's. It still wins 64% against generic.
The 46.6% planner-vs-planner split (same brain, both seat orders) is the noise to expect at this size.

### Phase 2: a better guess of the opponent (the real work, its own session)

Replace the single fixed guess with a few **sampled worlds** (the reference project's approach, `ai-plan.md` §6),
without ever reading hidden cards (`redact()` stays the only gate):

a. **Hand**: instead of always one 1600 ATK attacker, worlds with no monster, an average one (1600) and a strong one
   (2400 / a tribute monster), weighted by how many cards they hold.
b. **Set Spells/Traps**: stand-ins that can actually do something in some worlds: one that destroys an attacker
   (Sakuretsu Armor / Mirror Force-like, a short Lua script in `world.ts`) and one that does nothing.
c. **Hand removal**: in some worlds one hidden card is a "destroy one monster" Spell, so a lone big monster isn't
   treated as untouchable.

Cost control: the planner's beam search keeps running on one average world; only the best ~6 plans are **rescored**
in all K worlds (K = 3-4) and averaged. Copies come from the prepared pool, so this costs about K × 6 extra copies
per plan (well inside the 2 s budget).

Done when: the new bench positions below pass, all old ones still pass, passivity numbers clearly drop versus the
baseline, and the arena against the baseline is **≥ 50%** (not weaker; better is the goal).

**Outcome 2026-10-15: sampled worlds built but not better (since removed); the passivity was fixed in the
evaluation instead** (fitted weights below: every bench position passes, ~30% fewer skipped summons and unused
Spells/Traps, even win rate). Changed from the plan above, with the user:
- Worlds are **real cards** drawn at the odds the prebuilt decks play them (`sampleWorlds` in `world.ts`; cards
  they've shown count as played by their deck, visible copies are used up), not hand-made stand-ins: no probabilities
  picked by hand, and real Trap Hole / Sakuretsu Armor / Smashing Ground scripts. The opponent's cards answer the
  AI's moves in a world (generic chain rule).
- Rescoring in rounds (4 → 8 → 16 worlds, 32 for close calls): 4 worlds were too noisy (set-the-wall flipped between
  seeds; with 32 worlds set beats summon in every seed). Values averaged as win chances (`worldScale`).
- With worlds the planner also plans the battle phase.
- The user's expectations (memory `feedback-ai-expected-behavior`): summon and attack an empty board with an attacker,
  set a wall unless its attack is lethal, clear set cards first but never let them stop attacks. Bench positions:
  `summon-and-attack-an-empty-board`, `set-the-wall`, `wall-attacks-for-lethal`, `clear-the-set-card-first`,
  `attack-through-a-set-card` (whole-turn checks, `turn: true`).

Results (`--decks yugiEvolution,kaibaEvolution,yugi,kaiba --stats`, A = the planner with worlds, B = the single guess; the brains were
later renamed: `worlds` and `planner`):

| Run | A win rate | Skipped summons A / B | Open field A / B | Unused S/T A / B | Attacks into sets A / B |
|---|---|---|---|---|---|
| default weights, 320 duels | **43.8% ± 5.4** | 14.5 / 11.9 | 24.8 / 21.6 | 173 / 179 | 36.5 (55%) / 45.8 (58%) |
| plain average (`worldScale` 1000), 128 | 44.5% ± 8.6 | 16.5 / 10.1 | 25.5 / 27.1 | 186 / 188 | 34.0 / 44.9 |
| `handMonsterFactor` 0.4 both sides, 128 | 51.6% ± 8.7 | 8.7 / 7.2 | 26.9 / 29.0 | 186 / 199 | 37.3 / 41.2 |

Bench: `summon-under-1600-next-to-a-monster` and `summon-and-attack-an-empty-board` now pass (the single guess fails both),
`set-the-wall` passes; failing: `attack-an-empty-field` 2/4 (summon vs set within 0.1-0.3), `set-magic-jammer`,
`clear-the-set-card-first` 4/4. Think time ≈ 180 ms per decision (single guess 51), slowest ≈ 3.9 s.

**Why it's weaker: the evaluation, not the guess.** A card in hand is a safe store of value within one turn of
look-ahead: a monster in hand counts 0.3 + 0.7 × its field value (Beaver Warrior 1.28 in hand, 1.40 on the field), so
summoning gains ~0.1 and any world where it then dies (Trap Hole, removal, a bigger attacker) makes holding look
better. The single guess had no removal and no traps, so it hid this; realistic worlds expose it (trace: three turns
holding Summoned Skull and Beaver Warrior at +4.7 ahead, "do nothing" 4.72 vs "summon" 4.07). Holding only postpones
the risk (the card must reach the field to do anything), which a one-turn horizon can't see. Risk aversion from the
win-chance average is not the cause (plain averaging measured the same); lowering the hand value cuts skipped summons
for both brains and brings worlds to par. Unused Spells/Traps (~180 per 100 turns) didn't move in any run: same cause
for Spells/Traps in hand (`handSpell` 1.3 ≥ a set card or a 1-for-1 trade).

**The fix: weights fitted to who won** (`tools/fit-eval.ts`, "Texel tuning"). `arena --record` keeps each turn's
starting position as the turn player saw it and whether they won; a logistic regression finds the weights (monster
values = the unit) that predict the winner best, checked on held-out duels, error bars by bootstrap over duels.
Data: 72k positions from 5000 generic-vs-generic duels, 5.6k from 320 planner-vs-planner duels.
- **LP**: a flatter curve predicts better, levelling off around `lpHalf` 10000 (held-out loss 0.574 at 1500 → 0.564
  at 10000); `lpScale` there 11.9 ± 0.7 (generic) and 12.5 ± 4.2 (planner). Damage at 8000 LP is now worth ~0.43
  cards per 1000 (was 0.10): the user's "deal damage" rule. (Fitting `lpHalf` freely ran into the bound: an
  optimiser overshoot, the fixed grid predicts better.)
- **Hand cards**: both data sets put them well below the old values: a 1400 ATK monster in hand ≈ 1.0-1.07 (field
  1.57; old 1.28), `handSpell` ≈ 1.0 (old 1.3), `handUnknown` ≈ 1.0 (old 1.2). Traps disagree (generic 0.88 in
  hand, planner 1.56 ± 0.32) and stay as they were, like everything the fits couldn't pin down (`defFactor`) or that
  looked confounded (`equip` came out negative).
- Adopted: `lpScale` 12, `lpHalf` 10000, `handMonsterBase` 0.5, `handMonsterFactor` 0.4, `handSpell` 1,
  `handUnknown` 1. The fitted scale (cards → win chance) is 2.4-4, so `worldScale` 3 stays.

Results with the fitted weights (4 decks as above):

| Run | A win rate | Skipped summons A / B | Open field A / B | Unused S/T A / B | Attacks into sets A / B | S/T in hand at end A / B |
|---|---|---|---|---|---|---|
| `planner` fitted vs `planner` old, 736 duels (seeds 1 and 1001) | **49.7% ± 3.6** | **8.3 / 12.7** | 24.8 / 23.3 | **132 / 185** | 37.9 (52%) / 44.6 (59%) | 1.34 / 1.82 |
| `worlds` vs `planner`, both fitted, 320 duels | 46.6% ± 5.5 | 9.0 / 7.9 | 25.1 / 22.9 | 105 / 126 | 38.6 (53%) / 49.5 (66%) | 1.06 / 1.29 |

Against the phase 1 baseline (11.1 skipped summons, 183 unused S/T per 100 turns) the default planner now skips
about a quarter fewer summons and leaves about 28% fewer Spells/Traps unused, at the same strength. `ai-bench`: all
19 positions (56 runs) pass with the default planner, including every one that failed before (`summon-under-1600-…`,
`summon-and-attack-an-empty-board`, `clear-the-set-card-first`, `attack-an-empty-field`, `set-magic-jammer`).

Sampled worlds on top still don't pay: fewer unused Spells/Traps and fewer attacks into set cards, but 46.6% and
3.5× the think time. Kept as brain `worlds` for later (with a longer horizon, or once the opponent model in the
copies plays its cards better). **Removed 2026-10-16** at the user's request, with the `sim` and `replay` brains (only
`generic` and `planner` are left, plus `autobot` for the smoke tests): the whole worlds code (`sampleWorlds`, rescoring
rounds, battle-phase planning, `worldScale`) is in git history at 1095a52 if a longer horizon makes it worth retrying.

### Phase 3: retune all weights together (mostly machine time)

Run `npm run tune -- --brain planner` (overnight) on the full `Weights`, including today's additions. Keep a winner
only if the arena says ≥ 53.5% against the baseline **and** the passivity numbers don't get worse. Weights that tune
to "no effect" (e.g. `openField` after phase 2) go back to neutral.

**Outcome 2026-10-16 (first part: the fit; self-play `tune` not run yet): no weight changes. The Trap and set-card
weights are settled at their current values, and the hand-picked `openField`, `setTrap`/`setTrapStep` and
`stuckMonster` stay.**

Data: 1460 new planner-vs-planner duels with the phase 2 weights (960 with the 4 decks, seeds from 5001, and 500 with
all 5 decks including Goat Control, seeds from 7001; 23k positions), plus phase 2's 320 planner and 5000 generic duels.
Fits: `node tools/fit-eval.ts FILES --set lpHalf=10000 --fix defFactor,token,continuous,equip,faceUpSpell,deckLowPenalty`,
40 bootstrap samples.

- **The current weights are already at the data's optimum**: on held-out duels the fitted weights predict the winner
  no better than the current ones (all 1780 planner duels: log loss 0.5306 vs 0.5320, accuracy 72.9% vs 72.7%).
- **Phase 2's Trap disagreement was small-sample noise.** The 320 old planner duels gave `setTrap` 3.6 ± 0.4 and
  `handTrap` 1.5 ± 0.3; the 960 new ones give 1.09 ± 0.23 and 1.06 ± 0.12.
- **`setTrap` can't be fitted in its own formula.** A set Trap is worth `max(setCard, setTrap − setTrapStep·k)`, so once
  the data puts it below `setCard` its slope is zero and the fit returns 0 ± 0. Fitted instead with the floor off
  (`--set setCard=0,setTrapStep=0`, which values our own set Spells at 0 for this check only):

| Weight (current) | Planner, 1780 duels | Generic, 5000 duels |
|---|---|---|
| own set Trap, `setTrap` (1.3) | 1.25 ± 0.14 | 1.12 ± 0.11 |
| Trap in hand, `handTrap` (1.1) | 1.04 ± 0.09 | 0.86 ± 0.06 |
| set − hand | +0.21 | +0.26 |
| their set card, `hiddenSetCard` (1.2) | 1.15 ± 0.09 | 1.00 ± 0.06 |
| our set Spell, `setCard` (1) (normal fit) | 1.22 ± 0.13 | 1.08 |
| `setTrapStep` (0.15) | 0 ± 0.24 (clamped; free, it goes negative) | 0 ± 0.14 (clamped) |

  Both data sets now agree: a set Trap is worth about 0.2-0.25 more than the same Trap in hand. That is the current
  gap (1.3 vs 1.1), and `set-magic-jammer` needs it (with `setTrap` = `setCard` = 1 it fails: setting Jammer would lose
  0.1). No change differs from the current value by more than about one sd, so none is adopted. `setTrapStep` isn't
  supported by the data (later Traps count no less, if anything more), but it isn't ruled out either.
- **`stuckMonster`** is the one weight the data pins down: 0.36 ± 0.13 (planner) and 0.48 ± 0.06 (generic) vs 0.75.
  `stuckMonster2` disagrees (0.70 ± 0.10 vs 0.25 ± 0.07) and stays at 0.5. `lpScale` came out 9.5 ± 1.2 on planner
  duels (generic 11.9 ± 0.7) and stays at 12.
- `tools/fit-eval.ts`: `setTrapStep` is now clamped at ≥ 0 between relinearisations (a negative step ran away: held-out
  loss 0.996 on the generic data). `ai-bench` takes `--weights W.json` to bench candidate weights.

Arena (each candidate as A against the defaults as B, 736 duels, 4 decks, seeds from 1, `--stats`). The **null run**
(defaults on both sides, same seeds) is the reference: on these seeds A comes out at 48.2%, not 50%.

| A | A win rate | Skipped summons A / B | Open field A / B | Unused S/T A / B | Attacks into sets A / B | S/T in hand at end A / B |
|---|---|---|---|---|---|---|
| defaults (null) | 48.2% ± 3.6 | 8.6 / 8.1 | 22.6 / 23.9 | 125 / 124 | 43.1 (56%) / 42.9 (55%) | 1.25 / 1.25 |
| `openField` 0 | 48.2% ± 3.6 | **10.0** / 8.0 | 23.3 / 23.6 | 124 / 125 | 43.1 (56%) / 42.8 (55%) | 1.23 / 1.26 |
| `stuckMonster` 0.45 (fitted) | 48.4% ± 3.6 | 8.6 / 8.0 | 22.7 / 23.8 | 124 / 124 | 42.3 (55%) / 43.2 (55%) | 1.21 / 1.25 |
| `setTrapStep` 0 | 48.6% ± 3.6 | 8.9 / 8.2 | 22.6 / 23.8 | 120 / 124 | 43.5 (57%) / 43.0 (55%) | 1.19 / 1.26 |

- `openField` earns its place: without it the planner skips about 16% more summons (10.0 vs 8.6), at the same strength.
- `stuckMonster` 0.45 predicts the winner better but plays the same: not adopted. (A stuck Level 5-6 in hand marks a
  clumsy hand, which predicts losing without being a decision the AI can do better on.) All 56 bench runs pass with it.
- `setTrapStep` 0: the same strength, 4% fewer unused Spells/Traps, slightly more skipped summons; within noise, so it
  stays at 0.15. All 56 bench runs pass with it.
- On the same seeds the three candidates win 355, 356 and 358 duels against the null's 355: small weight changes
  barely change the planner's games. Telling them apart needs paired runs and several thousand duels each, which also
  sets the bar for `npm run tune` (its 53.5% over 720 duels is far above anything these weights move).

Planner-vs-planner self-play with the phase 2 weights, for reference (the recordings): 49.0% ± 3.2 (960 duels),
49.4% ± 4.4 (500, 5 decks); skipped summons 7-8, open field 24, unused S/T 122-126 per 100 turns, 1.24-1.37 S/T in
hand at the end. The phase 1 baseline was 11.1 / 26 / 183 / 1.8.

Next for phase 3, if wanted: the self-play `tune` run (overnight) with paired seeds and a null run as the bar, or
leave the weights and move on (worlds with a longer horizon, M4 difficulty levels); the evaluation's static weights
look exhausted as a source of strength.

### Phase 4: new report workflow (starts now)

- The user keeps playing and sending reports (seed line + trace + L dump as today).
- Each report goes into a **report log** (`docs/ai-reports.md`): date, seed / replay URL, what the AI did, what it
  should have done, a **cause category** (opponent model, horizon, evaluation, chain rule, engine/UI bug), and the
  bench position made from it.
- **Bugs are still fixed right away** (wrong rules, wrong targets, crashes, lost information in copies). **Judgement
  calls are batched**: they become bench positions and wait for the phase that addresses their category; no
  single-position weight tweaks.
- `ai-bench` gets a `known: true` flag: such positions are reported ("known failing") but don't fail the run, so the
  bench shows progress as phases land.

## Bench positions from the 2026-10-15 reports

- `summon-under-1600-next-to-a-monster`: Warrior Dai Grepher on the field, Celtic Guardian in hand, opponent with a
  set monster and 4 cards → summon Celtic Guardian. Passes with worlds (`known` dropped).
- `set-magic-jammer` (now a whole-turn check: setting it in Main Phase 2 counts): fails with worlds; with
  the single guess it passes, only through `setTrap`. Phase 3: the data backs that gap (a set Trap ≈ 0.2 more than
  in hand), so it stays.
- `respect-a-set-card` was dropped: the user doesn't want set cards to stop attacks. Instead
  `clear-the-set-card-first` (MST before the attacks) and its control `attack-through-a-set-card`.

## Order and size

| Phase | Size | Status |
|---|---|---|
| 0 baseline tag | minutes | ✅ `ai-baseline-2026-10-15` (e6d005a) |
| 4 report log + `known` flag | small | ✅ 45582db |
| 1 statistics | a few hours | ✅ c756d38 |
| 2 sampled worlds | large | built, not better, removed (git 1095a52); passivity fixed by fitted LP / hand weights |
| 3 tuning | overnight run | fit on 1460 more planner duels: weights confirmed, no changes (2026-10-16); self-play `tune` not run |

## Starting phase 2 (notes for the next session)

- Where the guess lives: `src/duel/ai/sim/world.ts` (`opponentSide`: the hidden hand becomes one `BLANK.ATTACKER`
  1600/1200 + `BLANK.CARD`s, hidden set cards `BLANK.TRAP` / `BLANK.MONSTER`; `withBlanks` defines them,
  `copyScripts` gives them empty scripts). Stand-ins that act need small Lua scripts there.
- Where plans are scored: `sim/planner.ts` (`planTurn`: beam search, every node played with
  `Simulator.sequence(..., { opponentTurn: true })` in `sim/sequence.ts`). Rescoring the best ~6 plans in K worlds
  fits at the end of `planTurn`; `deckSeed` already keeps our own draws identical across copies.
- Make it switchable (e.g. a `worlds` count in `PlanSettings`, 1 = today's single guess) so the arena can play the
  new planner against the old one in the same code.
- Judge it with `npm run arena -- --a planner --b planner ... --stats` against the phase 1 baselines above, with
  **720+ duels** for the win rate (320 duels have ±5.5%: planner vs itself came out 46.6%); the passivity gaps are
  large enough for 320. The known-failing bench position `summon-under-1600-next-to-a-monster` should start passing.
- Never read the opponent's real hidden cards: the worlds are built from the `AiView` only (`redact()` is the gate).
