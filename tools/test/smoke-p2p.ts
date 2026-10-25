// Headless check of peer-to-peer lockstep: two DuelControllers (seat 0 and seat 1), each with its own
// DuelSession, linked by an in-memory "network" that delivers answers after random delays. Bots answer
// each machine's own prompts; animations are simulated by random waits. Both duels must end the same
// way with the same board, and no checksum mismatch may happen along the way.
// Usage: npm run smoke-p2p [-- <duels>]     (needs `npm run build-data` first)
import { readFileSync } from "node:fs";
import path from "node:path";
import createCore, { type OcgResponse } from "ocgcore-wasm";
import { CardDb, type CardRecord } from "../../src/duel/engine/cardData.ts";
import { DuelSession } from "../../src/duel/engine/DuelSession.ts";
import { DuelController, type RemotePeer } from "../../src/duel/DuelController.ts";
import { autoRespond } from "../../src/duel/ai/autoBot.ts";
import { DECKS } from "../../src/duel/decks/decks.ts";
import { decodeResponse, encodeResponse } from "../../src/net/wire.ts";

const DATA = path.resolve(import.meta.dirname, "../../public/data");
const records: CardRecord[] = JSON.parse(readFileSync(path.join(DATA, "cards.json"), "utf-8"));
const scripts: Record<string, string> = JSON.parse(readFileSync(path.join(DATA, "scripts.json"), "utf-8"));
const cards = new CardDb(records);
const core = await createCore({ sync: true });
const readScript = (name: string) => scripts[path.basename(name)] ?? null;

const jitter = (max: number) => new Promise<void>((r) => setTimeout(r, Math.random() * max));

/** Two linked RemotePeers. Each direction delivers in order, in bursts after a random delay, as JSON text. */
function wire(): [RemotePeer, RemotePeer] {
  const queues: [string, number][][] = [[], []];
  const handlers: (((r: OcgResponse, c: number) => void) | null)[] = [null, null];
  const end = (i: 0 | 1): RemotePeer => ({
    send: (response, checksum) => {
      const to = 1 - i;
      queues[to].push([encodeResponse(response), checksum]);
      void jitter(8).then(() => { for (const [r, c] of queues[to].splice(0)) handlers[to]?.(decodeResponse(r), c); });
    },
    onResponse: (h) => { handlers[i] = h; },
  });
  return [end(0), end(1)];
}

interface Result { winner: number | null; checksum: number; prompts: number }

function play(seed: [bigint, bigint, bigint, bigint]): Promise<[Result, Result]> {
  const links = wire();
  const runs = ([0, 1] as const).map((me) => new Promise<Result>((resolve, reject) => {
    const session = new DuelSession({ core, cards, readScript, seed, decks: [DECKS.goat.deck, DECKS.yugi.deck], onCoreLog: () => {} });
    let prompts = 0;
    const ctl: DuelController = new DuelController({
      session, me, remote: links[me],
      schedule: (ms, fn) => setTimeout(fn, ms),
      events: {
        onUpdate: () => jitter(3),
        onPrompt: (prompt) => {
          if (++prompts > 20_000) return reject(new Error("duel did not finish"));
          void jitter(3).then(() => ctl.answer(autoRespond(prompt, Math.random, cards)));
        },
        onEnd: (winner) => { resolve({ winner, checksum: session.checksum(), prompts }); session.destroy(); },
        onError: (message) => reject(new Error(`P${me}: ${message}`)),
      },
    });
    ctl.start();
  }));
  return Promise.all(runs) as Promise<[Result, Result]>;
}

const n = Number(process.argv[2] ?? 3);
let failures = 0;
for (let i = 0; i < n; i++) {
  const seed = [BigInt(i + 1), 7n, 0n, 0n] as [bigint, bigint, bigint, bigint];
  try {
    const [a, b] = await play(seed);
    if (a.winner !== b.winner || a.checksum !== b.checksum) throw new Error(`machines disagree: ${JSON.stringify([a, b])}`);
    console.log(`p2p duel ${i + 1}: winner P${a.winner}, both machines agree (P0 answered ${a.prompts} prompts, P1 ${b.prompts})`);
  } catch (e) {
    failures++;
    console.error(`p2p duel ${i + 1} FAILED:`, e);
  }
}
if (failures) process.exit(1);
