# AI misplay reports

Every misplay the user reports from play (`&aitrace` seed line + trace, L-key board dump). Workflow:
`ai-rework-plan.md` phase 4.

- **Bugs** (wrong rules, wrong targets, crashes, information lost in the copies) are fixed right away.
- **Judgement calls** get a cause category and an `ai-bench` position, marked `known: "<phase>"` until the phase
  that addresses that cause lands; no single-position weight tweaks.

Cause categories: **opponent model** (the copies' guess of hidden cards), **horizon** (one turn ahead), **evaluation**
(board values / weights), **chain rule** (responses outside the replay), **copy gap** (something the rebuilt board
loses), **bug** (engine, UI, plain code error).

| Date | Seed (replay) | What the AI did | Should have | Cause | Bench position | Status |
|---|---|---|---|---|---|---|
| 2026-10-15 | 285646544 | turned Winged Dragon #1 + Axe of Despair (2400) to defense instead of attacking an empty field | attack | copy gap (equip links) | `attack-with-equipped-monster` | fixed 2da28b4 |
| 2026-10-15 | 1256201709 | summoned Celtic Guardian in attack facing Blue-Eyes when every line lost | set it | evaluation (lost lines tied) | `set-the-blocker-facing-blue-eyes` | fixed 86cd0be |
| 2026-10-15 | 1108951983 | chained The Reliable Guardian to Just Desserts in its own turn, on the opponent's Opticlops | pass | chain rule + bug (target) | `no-buff-against-just-desserts` | fixed fa1adf5 |
| 2026-10-15 | 1108951983 | never set The Reliable Guardian behind a defending Giant Soldier of Stone | maybe set it | opponent model | none (board not known) | open |
| 2026-10-15 | 2134230429 | held Black Luster Ritual + Soldier for turns with enough tributes | ritual summon | evaluation | `ritual-summon-black-luster-soldier` | passes via stuckMonster2 (cdd3252), phase 3 to confirm |
| 2026-10-15 | 214142266 | kept Mystic Clown / Celtic Guardian in hand with both fields empty | summon and attack | opponent model | `attack-an-empty-field` | passes with the fitted weights (phase 2); `openField` still in, phase 3 |
| 2026-10-15 | 1633241308 | attacked with three monsters into a set card | play around it (user: MST it first, but never let it stop attacks) | opponent model + evaluation | `clear-the-set-card-first`, `attack-through-a-set-card` | passes with the fitted LP / hand weights (phase 2) |
| 2026-10-15 | 1633241308 | summoned Dark Blade, then Pot of Greed | Pot first | horizon (draws are guesses) | `pot-of-greed-first` | fixed ee46283 |
| 2026-10-15 | 1286403690 | chained The Reliable Guardian (+DEF) on its attacking monster after Mystic Tomato resolved | pass | chain rule | none (didn't reproduce) | fixed b20a943 |
| 2026-10-15 | 605846013 | kept Magic Jammer in hand behind Warrior Dai Grepher | set it | evaluation + opponent model | `set-magic-jammer` | passes (whole-turn check) with the fitted weights; `setTrap` still in, phase 3 |
| 2026-10-15 | 605846013 | kept Celtic Guardian in hand next to Warrior Dai Grepher | summon it | opponent model | `summon-under-1600-next-to-a-monster` | passes with the fitted LP / hand weights (phase 2) |
