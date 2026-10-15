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

### Phase 3: retune all weights together (mostly machine time)

Run `npm run tune -- --brain planner` (overnight) on the full `Weights`, including today's additions. Keep a winner
only if the arena says ≥ 53.5% against the baseline **and** the passivity numbers don't get worse. Weights that tune
to "no effect" (e.g. `openField` after phase 2) go back to neutral.

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

- `summon-under-1600-next-to-a-monster` (added, `known: "phase 2a"`): Warrior Dai Grepher on the field, Celtic
  Guardian in hand, opponent with a set monster and 4 cards → summon Celtic Guardian.
- `set-magic-jammer` (passes today only because of `setTrap`; phase 3 decides whether that weight stays).
- `respect-a-set-card` (to add in phase 2b): three monsters vs one set card and an empty field, lethal not
  available → don't attack with everything. Needs ai-bench to check battle decisions (today it checks the first
  main-phase choice, its plan line, or chain answers).

## Order and size

| Phase | Size | Session |
|---|---|---|
| 0 baseline tag | minutes | this one |
| 4 report log + `known` flag | small | this one or next |
| 1 statistics | a few hours | next |
| 2 sampled worlds | large | its own session |
| 3 tuning | overnight run | after phase 2 |
