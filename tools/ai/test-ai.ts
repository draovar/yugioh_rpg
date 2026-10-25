// Checks that the AI can't see hidden cards.
// 1. redact() cases built by hand: hidden draws, moves, sets, other players' prompts and private hints.
// 2. Real duels: every card an AI remembers seeing on the opponent's side must have been visible to it there at some
//    point (face-up on the field, in the GY/banished, or revealed), or public on its own side (a
//    stolen card), and redact() must not change its input.
// 3. The simulator's copies (sim/world.ts): every card a copy places on the opponent's side is a stand-in or one the
//    AI could see right then.
// 4. Move sequences in one copy (sim/sequence.ts) on a fixed board: what's offered, plans that can't work stop early,
//    attacks and the opponent's reply turn change the score as they should.
// Usage: npm run test-ai [-- <duels>]
import {
  OcgHintType,
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  SelectIdleCMDAction,
  type OcgMessage,
} from "ocgcore-wasm";
import { AiSeat } from "../../src/duel/ai/AiSeat.ts";
import { autoBotBrain } from "../../src/duel/ai/brains.ts";
import { redact } from "../../src/duel/ai/redact.ts";
import { BLANK, layoutFrom } from "../../src/duel/ai/sim/world.ts";
import { AiMemory } from "../../src/duel/ai/memory.ts";
import { Simulator } from "../../src/duel/ai/sim/simulator.ts";
import { describeStep, type PlanStep } from "../../src/duel/ai/sim/sequence.ts";
import type { FieldSnapshot } from "../../src/duel/engine/DuelSession.ts";
import { DECKS, type DeckName } from "../../src/duel/decks/decks.ts";
import { cards, core, newDuel, readScript, runDuel, seedFrom } from "../lib/engine.ts";

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) { failures++; console.error(`FAIL: ${what}`); }
};

// --- 1. redact() by hand (viewer = seat 0, opponent = seat 1) -------------------------------------------------
const DM = 46986414, BLUE_EYES = 89631139;
const FD = OcgPosition.FACEDOWN_DEFENSE, FU = OcgPosition.FACEUP_ATTACK;
const at = (controller: 0 | 1, location: number, position: number = FD) =>
  ({ controller, location, sequence: 0, position }) as const;
const one = (m: OcgMessage) => redact([m], 0)[0] as (OcgMessage & Record<string, unknown>) | undefined;
const code = (m: OcgMessage | undefined) => (m as { card?: number; code?: number } | undefined)?.card ?? (m as { code?: number } | undefined)?.code;

