// Engine check of the whole card pool: bot vs bot duels with random decks, so every card gets into a deck and,
// over enough duels, gets played. Each pass shuffles the pool (seeded) and deals it out: Main Decks of 20 different
// cards x2, Extra Decks of 15 Fusions. Fails on a crash, RETRY, a duel that never ends, an engine hang (no answer
// within --timeout seconds; the worker is killed) or an [ocgcore] script error, naming the cards that acted last
// (the likely culprits). Ends with how many pool cards were summoned / activated. Duels run on all CPU cores.
// Usage: npm run smoke-random -- [--passes N] [--seed S] [--duel K] [--jobs N] [--timeout SEC] [--quiet] [--unplayed FILE]
//   --duel K          replays only duel K of that seed (same decks), printing every card that acted
//   --unplayed FILE   writes the pool cards that never acted (name, kind) to FILE
// Needs `npm run build-data` first.
import { writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { OcgMessageType } from "ocgcore-wasm";
import { AiSeat } from "../../src/duel/ai/AiSeat.ts";
import { autoBotBrain } from "../../src/duel/ai/brains.ts";
import { TYPE } from "../../src/duel/engine/cardData.ts";
import type { Deck } from "../../src/duel/engine/DuelSession.ts";
import { cards, newDuel, runDuel, seedFrom } from "../lib/engine.ts";

/** Worker → main: a card acted in duel k, or duel k is over. */
type FromWorker =
  | { kind: "acted"; k: number; code: number }
  | { kind: "done"; k: number; line: string; error: string | null; warnings: string[] };

/** [ocgcore] errors we know and accept (text to match → why): reported, but they don't fail the run. */
const KNOWN_ERRORS: Record<string, string> = {
  "c13599884.lua": "Steel Scorpion copied by Phantom of Chaos: its global End Phase check reads the copy's deleted effects; the check just fails",
};

const ACTED = [OcgMessageType.SUMMONING, OcgMessageType.SPSUMMONING, OcgMessageType.FLIPSUMMONING, OcgMessageType.CHAINING];

/** Plays duel k (decks 2k-2 and 2k-1), reporting every card that acts. */
function playDuel(k: number, decks: Deck[], seed: number, verbose: boolean, post: (m: FromWorker) => void) {
  const warnings: string[] = [];
  const duel = newDuel({ decks: [decks[2 * k - 2], decks[2 * k - 1]], seed: seedFrom(seed * 100_000 + k), onCoreLog: (_t, text) => warnings.push(text) });
  const seats = [new AiSeat({ seat: 0, brain: autoBotBrain, duel }), new AiSeat({ seat: 1, brain: autoBotBrain, duel })] as const;
  let line = "", error: string | null = null;
  try {
    const run = runDuel(duel, seats, (step) => {
      for (const m of step.messages) {
        if (!ACTED.includes(m.type)) continue;
        const code = (m as { code: number }).code;
        post({ kind: "acted", k, code });
        if (verbose) console.log(`  ${OcgMessageType[m.type].toLowerCase()} ${cards.name(code)} (${code})`);
      }
    });
    line = `duel ${k}: winner P${run.winner}, ${run.turns} turns, ${run.decisions[0] + run.decisions[1]} decisions`;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    duel.destroy();
  }
  post({ kind: "done", k, line, error, warnings: [...new Set(warnings)] });
}

if (!isMainThread) {
  const { decks, seed, verbose } = workerData as { decks: Deck[]; seed: number; verbose: boolean };
  parentPort!.on("message", (k: number) => playDuel(k, decks, seed, verbose, (m) => parentPort!.postMessage(m)));
} else {
  await main();
}

async function main() {
  const arg = (name: string, def: number) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? Number(process.argv[i + 1]) : def;
  };
  const passes = arg("passes", 1);
  const seed = arg("seed", 1);
  const only = arg("duel", 0);
  const jobs = arg("jobs", availableParallelism());
  const timeoutMs = arg("timeout", 60) * 1000;
  const quiet = process.argv.includes("--quiet");
  const unplayedFile = process.argv.includes("--unplayed") ? process.argv[process.argv.indexOf("--unplayed") + 1] : null;

  const MAIN_CARDS = 20, COPIES = 2, EXTRA_CARDS = 15;
  const pool = [...cards.records.values()].filter((r) => !(r.type & TYPE.TOKEN));
  const mainPool = pool.filter((r) => !(r.type & TYPE.FUSION)).map((r) => r.code);
  const extraPool = pool.filter((r) => r.type & TYPE.FUSION).map((r) => r.code);

  function rng(s: number) {
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const shuffled = (list: number[], rand: () => number) => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  /** Every pass: the shuffled pool dealt into decks, two per duel (the last deck topped up from the start). */
  function dealDecks(): Deck[] {
    const rand = rng(seed);
    const decks: Deck[] = [];
    for (let p = 0; p < passes; p++) {
      const main = shuffled(mainPool, rand), extra = shuffled(extraPool, rand);
      const n = Math.ceil(main.length / MAIN_CARDS / 2) * 2;
      for (let d = 0; d < n; d++) {
        const picks = Array.from({ length: MAIN_CARDS }, (_, i) => main[(d * MAIN_CARDS + i) % main.length]);
        const fusions = Array.from({ length: EXTRA_CARDS }, (_, i) => extra[(d * EXTRA_CARDS + i) % extra.length]);
        decks.push({ main: picks.flatMap((c) => Array(COPIES).fill(c)), extra: fusions });
      }
    }
    return decks;
  }

  const decks = dealDecks();
  const duels = decks.length / 2;
  const queue = only ? [only] : Array.from({ length: duels }, (_, i) => i + 1);
  const used = new Set<number>();
  const failures: { duel: number; error: string; recent: number[] }[] = [];
  const scriptErrors = new Map<string, number>(); // warning text -> first duel
  const knownSeen = new Set<string>();
  const recent = new Map<number, number[]>(); // duel -> last cards to act
  const started = performance.now();
  const names = (codes: number[]) => codes.map((c) => `${cards.name(c)} (${c})`).join(", ");

  function fail(k: number, error: string) {
    const last = recent.get(k) ?? [];
    failures.push({ duel: k, error, recent: last });
    console.error(`duel ${k} FAILED: ${error}\n  last cards to act: ${names(last)}`);
  }

  // Each worker plays one duel at a time; one that doesn't answer in time is killed and replaced.
  await new Promise<void>((resolve) => {
    let running = 0;
    const startWorker = () => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { decks, seed, verbose: !!only } });
      let current = 0, timer: NodeJS.Timeout | undefined;
      running++;
      const next = () => {
        clearTimeout(timer);
        current = queue.shift() ?? 0;
        if (!current) { running--; void worker.terminate(); if (!running) resolve(); return; }
        recent.set(current, []);
        timer = setTimeout(() => {
          fail(current, `no answer from the engine in ${timeoutMs / 1000} s (hang)`);
          worker.removeAllListeners();
          void worker.terminate();
          running--;
          if (queue.length) startWorker(); else if (!running) resolve();
        }, timeoutMs);
        worker.postMessage(current);
      };
      worker.on("message", (m: FromWorker) => {
        if (m.kind === "acted") {
          used.add(m.code);
          const last = recent.get(m.k)!;
          last.push(m.code);
          if (last.length > 6) last.shift();
          return;
        }
        if (m.error) fail(m.k, m.error);
        else if (!quiet || only) console.log(m.line);
        for (const w of m.warnings) {
          const known = Object.keys(KNOWN_ERRORS).find((t) => w.includes(t));
          if (known) { knownSeen.add(known); continue; }
          if (!scriptErrors.has(w)) scriptErrors.set(w, m.k);
          const last = recent.get(m.k)!;
          console.warn(`  duel ${m.k} [ocgcore] ${w}${last.length ? `\n    last cards to act: ${last.map((c) => cards.name(c)).join(", ")}` : ""}`);
        }
        recent.delete(m.k);
        next();
      });
      worker.on("error", (e: Error) => {
        clearTimeout(timer);
        fail(current, `worker crashed: ${e.message}`);
        running--;
        if (queue.length) startWorker(); else if (!running) resolve();
      });
      next();
    };
    for (let i = 0; i < Math.min(jobs, queue.length); i++) startWorker();
  });

  const inDecks = new Set(decks.flatMap((d) => [...d.main, ...(d.extra ?? [])]));
  const played = pool.filter((r) => used.has(r.code)).length;
  console.log(`\n${only ? 1 : duels} duels (seed ${seed}, ${passes} pass${passes > 1 ? "es" : ""}) in ${((performance.now() - started) / 1000).toFixed(0)} s: ` +
    `${failures.length} failed, ${scriptErrors.size} different script errors; ${inDecks.size} of ${pool.length} pool cards in a deck, ` +
    `${played} summoned or activated (${((100 * played) / pool.length).toFixed(0)}%)`);
  for (const t of knownSeen) console.log(`known script error (ignored): ${t}: ${KNOWN_ERRORS[t]}`);
  /** A rough kind, to see which sorts of cards the bots never get to play. */
  const kind = (t: number) => t & TYPE.FUSION ? "fusion" : t & TYPE.RITUAL ? (t & TYPE.MONSTER ? "ritual monster" : "ritual spell")
    : t & TYPE.MONSTER ? (t & TYPE.EFFECT ? "effect monster" : "normal monster") : t & TYPE.SPELL ? "spell" : "trap";
  const unplayed = pool.filter((r) => !used.has(r.code));
  const byKind = new Map<string, number>();
  for (const r of unplayed) byKind.set(kind(r.type), (byKind.get(kind(r.type)) ?? 0) + 1);
  console.log(`never acted: ${[...byKind].map(([k, n]) => `${k} ${n}`).join(", ")}`);
  if (unplayedFile) writeFileSync(unplayedFile, unplayed.map((r) => `${r.name}\t${kind(r.type)}`).sort().join("\n") + "\n");
  failures.sort((a, b) => a.duel - b.duel);
  if (failures.length) console.log(`replay one: npm run smoke-random -- --seed ${seed} --passes ${passes} --duel ${failures[0].duel}`);
  if (failures.length || scriptErrors.size) process.exit(1);
}
