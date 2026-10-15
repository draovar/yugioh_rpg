// Fits the evaluation's weights (board.ts `Weights`) to who actually won: "Texel tuning". Input: positions recorded by
// `npm run arena -- --record FILE` (each turn's starting board as the turn player saw it, and whether they won). The
// model: P(win) = 1 / (1 + e^-(evaluate(position) / scale + bias)); the fit finds the weights and the scale (cards → win
// chance, the planner's `worldScale`) that predict the results best. Monster values are the unit and stay fixed
// (monsterBase, atkDivisor); everything else in `evaluate` is fitted.
//
// How: evaluate() is nearly linear in its weights, so around the current weights each position becomes a feature
// vector (its value's slope per weight) and the fit is a logistic regression (Newton steps), relinearised a few times
// for the nonlinear weights (lpHalf, defFactor...). Error bars: the same fit on duels drawn with replacement
// (bootstrap). 20% of the duels are held out to check that the fitted weights predict better than the current ones.
//
// Usage: node tools/fit-eval.ts FILE.jsonl [FILE2.jsonl ...] [--boot 20] [--out weights.json] [--max N] [--fix w1,w2]
//        [--set w1=v1,w2=v2]
import { readFileSync, writeFileSync } from "node:fs";
import type { AiView } from "../src/duel/ai/AiSeat.ts";
import { DEFAULT_WEIGHTS, evaluate, type Weights } from "../src/duel/ai/board.ts";
import { AiMemory } from "../src/duel/ai/memory.ts";
import type { FieldSnapshot } from "../src/duel/DuelSession.ts";
import { mulberry32 } from "../src/duel/rng.ts";
import { cards } from "./lib/engine.ts";

const argv = process.argv.slice(2);
const opt = (name: string) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
/** Weights set by hand for this fit and held there (`--set lpHalf=4000`; they're not fitted). */
const set = Object.fromEntries((opt("set") ?? "").split(",").filter(Boolean).map((kv) => [kv.split("=")[0], Number(kv.split("=")[1])])) as Partial<Weights>;
/** Weights held at their current (or `--set`) values (`--fix lpScale,lpHalf`). */
const fixed = new Set([...(opt("fix") ?? "").split(",").filter(Boolean), ...Object.keys(set)]);
const START: Weights = { ...DEFAULT_WEIGHTS, ...set };

/** The weights evaluate() uses, minus the unit (monster values), those it never reads, and `--fix`ed ones. */
const FITTED = ([
  "lpScale", "lpHalf", "defFactor", "hiddenMonster", "token", "setCard", "setTrap", "setTrapStep", "hiddenSetCard",
  "continuous", "equip", "faceUpSpell", "handUnknown", "handSpell", "handTrap", "handMonsterBase", "handMonsterFactor",
  "stuckMonster", "stuckMonster2", "deckLowPenalty",
] as const satisfies readonly (keyof Weights)[]).filter((k) => !fixed.has(k));
const files = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
const boots = Number(opt("boot") ?? 20);
const max = Number(opt("max") ?? Infinity);

interface Pos { duel: string; won: number; view: AiView & { weights: Weights } }
const positions: Pos[] = [];
for (const [f, file] of files.entries()) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line || positions.length >= max) continue;
    const p = JSON.parse(line) as { duel: number; seat: 0 | 1; board: FieldSnapshot; won: boolean };
    positions.push({
      duel: `${f}:${p.duel}`, won: p.won ? 1 : 0,
      view: { seat: p.seat, board: p.board, memory: new AiMemory(p.seat), cards, hint: null, rng: () => 0.5, deckList: null, weights: { ...DEFAULT_WEIGHTS } },
    });
  }
}
const duels = [...new Set(positions.map((p) => p.duel))];
console.log(`${positions.length} positions from ${duels.length} duels`);

const valueWith = (p: Pos, w: Weights) => { p.view.weights = w; return Math.max(-50, Math.min(50, evaluate(p.view))); };

/** Each position as features around `w`: [the value at w minus the fitted part (linearised), slope per fitted weight]. */
function linearise(w: Weights): { base: number[]; slope: number[][] } {
  const base = positions.map((p) => valueWith(p, w));
  const slope = positions.map(() => Array<number>(FITTED.length).fill(0));
  FITTED.forEach((k, j) => {
    const h = 1e-3 * Math.max(1, Math.abs(w[k]));
    const up = { ...w, [k]: w[k] + h }, down = { ...w, [k]: w[k] - h };
    positions.forEach((p, i) => { slope[i][j] = (valueWith(p, up) - valueWith(p, down)) / (2 * h); });
  });
  // value(w') ≈ base + slope·(w' − w) = (base − slope·w) + slope·w'
  return { base: base.map((b, i) => b - slope[i].reduce((s, d, j) => s + d * w[FITTED[j]], 0)), slope };
}

/**
 * Logistic regression on rows x = [1, rest, slope...] with Newton steps: logit = c0 + c1·rest + Σ cj·slope_j. Then
 * scale = 1 / c1 (cards per logit unit) and weight_j = cj / c1. A small ridge keeps rare features (tokens) in check.
 */
