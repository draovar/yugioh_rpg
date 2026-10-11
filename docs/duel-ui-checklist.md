# Duel UI checklist

Every prompt and overlay the duel screen shows, with its current look and how to reach it with the current
20-card pool (`data/pool.json`). Tick **Tested** once you've seen it in a real duel.

Style: **Runewood** = new look · **Old** = blue panel / dark strip, still to redo.

To see any of #3–#14 without setting it up in a duel, open `/?duel&dialogs` and pick it from the dropdown
(top-left). It uses sample cards; your answer goes to the duel log instead of the engine.

## Card menu (on the card)

| # | Prompt (engine message) | Shows | Style | How to see it | Tested |
|---|---|---|---|---|---|
| 1 | Main phase (`SELECT_IDLECMD`) | Card flips to menu: SUMMON / SP.SUM / SET / FLIP / TO ATK / TO DEF / USE + BACK | Runewood | Click any card in hand on your turn | [ ] |
| 2 | Battle phase (`SELECT_BATTLECMD`) | Card menu: ATTACK / USE + BACK | Runewood | Battle phase, click your monster | [ ] |

## Dialogs (`Modal.dialog`)

| # | Prompt | Shows | Style | How to see it | Tested |
|---|---|---|---|---|---|
| 3 | Optional effect (`SELECT_EFFECTYN`) | Card at 2x, "Activate …?", YES / NO | Runewood | Optional trigger effects; rare in this pool | [ ] |
| 4 | Yes/no question (`SELECT_YESNO`) | Question, YES / NO | Runewood | Card scripts asking a question; rare in this pool | [ ] |
| 5 | Choose an option (`SELECT_OPTION`) | Title + one button per option (stacked if long) | Runewood | Cards with "choose one effect"; none certain in this pool | [ ] |
| 6 | Battle position (`SELECT_POSITION`) | Card at 2x, ATTACK / FD ATTACK / DEFENSE / FD DEFENSE (only legal ones) | Runewood | Monster Reborn a monster | [ ] |
| 7 | Duel over | YOU WIN / YOU LOST / DRAW, CONTINUE | Runewood | Finish a duel (`&lp=500` makes it quick) | [ ] |

## Card pickers (`Modal.picker`)

| # | Prompt | Shows | Style | How to see it | Tested |
|---|---|---|---|---|---|
| 8 | Chain (`SELECT_CHAIN`) | Cards you can chain (caption: effect name or location), "DON'T CHAIN" (unless forced) | Runewood | Have Mirror Force / Sakuretsu / Trap Hole / MST set when the opponent attacks or summons | [ ] |
| 9 | Select card(s) (`SELECT_CARD`) | Cards with location captions, CONFIRM n/max (multi) / CANCEL | Runewood | Monster Reborn, MST, Change of Heart targets; Sangan search | [ ] |
| 10 | Tribute (`SELECT_TRIBUTE`) | Your monsters (no captions), CONFIRM n/max / CANCEL | Runewood | Tribute Summon Summoned Skull / Dark Magician / Blue-Eyes | [ ] |
| 11 | Select/unselect (`SELECT_UNSELECT_CARD`) | Cards in board order, picked ones raised + CHOSEN, FINISH n/max / CANCEL | Runewood | Some multi-target effects; none certain in this pool | [ ] |
| 12 | Sum selection (`SELECT_SUM`) | Cards with VALUE captions, CONFIRM sum/target | Runewood | Ritual summons; no ritual cards in this pool | [ ] |
| 13 | Graveyard browser | YOUR / OPPONENT'S Graveyard (newest first, no names), then BANISHED; CLOSE | Runewood | Click a Graveyard pile | [ ] |

## Field prompts

| # | Prompt | Shows | Style | How to see it | Tested |
|---|---|---|---|---|---|
| 14 | Zone choice (`SELECT_PLACE`, `SELECT_DISFIELD`) | Yellow free zones + text strip across the field | Old (strip) | Summon or set any card | [ ] |
| 15 | Turn / phase banner | Coloured band with "YOUR TURN" etc. | Old | Every turn; `&anims` → #11 | [ ] |

## Auto-answered (no UI yet)

`autoBot` answers these and the log says `(auto-answered …)`. None should come up with the current pool.

| # | Prompt | Would need |
|---|---|---|
| 16 | `SELECT_COUNTER` | Counter removal picker |
| 17 | `SORT_CARD`, `SORT_CHAIN` | Ordering list |
| 18 | `ANNOUNCE_RACE`, `ANNOUNCE_ATTRIB` | Type / attribute picker |
| 19 | `ANNOUNCE_NUMBER`, `ANNOUNCE_CARD` | Number list / card-name search |
| 20 | `ROCK_PAPER_SCISSORS` | RPS buttons |