{
  const draw = { type: OcgMessageType.DRAW, player: 1, drawn: [{ code: DM, position: FD }] } as OcgMessage;
  const before = JSON.stringify(draw);
  check((one(draw) as { drawn: { code: number }[] }).drawn[0].code === 0, "opponent's draw is hidden");
  check(JSON.stringify(draw) === before, "redact does not mutate its input");
  const own = { type: OcgMessageType.DRAW, player: 0, drawn: [{ code: DM, position: FD }] } as OcgMessage;
  check((one(own) as { drawn: { code: number }[] }).drawn[0].code === DM, "own draw is visible");

  const move = (from: ReturnType<typeof at>, to: ReturnType<typeof at>) =>
    code(one({ type: OcgMessageType.MOVE, card: DM, from, to } as OcgMessage));
  check(move(at(1, OcgLocation.DECK), at(1, OcgLocation.HAND)) === 0, "opponent's search to hand is hidden");
  check(move(at(1, OcgLocation.HAND), at(1, OcgLocation.SZONE, FD)) === 0, "opponent's set card is hidden");
  check(move(at(1, OcgLocation.HAND), at(1, OcgLocation.GRAVE, FU)) === DM, "opponent's discard is visible");
  check(move(at(1, OcgLocation.MZONE, FU), at(1, OcgLocation.HAND)) === DM, "bounce of a face-up monster is visible");
  check(move(at(1, OcgLocation.MZONE, FD), at(1, OcgLocation.HAND)) === 0, "bounce of a face-down monster is hidden");
  check(move(at(0, OcgLocation.DECK), at(0, OcgLocation.HAND)) === DM, "own search is visible");
  check(move(at(0, OcgLocation.HAND), at(0, OcgLocation.DECK)) === DM, "own card returned to the deck is visible");
  check(move(at(0, OcgLocation.DECK), at(0, OcgLocation.DECK)) === 0, "own deck order stays hidden");

  const set = { type: OcgMessageType.SET, code: DM, controller: 1, location: OcgLocation.MZONE, sequence: 0, position: FD } as OcgMessage;
  check(code(one(set)) === 0, "opponent's SET is hidden");
  const shuffle = { type: OcgMessageType.SHUFFLE_HAND, player: 1, cards: [DM, BLUE_EYES] } as OcgMessage;
  check((one(shuffle) as { cards: number[] }).cards.every((c) => c === 0), "opponent's hand shuffle is hidden");
  const confirmDeck = { type: OcgMessageType.CONFIRM_CARDS, player: 1, cards: [{ code: DM, controller: 1, location: OcgLocation.DECK, sequence: 0 }] } as OcgMessage;
  check((one(confirmDeck) as { cards: { code: number }[] }).cards[0].code === 0, "deck card confirmed to the opponent is hidden");
  const confirmHand = { type: OcgMessageType.CONFIRM_CARDS, player: 1, cards: [{ code: DM, controller: 1, location: OcgLocation.HAND, sequence: 0 }] } as OcgMessage;
  check((one(confirmHand) as { cards: { code: number }[] }).cards[0].code === DM, "revealed hand card is visible");

  const prompt = { type: OcgMessageType.SELECT_CARD, player: 1, can_cancel: false, min: 1, max: 1, selects: [] } as OcgMessage;
  check(one(prompt) === undefined, "the opponent's prompt is dropped");
  const hint = (hint_type: number, player: number) => one({ type: OcgMessageType.HINT, hint_type, player, hint: 0n } as OcgMessage);
  check(hint(OcgHintType.SELECTMSG, 1) === undefined, "the opponent's select hint is dropped");
  check(hint(OcgHintType.SELECTMSG, 0) !== undefined, "own select hint is kept");
  check(hint(OcgHintType.OPSELECTED, 1) !== undefined, "the opponent's announced choice is kept");
  check(hint(OcgHintType.OPSELECTED, 0) === undefined, "own announced choice (meant for the opponent) is dropped");
}

// --- 2. Real duels ------------------------------------------------------------------------------------------
/** Codes of the cards a viewer's snapshot shows on `side` (hidden ones are already 0). */
function shown(snap: FieldSnapshot, side: 0 | 1): number[] {
  const p = snap.players[side];
  return [...p.hand, ...p.monsters, ...p.spells, ...p.grave, ...p.banished, ...p.extra].map((c) => c?.code ?? 0).filter((c) => c);
}

