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
| 5b | Call a coin toss (`SELECT_OPTION` with Heads / Tails) | Title over both coin faces (2x), HEADS / TAILS button under each; coins lift on hover | Runewood | `&setup=coin`: Time Wizard's effect | [ ] |
| 6 | Battle position (`SELECT_POSITION`) | Card at 2x, ATTACK / FD ATTACK / DEFENSE / FD DEFENSE (only legal ones) | Runewood | Monster Reborn a monster | [ ] |
| 7 | Duel over | YOU WIN / YOU LOST / DRAW, CONTINUE | Runewood | Finish a duel (`&lp=500` makes it quick) | [ ] |
| 18 | Declare a Type / Attribute (`ANNOUNCE_RACE`, `ANNOUNCE_ATTRIB`) | One button per allowed Type / Attribute; several needed = one dialog per pick, "(1/2)" | Runewood | `&setup=declare`: Tribe-Infecting Virus, DNA Transplant | [ ] |
| 19a | Declare a number (`ANNOUNCE_NUMBER`) | One button per allowed number | Runewood | `&setup=declare`: Sixth Sense (two dialogs) | [ ] |

## Card pickers (`Modal.picker`)

#9, #10 and #11 happen **on the board** when every choice is a card on the field or in your hand (attack
targets, tributes, Man-Eater Bug...): choices get a dark green 1px outline, picked ones a bright green 2px
one, and the prompt + CONFIRM / CANCEL / FINISH sit in the strip across the field. They fall back to the
picker dialog when a choice is in the Graveyard, Deck, etc. Try the board version with
`&dialogs` → "#9 On the field".

| # | Prompt | Shows | Style | How to see it | Tested |
|---|---|---|---|---|---|
| 8 | Chain (`SELECT_CHAIN`) | Cards you can chain (caption: effect name, else location — none for S/T), "DON'T CHAIN" (unless forced) | Runewood | Have Mirror Force / Sakuretsu / Trap Hole / MST set when the opponent attacks or summons | [ ] |
| 9 | Select card(s) (`SELECT_CARD`) | Cards with location captions, CONFIRM n/max (multi) / CANCEL | Runewood | Monster Reborn, MST, Change of Heart targets; Sangan search | [ ] |
| 10 | Tribute (`SELECT_TRIBUTE`) | Your monsters (no captions), CONFIRM n/max / CANCEL | Runewood | Tribute Summon Summoned Skull / Dark Magician / Blue-Eyes | [ ] |
| 11 | Select/unselect (`SELECT_UNSELECT_CARD`) | Cards in board order, picked ones raised + CHOSEN, FINISH n/max / CANCEL | Runewood | Some multi-target effects; none certain in this pool | [ ] |
| 12 | Sum selection (`SELECT_SUM`) | Cards with VALUE captions, CONFIRM sum/target | Runewood | Ritual summons; no ritual cards in this pool | [ ] |
| 13 | Graveyard browser | YOUR / OPPONENT'S Graveyard (newest first, no names), then BANISHED; CLOSE | Runewood | Click a Graveyard pile | [ ] |
| 13b | Extra Deck browser | YOUR Extra Deck; CLOSE (the opponent's isn't clickable) | Runewood | `&deck=kaiba`, click your Extra Deck | [ ] |
| 17 | Order cards (`SORT_CARD`) | Cards in a row (top of the Deck first); each click numbers the next card (badge, card raised), RESET / CONFIRM n/total; 1 goes on top | Runewood | `&setup=sort`: Flip Summon Big Eye (TO ATK) | [ ] |
| 19b | Declare a card name (`ANNOUNCE_CARD`) | Search dialog (`Modal.search`): text field + match count, best 8 matches as rows, Up/Down + Enter or click; tapping the field opens a phone keyboard | Runewood | `&setup=declare`: Mind Crush | [ ] |

## Field prompts

| # | Prompt | Shows | Style | How to see it | Tested |
|---|---|---|---|---|---|
| 14 | Zone choice (`SELECT_PLACE`, `SELECT_DISFIELD`) | Free zones in semi-transparent yellow (more opaque on hover / picked) + prompt in the field strip | Yellow for now | Summon or set any card | [ ] |
| 16 | Remove counters (`SELECT_COUNTER`) | On the board like tributing: cards with counters outlined, each click takes one more (badge shows what's left; a card that gave all it can, or a click once enough are taken, puts its counters back), CONFIRM n/needed | Runewood | No pool card asks yet (Breaker / Skilled Dark Magician remove their own); `&setup=counters&dialogs` → #16 | [ ] |
| 15 | Turn banner | Blue/red band, 1px light top / dark bottom edge, "YOUR TURN" with drop shadow, "TURN n" under it | Kept + polished | Every turn; `&anims` → #11 | [ ] |

## Auto-answered (no UI yet)

`autoBot` answers these and the log says `(auto-answered …)`. None should come up with the current pool.
Declarations (#18, #19) have their UI now (see above); the bot picks a legal card name via `declarableCards`.

| # | Prompt | Would need |
|---|---|---|
| 17b | `SORT_CHAIN` | Ordering list (could reuse #17's dialog) |
| 20 | `ROCK_PAPER_SCISSORS` | RPS buttons |
