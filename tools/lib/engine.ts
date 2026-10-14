// Shared setup for the Node duel tools: the engine core plus the card data and scripts the browser game uses.
// Needs `npm run build-data` first.
import { readFileSync } from "node:fs";
import path from "node:path";
import createCore, { OcgMessageType } from "ocgcore-wasm";
import type { AiSeat } from "../../src/duel/ai/AiSeat.ts";
import { CardDb, type CardRecord } from "../../src/duel/cardData.ts";
import { DuelSession, type DuelSeed, type Deck, type StepResult } from "../../src/duel/DuelSession.ts";

const DATA = path.resolve(import.meta.dirname, "../../public/data");
const records: CardRecord[] = JSON.parse(readFileSync(path.join(DATA, "cards.json"), "utf-8"));
const scripts: Record<string, string> = JSON.parse(readFileSync(path.join(DATA, "scripts.json"), "utf-8"));

export const cards = new CardDb(records);
export const core = await createCore({ sync: true });
export const readScript = (name: string) => scripts[path.basename(name)] ?? null;

export interface NewDuel {
  decks: [Deck, Deck];
  seed?: DuelSeed;
  /** One for both players, or [P0, P1]. */
  startingLP?: number | [number, number];
  /** Opening hand and draws per turn (default 5 and 1). */
  draws?: { opening: number; perTurn: number };
  /** Engine warnings (script errors); default: printed. */
  onCoreLog?: (type: number, text: string) => void;
}

export function newDuel(opts: NewDuel): DuelSession {
  return new DuelSession({ core, cards, readScript, ...opts });
}

/** Four 64-bit seed words from one number (splitmix64), so `--seed N` names a whole duel. */
export function seedFrom(n: number): DuelSeed {
  let x = BigInt(n) & 0xffffffffffffffffn;
  const next = () => {
    x = (x + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
    let z = x;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
    return z ^ (z >> 31n);
  };
  return [next(), next(), next(), next()];
}

export interface DuelRun {
  /** Seat of the winner; null = draw. */
  winner: number | null;
  turns: number;
  messages: number;
  /** Decisions made per seat. */
  decisions: [number, number];
  /** Time spent in each seat's `decide`, in ms. */
  thinkMs: [number, number];
  /** Each seat's slowest single decision, in ms. */
  maxMs: [number, number];
}

/** Plays a duel to the end with an AI in each seat. `onStep` sees every engine step (raw), before the AIs do. */
export function runDuel(duel: DuelSession, seats: readonly [AiSeat, AiSeat], onStep?: (step: StepResult) => void, maxDecisions = 20_000): DuelRun {
  const run: DuelRun = { winner: null, turns: 0, messages: 0, decisions: [0, 0], thinkMs: [0, 0], maxMs: [0, 0] };
  for (;;) {
    const step = duel.advance();
    onStep?.(step);
    run.messages += step.messages.length;
    run.turns += step.messages.filter((m) => m.type === OcgMessageType.NEW_TURN).length;
    for (const s of seats) s.observe(step.messages);
    if (step.ended) { run.winner = step.winner; return run; }
    const player = (step.prompt as { player: number }).player as 0 | 1;
    if (run.decisions[0] + run.decisions[1] >= maxDecisions) throw new Error("duel did not finish");
    const t = performance.now();
    const response = seats[player].decide(step.prompt!);
    const ms = performance.now() - t;
    run.thinkMs[player] += ms;
    run.maxMs[player] = Math.max(run.maxMs[player], ms);
    run.decisions[player]++;
    duel.respond(response);
  }
}