const runs = Number(process.argv[2] ?? 30);
const names = Object.keys(DECKS) as DeckName[];
for (let i = 0; i < runs; i++) {
  const [d0, d1] = [names[i % names.length], names[Math.floor(i / names.length) % names.length]];
  const duel = newDuel({ decks: [DECKS[d0].deck, DECKS[d1].deck], seed: seedFrom(1000 + i), onCoreLog: () => {} });
  const seats = [new AiSeat({ seat: 0, brain: autoBotBrain, duel }), new AiSeat({ seat: 1, brain: autoBotBrain, duel })] as const;
  // public[viewer][side]: every code `viewer` could legitimately have seen on `side`.
  const pub = [[new Set<number>(), new Set<number>()], [new Set<number>(), new Set<number>()]];
  const record = () => {
    for (const v of [0, 1] as const) {
      const snap = duel.snapshot(v);
      for (const s of [0, 1] as const) for (const c of shown(snap, s)) pub[v][s].add(c);
    }
  };
  try {
    record();
    runDuel(duel, seats, (step) => {
      const before = JSON.stringify(step.messages, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
      for (const m of step.messages) {
        // Revealed cards: deck-top reveals (Cyber Jar) to both, other confirms to both unless they're in a Deck.
        if (m.type === OcgMessageType.CONFIRM_DECKTOP)
          for (const c of m.cards) for (const v of [0, 1] as const) pub[v][c.controller].add(c.code);
        if (m.type !== OcgMessageType.CONFIRM_CARDS) continue;
        for (const c of m.cards) for (const v of [0, 1] as const)
          if (c.location !== OcgLocation.DECK || v === m.player) pub[v][c.controller].add(c.code);
      }
      for (const v of [0, 1] as const) redact(step.messages, v);
      // 3. A copy laid out from what this seat sees right now places nothing of theirs it can't see.
      for (const v of [0, 1] as const) {
        const view = { seat: v, board: duel.snapshot(v), memory: seats[v].memory, cards, hint: null, rng: Math.random, deckList: DECKS[v ? d1 : d0].deck.main };
        const visible = new Set(shown(view.board, (1 - v) as 0 | 1));
        const blanks = new Set<number>(Object.values(BLANK));
        const theirSide = layoutFrom(view).decks[1];
        for (const c of [...theirSide.main, ...(theirSide.extra ?? []), ...(theirSide.start ?? []).map((s) => s.code)])
          check(blanks.has(c) || visible.has(c), `duel ${i}: P${v}'s copy places P${1 - v}'s ${cards.name(c)}, which it can't see`);
      }
      check(JSON.stringify(step.messages, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) === before, `duel ${i}: redact mutated messages`);
      record();
    });
    record();
    for (const v of [0, 1] as const) {
      const opp = (1 - v) as 0 | 1;
      for (const c of seats[v].memory.seen[opp])
        check(pub[v][opp].has(c) || pub[opp][v].has(c), `duel ${i} (${d0} vs ${d1}): P${v} knows P${opp}'s ${cards.name(c)} without it ever being public`);
    }
  } catch (e) {
    failures++;
    console.error(`duel ${i} FAILED:`, e);
  } finally {
    duel.destroy();
  }
}

// --- 4. Move sequences -----------------------------------------------------------------------------------------
{
  const C = { lordOfD: 17985575, darkHole: 53129443, jinzo: 77585513, dmg: 38033121, elf: 15025844, sangan: 26202165 };
  // The AI (seat 0): Dark Hole and Jinzo in hand, Lord of D. on the field. Opponent: Dark Magician Girl, a set monster.
  const duel = newDuel({ decks: [
    { main: Array<number>(20).fill(C.elf), start: [{ code: C.darkHole, location: OcgLocation.HAND }, { code: C.jinzo, location: OcgLocation.HAND }, { code: C.lordOfD, location: OcgLocation.MZONE, sequence: 0 }] },
    { main: Array<number>(20).fill(C.elf), start: [{ code: C.dmg, location: OcgLocation.MZONE, sequence: 1 }, { code: C.sangan, location: OcgLocation.MZONE, sequence: 2, position: OcgPosition.FACEDOWN_DEFENSE }] },
  ], seed: seedFrom(3), draws: { opening: 0, perTurn: 0 }, onCoreLog: () => {} });
  duel.advance();
  const view = { seat: 0 as const, board: duel.snapshot(0), memory: new AiMemory(0), cards, hint: null, rng: () => 0.5, deckList: Array<number>(20).fill(C.elf) };
  const sim = new Simulator({ core, cards, readScript });
  const start = sim.sequence(view, []);
  const offered = (start?.next ?? []).map((s) => describeStep(s, cards));
  check(offered.includes("activate Dark Hole") && offered.includes("summon Jinzo"), `sequence: offered at the start: ${offered.join(" | ")}`);
  const find = (action: SelectIdleCMDAction) => start!.next.find((s) => s.kind === "idle" && s.action === action)!;
  const darkHole = find(SelectIdleCMDAction.SELECT_ACTIVATE), jinzo = find(SelectIdleCMDAction.SELECT_SUMMON);
  const toBattle: PlanStep = { kind: "idle", action: SelectIdleCMDAction.TO_BP };
  const jinzoAttacks: PlanStep = { kind: "attack", attacker: { code: C.jinzo, location: OcgLocation.MZONE, sequence: 0, controller: 0 }, target: 1 };
  check(sim.sequence(view, [darkHole, jinzo])?.done === 1, "sequence: no Jinzo after Dark Hole destroyed its tribute");
  check(sim.sequence(view, [jinzo, darkHole])?.done === 2, "sequence: Jinzo, then Dark Hole");
  const attack = sim.sequence(view, [jinzo, toBattle, jinzoAttacks]);
  check(attack?.done === 3 && attack.value > start!.value, `sequence: Jinzo attacking Dark Magician Girl gains (${attack?.value} vs ${start?.value})`);
  const theirTurn = sim.sequence(view, [], { opponentTurn: true });
  check(theirTurn !== null && theirTurn.value < start!.value, `sequence: doing nothing loses Lord of D. in their turn (${theirTurn?.value} vs ${start?.value})`);
  sim.dispose();
  duel.destroy();
}

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log(`test-ai: all checks passed (${runs} duels)`);
