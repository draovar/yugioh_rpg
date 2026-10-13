// Rock-paper-scissors before a duel decides who goes first: the winner chooses first or second.
// UI-agnostic: the duel scene plays it with cards (src/ui/duel/RpsIntro.ts) against an RpsOpponent.

/** 0 = rock, 1 = paper, 2 = scissors (each beats the one before it, rock beats scissors). */
export type RpsHand = 0 | 1 | 2;
export const RPS_HANDS: readonly RpsHand[] = [0, 1, 2];
export const RPS_NAMES = ["Rock", "Paper", "Scissors"] as const;

/** 0 = `a` wins, 1 = `b` wins, null = a draw. */
export function rpsWinner(a: RpsHand, b: RpsHand): 0 | 1 | null {
  if (a === b) return null;
  return (a - b + 3) % 3 === 1 ? 0 : 1;
}

/** The other player: the built-in AI or, in a peer-to-peer duel, the player on the other machine. */
export interface RpsOpponent {
  /** Their hand for the next round; resolves once they have picked (never shown before both have). */
  nextHand(): Promise<RpsHand>;
  /** Our hand for this round. */
  sendHand(hand: RpsHand): void;
  /** They won: resolves with whether they go first. */
  order(): Promise<boolean>;
  /** We won: whether we go first. */
  sendOrder(meFirst: boolean): void;
}

/** The AI picks at random after a short "thinking" delay and, when it wins, goes first. */
export function aiRpsOpponent(schedule: (ms: number, fn: () => void) => void, random = Math.random): RpsOpponent {
  return {
    nextHand: () => new Promise((resolve) => schedule(500 + random() * 1000, () => resolve(Math.floor(random() * 3) as RpsHand))),
    sendHand: () => {},
    order: () => Promise.resolve(true),
    sendOrder: () => {},
  };
}