function logistic(rows: number[][], ys: number[], sample: number[]): number[] {
  const n = rows[0].length;
  let c = Array<number>(n).fill(0);
  c[1] = 1 / 3;
  for (let it = 0; it < 25; it++) {
    const g = Array<number>(n).fill(0);
    const H = Array.from({ length: n }, () => Array<number>(n).fill(0));
    for (const i of sample) {
      const x = rows[i];
      let z = 0;
      for (let a = 0; a < n; a++) z += c[a] * x[a];
      const p = 1 / (1 + Math.exp(-z));
      const r = p - ys[i], v = p * (1 - p);
      for (let a = 0; a < n; a++) {
        g[a] += r * x[a];
        for (let b = 0; b <= a; b++) H[a][b] += v * x[a] * x[b];
      }
    }
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < a; b++) H[b][a] = H[a][b];
      H[a][a] += 1e-3 * sample.length * 1e-3;
      g[a] += 1e-3 * sample.length * 1e-3 * c[a];
    }
    const step = solve(H, g);
    c = c.map((v, a) => v - step[a]);
    if (Math.max(...step.map(Math.abs)) < 1e-7) break;
  }
  return c;
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) if (r !== col) {
      const f = M[r][col] / M[col][col];
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Mean log loss and accuracy of weights `w` with scale/bias on positions `idx` (the real evaluate, not the linear one). */
function score(w: Weights, scale: number, bias: number, idx: number[]): { loss: number; acc: number } {
  let loss = 0, right = 0;
  for (const i of idx) {
    const p = positions[i];
    const q = 1 / (1 + Math.exp(-(valueWith(p, w) / scale + bias)));
    loss -= p.won ? Math.log(Math.max(q, 1e-12)) : Math.log(Math.max(1 - q, 1e-12));
    if ((q > 0.5) === (p.won === 1)) right++;
  }
  return { loss: loss / idx.length, acc: right / idx.length };
}

/** Fits on the positions in `sample`, starting from `w`; `rounds` relinearisations. */
function fit(w0: Weights, sample: number[], rounds: number) {
  let w = { ...w0 }, scale = 3, bias = 0;
  for (let round = 0; round < rounds; round++) {
    const { base, slope } = linearise(w);
    const rows = positions.map((_p, i) => [1, base[i], ...slope[i]]);
    const c = logistic(rows, positions.map((p) => p.won), sample);
    scale = 1 / c[1];
    bias = c[0];
    const next = { ...w };
    FITTED.forEach((k, j) => { next[k] = c[2 + j] / c[1]; });
    // Keep the nonlinear ones in a sane range (a relinearisation step can overshoot).
    next.lpHalf = Math.min(20000, Math.max(300, next.lpHalf));
    next.defFactor = Math.min(1.5, Math.max(0, next.defFactor));
    w = next;
  }
  return { w, scale, bias };
}

// Train / test split by duel.
const rng = mulberry32(12345);
const testDuels = new Set(duels.filter(() => rng() < 0.2));
const train = positions.map((_p, i) => i).filter((i) => !testDuels.has(positions[i].duel));
const test = positions.map((_p, i) => i).filter((i) => testDuels.has(positions[i].duel));

// The current weights' best scale/bias (only those two fitted), for a fair comparison.
const current = (() => {
  const base = positions.map((p) => valueWith(p, { ...DEFAULT_WEIGHTS }));
  const c = logistic(positions.map((_p, i) => [1, base[i]]), positions.map((p) => p.won), train);
  return { scale: 1 / c[1], bias: c[0] };
})();
const fitted = fit(START, train, 3);
const before = score({ ...DEFAULT_WEIGHTS }, current.scale, current.bias, test);
const after = score(fitted.w, fitted.scale, fitted.bias, test);
console.log(`held-out duels (${test.length} positions): current weights loss ${before.loss.toFixed(4)} acc ${(100 * before.acc).toFixed(1)}% ` +
  `(scale ${current.scale.toFixed(2)}), fitted loss ${after.loss.toFixed(4)} acc ${(100 * after.acc).toFixed(1)}% ` +
  `(scale ${fitted.scale.toFixed(2)}, bias ${fitted.bias.toFixed(2)} for the player on turn)`);

// Bootstrap over duels (one relinearisation from the fitted point: cheap, and near the optimum the linear model holds).
const all = positions.map((_p, i) => i);
const byDuel = new Map<string, number[]>();
for (const i of all) byDuel.set(positions[i].duel, [...(byDuel.get(positions[i].duel) ?? []), i]);
const samples: Record<string, number[]> = Object.fromEntries([...FITTED, "scale"].map((k) => [k, []]));
const full = fit(fitted.w, all, 1);
if (boots > 0) {
  const { base, slope } = linearise(full.w);
  const rows = positions.map((_p, i) => [1, base[i], ...slope[i]]);
  const ys = positions.map((p) => p.won);
  for (let b = 0; b < boots; b++) {
    const sample = Array.from({ length: duels.length }, () => byDuel.get(duels[Math.floor(rng() * duels.length)])!).flat();
    const c = logistic(rows, ys, sample);
    FITTED.forEach((k, j) => samples[k].push(c[2 + j] / c[1]));
    samples.scale.push(1 / c[1]);
  }
}
const sd = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
};
console.log(`\nall duels: scale ${full.scale.toFixed(2)} ± ${sd(samples.scale).toFixed(2)} cards per logit unit, bias ${full.bias.toFixed(2)}`);
console.log("weight              current     fitted   ± (bootstrap sd)");
for (const k of FITTED) {
  const s = samples[k].length ? sd(samples[k]) : NaN;
  console.log(`${k.padEnd(18)} ${String(DEFAULT_WEIGHTS[k]).padStart(8)} ${full.w[k].toFixed(3).padStart(10)}   ± ${s.toFixed(3)}`);
}
if (opt("out")) {
  writeFileSync(opt("out")!, JSON.stringify({ ...set, ...Object.fromEntries([...FITTED.map((k) => [k, Number(full.w[k].toFixed(3))]), ["worldScale", Number(full.scale.toFixed(2))]]) }, null, 2));
  console.log(`wrote ${opt("out")}`);
}
