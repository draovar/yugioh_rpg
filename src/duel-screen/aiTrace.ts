import type { CardDb } from "../duel/engine/cardData.ts";
import type { Deck, DuelSession } from "../duel/engine/DuelSession.ts";
import { DEFAULT_BRAIN } from "../duel/ai/brains.ts";
import { formatBoard, fullBoard } from "../duel/ai/boardText.ts";
import { phaseLabel } from "../duel/ai/trace.ts";
import { deckNameOf, type DeckName } from "../duel/decks/decks.ts";
import type { DuelSceneData } from "./DuelScene.ts";

/**
 * For `&aitrace`: the seed, who went first, the decks and the brain, plus a dev URL that replays the same duel (your
 * own moves must be repeated by hand). Decks that aren't prebuilt are listed as passcodes.
 */
export function replayInfo(d: DuelSceneData, me: 0 | 1, seed: number, mine: Deck, theirs: Deck): string {
  const brain = d.ai ?? DEFAULT_BRAIN;
  const named = [deckNameOf(mine), deckNameOf(theirs)] as const;
  const params = new URLSearchParams({ seed: String(seed), first: me === 0 ? "you" : "opp" });
  if (named[0]) params.set("deck", named[0]);
  if (named[1]) params.set("opp", named[1]);
  params.set("ai", brain);
  if (d.startingLP !== undefined) params.set("lp", String(d.startingLP));
  if (d.setup) params.set("setup", d.setup);
  const deckText = (deck: Deck, name: DeckName | null) =>
    name ?? `main [${deck.main.join(",")}]${deck.extra?.length ? ` extra [${deck.extra.join(",")}]` : ""}`;
  return [
    `[AI] duel seed ${seed}: ${me === 0 ? "you" : "the AI"} went first, AI brain ${brain}`,
    `     your deck: ${deckText(mine, named[0])}`,
    `     AI deck: ${deckText(theirs, named[1])}`,
    `     press L to log the whole board`,
    `     replay: ${location.origin}${location.pathname}?duel&${params}&aitrace${named[0] && named[1] ? "" : " (with the decks above)"}`,
  ].join("\n");
}

/** For `&aitrace` (L key): the whole board with both hands and every set card, for misplay reports. */
export function boardLog(session: DuelSession, cards: CardDb, me: 0 | 1, at: { turn: number; phase: number; turnPlayer: number; seed: number }): string {
  const board = fullBoard([session.snapshot(0), session.snapshot(1)]);
  const labels: [string, string] = me === 0 ? ["P0 (you)", "P1 (AI)"] : ["P0 (AI)", "P1 (you)"];
  const header = `[board] T${at.turn} ${phaseLabel(at.phase)}, P${at.turnPlayer}'s turn, seed ${at.seed}`;
  return `${header}
${formatBoard(board, cards, labels, me)}`;
}
