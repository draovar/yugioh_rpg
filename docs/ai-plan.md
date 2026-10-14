# Opponent AI: plan (roadmap #3)

Status: agreed 2026-10-14 (user's answers in §9). M0, M1 and M2 done (branch `ai-m0`). Plan changed after M1 (§6a):
M2 = one-move simulation instead of a hand-written card table. M3 in progress (chain replay built, gain small).

M1 result: the generic brain beats autobot 81.6% ± 2.4% (1008 duels, seeds 5000+, 0 errors), short of the 90% target.
Its losses are card-knowledge mistakes a generic brain can't avoid: Heavy Storm with no opposing Spells/Traps, Breaker /
Tribe-Infecting Virus effects with no useful target (target prompts can't be cancelled; on an empty opposing field it
now waits), Solemn Judgment / Ring of Destruction paying LP at bad moments, Shrink on a 900 ATK monster, discarding
its best card to a cost. M2's card table is aimed at exactly these.

## 1. Where we start

- `src/duel/autoBot.ts`: always picks the first legal option (summons index 0, attacks index 0, chains at 50%...).
  Stays as the fallback and as the "level 0" sparring partner for measurements.
- `DuelController` calls `autoRespond(prompt)` for the AI seat after `aiDelayMs` (450 ms). It already tracks
  `turn` / `turnPlayer` / `phase` and the pending `HINT_SELECTMSG` (only for the human so far).
- **Speed:** 20 full bot-vs-bot duels take 1.8 s headless (incl. engine start), i.e. ~60-90 ms per duel,
  ~0.2 ms per engine step + answer. Heuristic AI is free; even running the real engine for lookahead is affordable.
- **Hidden info:** `snapshot(viewer)` masks hidden cards, but the **raw messages do not**: a `DRAW` message lists
  the drawn codes for either player (checked). The AI must only ever read a redacted message stream.
- **No engine save/clone.** ocgcore can't copy a duel. Lookahead = build a *new* duel from a board layout
  (our `StartCard` setups already place cards in hand/zones) with the hidden cards guessed.

## 2. How others do it

| Approach | Who | How it works | Fit for us |
|---|---|---|---|
| Rule executors per deck | **WindBot** (EDOPro/YGOPro bots, C#) | One class per deck, inheriting `DefaultExecutor`. Ordered rules `AddExecutor(type, card, condition)`; the first rule whose condition says yes wins, so registration order = priority. Generic fallbacks live in the default executor. Only sees what the server sends, no simulation. | Proven and readable, but cards the deck's class doesn't cover are mostly never played, and every new deck needs new code. Doesn't scale to many RPG trainers. |
| Heuristic brain + card table + world sampling | **DUELIST_KINGDOM_ROGUELIKE** (same engine, GOAT, JS) | Scores every option of each prompt; a per-card knowledge table (role, value, when to use it); per-deck plans; 4 difficulty levels made of "knowledge" flags and "defect" flags (error rate, no chains, dumb targeting...). On top: for the top ~6 main-phase candidates it samples 4 hidden-info worlds consistent with what it saw, rebuilds the board in the engine, plays both sides with the heuristic until its next turn, and switches away from the heuristic choice only on a clear margin. Tested against a bench of positions taken from real misplays. | Closest to us. Same engine and era, and it proves world sampling is workable in the browser. Its brain is one 280 KB file; we want the same ideas, split up and data-driven. |
| Deep RL | **ygo-agent** (ygopro-core gym env, PyTorch) | Neural policy trained by self-play. | Strong in modern formats, but needs GPU training, Python, a model running in the browser, retraining on every pool change. It's opaque, and difficulty and personality are hard to tune. Not worth it for a fun RPG opponent. |
| MCTS / ISMCTS | Research on MTG, Hearthstone, Pokémon sims | Search with determinization (sample hidden info) or information-set trees. | Needs a fast clonable forward model; YGO's branching (chains, targets, positions) is huge and ocgcore can't clone. Only the light version (sample a few worlds, compare a few candidates) is realistic, and that's §6. |

## 3. Universal AI or one AI per deck?

**Recommendation: one universal brain + knowledge per card + a profile per trainer (data, not code).**

- One brain enumerates *every legal option* the engine offers at each prompt and scores them with a board
  evaluation plus card knowledge. This is "weigh every possible move", but one decision deep, not a game-tree search.
- Knowledge lives **per card**, not per deck: role, value, when to use it, which targets it wants, what it combos
  with. ~110 entries for the current pool; every future card batch adds its entries. Cards without an entry get
  defaults derived from their data (type, ATK/DEF, level), so a new card is still played sensibly.
- Deck-specific behaviour shrinks to small **plans**: combo lines and key cards, e.g. Lord of D. + Flute,
  Polymerization → Blue-Eyes Ultimate, Scapegoat / Metamorphosis → Thousand-Eyes Restrict, Kuriboh vs lethal. They're
  data that any deck holding those cards picks up, not one class per deck.
- Trainers in the RPG = deck + difficulty level + style weights (aggressive, cautious, trap-happy, burn...),
  written as data in the overworld's trainer definitions.

Why not per-deck AIs: the RPG will have dozens of trainers with decks drawn from the same pool, and later decks
the player can't predict. WindBot shows that per-deck code makes off-plan cards dead weight and makes every new deck a
programming job.

## 4. Architecture (`src/duel/ai/`, no Phaser, runs in Node and the browser)

```
AiPlayer.decide(prompt, ctx) -> OcgResponse      // replaces autoRespond for the AI seat
 ├─ AiMemory      fed the redacted message stream: revealed cards, cards the opponent has shown (deck guess),
 │                the open chain (CHAINING / CHAIN_SOLVED, targets), this turn's facts (Normal Summon used,
 │                who attacked, once-per-turn uses), how long each set card has been set, LP history
 ├─ redact()      the ONE gate between raw messages and the AI (unit-tested: no hidden code gets through)
 ├─ AiView        snapshot(me) + memory = everything the AI may legally know
 ├─ evaluate()    board score: LP (nonlinear, lethal-aware), card advantage (hand + field + usable GY),
 │                board strength (best attacker vs theirs), threats/locks (Jinzo, Prohibition...), deck-out clock
 ├─ deciders/     one per prompt type: idle, battle, chain, effectYN/yesNo, card/tribute/unselect,
 │                position, place, sum, option, announce, counter, sort, rps
 ├─ knowledge.ts  per-card entries + defaults from card data
 ├─ profiles.ts   difficulty levels and style weights
 └─ trace         every decision: options, scores, reason ("Mirror Force: 2 attackers, 4200 ATK")
```

- `DuelController` gets an `ai?: AiPlayer` option (default: autoBot wrapped). The smoke and arena tools use the same interface.
- The AI's randomness comes from an RNG seeded by the duel seed, so `&seed=N` replays the AI's choices too.
- If the AI throws, the dev build stops loudly, and the release build falls back to autoBot's answer and logs it.
  It must never answer illegally (RETRY is a bug, as now).
- The AI knows its own decklist (not the order). For the opponent's deck it knows only cards seen this duel,
  plus pool-wide odds for guesses (e.g. "a face-down monster is X with this probability").

### How each decision works

- **Main phase (SELECT_IDLECMD)**: score each offered action (summon, special summon, set, activate, change
  position, go to battle / end) by the card's rule plus the predicted board gain from our own cheap model, not the
  engine. Take the best positive action; when nothing beats "pass", go to battle or end. The usual order falls out of
  the scores: draw/search first (Pot of Greed, Graceful Charity), removal before attacking, summon, set traps, keep
  cards in hand when they're worth more there.
- **Battle**: plan all attacks together. Lethal check first, then each attacker's best target: win a battle
  without losing the monster, attack directly, never suicide into a known bigger monster. Face-down monsters are
  valued by expected DEF and flip risk (Cyber Jar, Magician of Faith). Higher levels attack with the weakest monster
  first into set backrows to bait Mirror Force / Sakuretsu.
- **Chain responses**: only with a reason from the card's rule plus chain context. Mirror Force vs 2+ attackers or
  one big one; Sakuretsu/Trap Hole above a value threshold; Magic Cylinder on high ATK or lethal; Solemn on
  high-value cards; MST/Dust Tornado in response to activation or in the opponent's End Phase; Book of Moon and
  Scapegoat in the opponent's battle phase; Waboku/Kuriboh on lethal.
- **Card choices**: the `HINT_SELECTMSG` id says the purpose. Destroy/banish/take control (502/503/520) → the
  opponent's most valuable card; discard/tribute/send to GY (500/501/504/531) → our least valuable, preferring cards
  that gain from it (Sangan, Sinister Serpent); add to hand (506) → what the plan needs most; Special Summon (509)
  → best. Targets (551): who owns the card + the card's rule.
- **Position**: attack if it survives the opponent's board, else defense; flip monsters set.

## 5. Difficulty and personality

Three levels: **Rookie / Duelist / Expert**. Expert = as strong as we can make it. Each level is a set of knobs:

| Knob | Rookie | Duelist | Expert |
|---|---|---|---|
| Choice noise (pick among the top options instead of the best) | high | some | none |
| Chain responses | only obvious (lethal) | rule-based | rule-based + context, bait / hold |
| Targeting | first valid | value-based | value-based + plan |
| Combos / deck plans | no | yes | yes |
| Battle planning | per attacker | whole battle | + bait order |
| Lookahead (§6) | no | no | yes |

Style weights (aggression, risk tolerance, trap appetite, burn preference) are separate from the level, so a
cautious Rookie and an aggressive Expert are both possible.

In a Pokémon-style game, **deck quality is the main difficulty lever** (early trainers: weak monsters, few traps).
Even Rookie should never look broken (no suicide attacks into a visible bigger monster). Its mistakes should look human:
holding back, not chaining, attacking into set cards, spending removal early.

## 6. Lookahead (Expert only, M5)

Plain version: the brain judges a move by rules ("Raigeki is good when they have more monsters"). Lookahead also
*tries the move out*: on an imaginary copy of the duel (your hidden cards guessed), it plays the move, the rest of its
own turn and your whole next turn, then looks at the result. It does this for its few best moves and several guesses
of your hand, and picks the move that turns out best on average. Depth: until its next turn.

The reference project's world sampling, done our way:
1. Take the heuristic's top ~5 main-phase candidates (and attack/no-attack chain decisions).
2. Sample 3-6 worlds: our hand known, our deck shuffled, the opponent's hand/sets/deck filled from the cards
   they've shown + pool odds.
3. Build each world as a fresh duel (`DuelSession` from a layout: per-seat LP, cards per zone/position), apply the
   candidate, play both sides with the heuristic until our next turn, then `evaluate()`.
4. Switch away from the heuristic choice only on a clear margin that holds without the most extreme world.

Needs: layout constructor in `DuelSession` (per-seat starting LP), a Web Worker (roadmap #6) so the frame doesn't
hitch, a time budget (~1-2 s, covered by the "thinking" delay). Known blind spots: once-per-turn flags, equip/
control links (Snatch Steal), counters and turn-based effects are lost in the rebuilt world. **Only keep it if the
arena shows a clear gain over Expert without it.**

## 6a. One-move simulation (decided 2026-10-14, after M1)

The user's question after M1: with a board score, would the AI still Heavy Storm its own cards? Not with the score
alone (the AI needs the board *after* the move), but yes with simulation: rebuild the board in the engine, play the
move, let the scripts resolve it, score the result. The engine already knows what every card does, so most of the
planned per-card table becomes unnecessary; only *timing* and *future value* need knowledge.

**Probe results (2026-10-14):**

| Question | Result |
|---|---|
| Rebuild a board so the duel sits in the AI's main phase | ✅ fresh duel, AI = team 0, both boards placed with `duelNewCard`, draw counts 0, pass the draw/standby chain windows |
| Different LP per side | ✅ per-team `startingLP` |
| Card effects in the rebuilt duel | ✅ Heavy Storm destroyed both sides' Spells/Traps; a face-up Jinzo blocked the AI's set trap |
| Hidden cards | ✅ fake codes with no script (blank trap / monster with guessed DEF / card) work as stand-ins; MST only offered them as targets |
| Battle in the rebuilt duel | ✅ with the `attack_first_turn` duel flag |
| Speed | ⚠️ ~17 ms to build (16 ms = loading constant.lua + utility.lua into the new Lua state), ~5 ms to resolve the move |

**Design:**
1. `SimWorld` (`src/duel/ai/sim/`) is built **only from the AiView** (masked snapshot + memory), so it can't cheat:
   own hand / field / GY / banished / Extra Deck by code, the opponent's face-up and public cards by code, their
   face-down cards, hand and both Decks as blank stand-ins (counts kept), LP per side. The AI is always team 0.
2. `simulate(view, option)`: build, find the same option in the copy's prompt (code + location + description), apply
   it, answer its follow-up prompts (zones, targets, costs) with the generic brain's own choices, the opponent passes
   everything, stop at the AI's next main-phase prompt. Result = `evaluate(after) − evaluate(before)`.
3. The main phase scores **activations** (spells, monster effects, traps) by that result instead of fixed type scores.
   Summons, sets and battles stay as they are (stats already judge them).
4. Speed: only activations are simulated (usually 0-4 per prompt); results cached for the same board and option;
   blank duels with the base scripts loaded are prepared ahead of time. Target ≤ 100 ms per decision in the browser.
   The arena gets parallel workers (Node `worker_threads`) so tuning stays fast.
5. Known gaps, covered by a short knowledge list instead of a full card table:
   - lost in the rebuild: once-per-turn uses, equip links, counters (Breaker), Prohibition's declared name, the turn
     number → those options fall back to the M1 score;
   - stand-ins never respond, so the copy can't see a Mirror Force coming → timing rules now, sampled worlds in M5;
   - value that only shows later: Swords of Revealing Light, set traps, Change of Heart's monster going back,
     Graceful Charity's filtering → small "future value" entries;
   - chain responses (an open chain or an attack can't be placed directly) → M3 rebuilds the opponent's attack in the
     copy (opponent as team 0 declares the same attack, the AI answers with each candidate) and compares.

**M2 result (2026-10-14):** the `sim` brain beats the M1 `generic` brain 54.2% ± 5.1% (360 duels), short of the 65%
target, and autobot 83.9% (generic: 78.9% on the same 360 seeds). 0 errors; 2 ms per decision on average, the slowest
135 ms (several copies in one decision). What the simulation judges now, with no card rules: Pot of Greed, Raigeki,
Monster Reborn, Change of Heart / Brain Control / Snatch Steal positive; Dark Hole / Heavy Storm only when they gain;
Book of Moon, Shrink, Waboku, Mind Crush held in the main phase; Graceful Charity positive once hand cards count by
quality. Why the gain is small: main-phase activations are a small share of the decisions that decide duels. The
generic chain rule fires far more often (72 duels: MST 31×, Asura Priest 19, Call of the Haunted 15, Book of Moon 15,
Mirror Force 14, Magic Cylinder 12, ...) → M3.

**M3 status (2026-10-14):** chain responses by replay are built (`sim/replay.ts`, brain `replay`). The opponent's
action (attack, summon, activation, or just the phase) is replayed in a copy where they move first; the AI tries each
candidate or passes during that action, then the copy plays on to the end of their turn (opponent: generic brain with
stand-ins, AI: its usual chain rule) and the boards are compared. Timing rule instead of card knowledge: answer an
action if it gains (> 0.15), in their End Phase unless it loses (> -0.15), in other quiet phases only if big (> 1.5).
Findings: their set traps really can be used in a copy; attack replays work well (Mirror Force +2.6, used 10/11;
Sakuretsu / Waboku / Compulsory when they stop lethal). Result vs `sim`: 51.9% ± 3.0 when scoring right after the
action, 53.0% ± 3.0 when playing on to the end of their turn (1080 duels each). The replay disagrees with the simple rule
in ~11% of chain prompts, mostly passing where the rule uses Book of Moon / MST / Enemy Controller / Magic Cylinder;
whether those passes are right depends on `evaluate()`, which now limits both M2 and M3 (tempo and LP are valued by
hand-picked constants). 6.8 ms per decision on average, 210 ms slowest. The arena now runs on all CPU cores.

## 6b. Weight tuning by self-play (2026-10-14)

Every value judgement (the board score the simulations compare, battle outcomes, card picks) goes through one
`Weights` object (`board.ts`, 19 numbers: LP curve, monster value from ATK/DEF, set / hidden / continuous cards, hand
cards, deck-out penalty, the activation threshold). The hand-picked defaults are what limits M2/M3, so `npm run tune`
searches for better ones: each round multiplies 1-3 weights by a random factor (about ±30%), plays the variant against
the current best (same brain, all deck pairings, both seat orders, fresh seeds): 180 duels first, below 52% it's
dropped, otherwise 540 more, kept at ≥ 53.5% over all 720. Winners are copied into `DEFAULT_WEIGHTS` by hand after a
final check against the old defaults (and against autobot / generic, so self-play doesn't drift somewhere odd).
Trainer styles in M4 are the same mechanism: an aggressive trainer is a weight set that values damage higher.

## 7. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 ✅ | **Plumbing**: `src/duel/ai/`, AiSeat, `redact` + `AiMemory` + `AiView`, seeded AI RNG, decision trace (`&aitrace`), `npm run arena`, `npm run test-ai` | autoBot runs through the new interface; smoke/smoke-p2p unchanged; redact test passes |
| M1 ✅ | **Generic brain**: `evaluate()` + every decider, card data only | 81.6% vs autoBot (target was 90%; the rest needs card knowledge, see §6a) |
| M2 ✅ | **One-move simulation** for main-phase activations (§6a 1-4) | 54% vs M1 (target 65%), 84% vs autoBot; 2 ms avg, 135 ms slowest |
| M3 | **Chain responses by simulation** (rebuilt attacks / activations) + **short knowledge list** for timing and future value; check-cards lists cards the sim can't judge | beats M2 clearly; bench positions pass |
| M4 | **Levels, styles, deck plans** (Rookie / Duelist / Expert), trainer profile format, think delay | each level beats the one below; the user plays every level |
| M5 | **Multi-turn lookahead** for Expert (§6: sampled worlds, play until our next turn), Web Worker | Expert with lookahead beats Expert without it |
| M6 | **Tuning with the user**: reported misplays become bench positions | ongoing |

## 8. How we test it

- **Arena** (`tools/arena.ts`): N seeded duels per pairing, both seat orders, all decks. Reports win rate, avg turns,
  decisions/s. Every milestone's claim is a number from here.
- **Bench** (`tools/ai-bench.ts`): fixed positions (built like `devSetups`) with the expected or forbidden choice,
  e.g. "2 attackers + Mirror Force set → activate", "opponent has 3 set backrow → don't overextend",
  "lethal on board → attack, don't set". Each misplay found in play becomes a position.
- `smoke` / `smoke-p2p` stay green; P2P is unaffected (the AI never plays a lockstep duel).
- Browser: play against each level, read the trace.

## 9. Decisions (user, 2026-10-14)

1. **Strength:** the top level is as strong as possible.
2. **Cheating:** the AI never cheats by default. Some boss battles may later peek at your hand *as a mechanic*. The
   design keeps that possible: `redact()` stays the one gate, and a boss profile can open it explicitly (e.g.
   `peek: "hand"`), never by accident. Not built now.
3. **Levels:** three: Rookie, Duelist, Expert (Expert = hardest).
4. **Lookahead:** in scope for Expert (M4), built after M3 so the arena can show it actually helps.
5. **Memory:** only within one duel. Nothing carries over between rematches.
