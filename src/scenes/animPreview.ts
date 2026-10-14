// Dev-only animation preview for the duel scene: open the duel with `&anims` and pick an animation
// from the dropdown (top-left of the page). It replays with fake engine messages, then the board
// snaps back to the real game state. Used to review and tune each animation in isolation.
import Phaser from "phaser";
import { OcgLocation, OcgMessageType, OcgPosition, type OcgMessage } from "ocgcore-wasm";
import { REASON, type FieldSnapshot } from "../duel/DuelSession.ts";
import type { DuelAnimator } from "../ui/duel/DuelAnimator.ts";
import { swapSeats } from "./previewSeats.ts";

/** What the preview needs from the duel scene. */
export interface PreviewHost {
  readonly scene: Phaser.Scene;
  readonly animator: Pick<DuelAnimator, "play">;
  /** Your seat (the previews below are written for seat 0). */
  me(): 0 | 1;
  /** The real board as last reported by the engine. */
  snapshot(): FieldSnapshot | null;
  renderBoard(snap: FieldSnapshot): void;
}

interface Preview {
  label: string;
  run(host: PreviewHost, snap: FieldSnapshot): Promise<void>;
}

const pause = (host: PreviewHost, ms: number) => new Promise((r) => host.scene.time.delayedCall(ms, r));

const PREVIEWS: Preview[] = [
  {
    label: "#1 Draw: opening hand",
    async run(host, snap) {
      // Start from an empty hand with those cards back in the deck, then deal them.
      const me = snap.players[0];
      host.renderBoard({ players: [{ ...me, hand: [], deckCount: me.deckCount + me.hand.length }, snap.players[1]] });
      await host.animator.play([drawMsg(me.hand.slice(0, 5).map((c) => c.code))]);
    },
  },
  {
    label: "#1 Draw: draw 2",
    async run(host, snap) {
      // Re-draw two cards of the current hand on top of it (stand-ins for e.g. Pot of Greed's draw).
      await host.animator.play([drawMsg(snap.players[0].hand.slice(0, 2).map((c) => c.code))]);
    },
  },
  {
    label: "#2 Move: summon (hand to monster zone)",
    async run(host, snap) {
      await host.animator.play([moveMsg(snap.players[0].hand[0].code, hand(0), zone(OcgLocation.MZONE, 2, OcgPosition.FACEUP_ATTACK))]);
    },
  },
  {
    label: "#2 Move: set monster",
    async run(host, snap) {
      await host.animator.play([moveMsg(snap.players[0].hand[0].code, hand(0), zone(OcgLocation.MZONE, 2, OcgPosition.FACEDOWN_DEFENSE))]);
    },
  },
  {
    label: "#2 Move: set Spell/Trap",
    async run(host, snap) {
      const i = Math.min(4, snap.players[0].hand.length - 1);
      await host.animator.play([moveMsg(snap.players[0].hand[i].code, hand(i), zone(OcgLocation.SZONE, 2, OcgPosition.FACEDOWN_DEFENSE))]);
    },
  },
  {
    label: "#3 Destroy: monster destroyed",
    async run(host, snap) {
      const code = snap.players[0].hand[0].code;
      const field = zone(OcgLocation.MZONE, 2, OcgPosition.FACEUP_ATTACK);
      await host.animator.play([moveMsg(code, hand(0), field)]);
      await pause(host, 400);
      await host.animator.play([moveMsg(code, field, zone(OcgLocation.GRAVE, 0, OcgPosition.FACEUP_ATTACK), REASON.DESTROY)]);
    },
  },
  {
    label: "#3 Destroy: to GY, not destroyed (compare)",
    async run(host, snap) {
      // e.g. a Spell that resolved: goes to the GY by rule, no destroy flash.
      const code = snap.players[0].hand[0].code;
      const field = zone(OcgLocation.MZONE, 2, OcgPosition.FACEUP_ATTACK);
      await host.animator.play([moveMsg(code, hand(0), field)]);
      await pause(host, 400);
      await host.animator.play([moveMsg(code, field, zone(OcgLocation.GRAVE, 0, OcgPosition.FACEUP_ATTACK), 0)]);
    },
  },
  {
    label: "#4 Summon: Normal Summon",
    async run(host, snap) {
      const code = snap.players[0].hand[0].code;
      const field = zone(OcgLocation.MZONE, 2, OcgPosition.FACEUP_ATTACK);
      await host.animator.play([moveMsg(code, hand(0), field), cardMsg(OcgMessageType.SUMMONING, code, field)]);
    },
  },
  {
    label: "#4 Summon: Special Summon",
    async run(host, snap) {
      const code = snap.players[0].hand[0].code;
      const field = zone(OcgLocation.MZONE, 2, OcgPosition.FACEUP_ATTACK);
      await host.animator.play([moveMsg(code, hand(0), field), cardMsg(OcgMessageType.SPSUMMONING, code, field)]);
    },
  },
  {
    label: "#4 Summon: Flip Summon (from a set monster)",
    async run(host, snap) {
      const code = snap.players[0].hand[0].code;
      const set = zone(OcgLocation.MZONE, 2, OcgPosition.FACEDOWN_DEFENSE);
      const up = zone(OcgLocation.MZONE, 2, OcgPosition.FACEUP_ATTACK);
      await host.animator.play([moveMsg(code, hand(0), set)]);
      await pause(host, 500);
      await host.animator.play([
        { type: OcgMessageType.POS_CHANGE, code, controller: 0, location: OcgLocation.MZONE, sequence: 2, prev_position: OcgPosition.FACEDOWN_DEFENSE, position: OcgPosition.FACEUP_ATTACK } as OcgMessage,
        cardMsg(OcgMessageType.FLIPSUMMONING, code, up),
      ]);
    },
  },
  posPreview("#5 Position: attack to defense", OcgPosition.FACEUP_ATTACK, OcgPosition.FACEUP_DEFENSE),
  posPreview("#5 Position: defense to attack", OcgPosition.FACEUP_DEFENSE, OcgPosition.FACEUP_ATTACK),
  posPreview("#5 Position: set monster flipped face-up (attacked)", OcgPosition.FACEDOWN_DEFENSE, OcgPosition.FACEUP_DEFENSE),
  posPreview("#5 Position: turned face-down (Book of Moon)", OcgPosition.FACEUP_ATTACK, OcgPosition.FACEDOWN_DEFENSE),
  {
    label: "#6 Activation: Spell from hand",
    async run(host, snap) {
      const i = snap.players[0].hand.length - 1;
      const code = snap.players[0].hand[i].code;
      const st = zone(OcgLocation.SZONE, 2, OcgPosition.FACEUP_ATTACK);
      await host.animator.play([moveMsg(code, hand(i), st), chainMsg(code, st)]);
    },
  },
  {
    label: "#6 Activation: set Trap",
    async run(host, snap) {
      const i = Math.min(4, snap.players[0].hand.length - 1);
      const code = snap.players[0].hand[i].code;
      await host.animator.play([moveMsg(code, hand(i), zone(OcgLocation.SZONE, 2, OcgPosition.FACEDOWN_DEFENSE))]);
      await pause(host, 500);
      // As in a real duel: the set card is turned face-up (POS_CHANGE), then activates.
      await host.animator.play([
        { type: OcgMessageType.POS_CHANGE, code, controller: 0, location: OcgLocation.SZONE, sequence: 2, prev_position: OcgPosition.FACEDOWN_DEFENSE, position: OcgPosition.FACEUP_ATTACK } as OcgMessage,
        chainMsg(code, zone(OcgLocation.SZONE, 2, OcgPosition.FACEUP_ATTACK)),
      ]);
    },
  },
  {
    label: "#6 Activation: monster effect on the field",
    async run(host, snap) {
      const code = snap.players[0].hand[0].code;
      const field = zone(OcgLocation.MZONE, 2, OcgPosition.FACEUP_ATTACK);
      await host.animator.play([moveMsg(code, hand(0), field)]);
      await pause(host, 400);
      await host.animator.play([chainMsg(code, field)]);
    },
  },
  {
    label: "#6 Activation: effect in the Graveyard",
    async run(host, snap) {
      const code = snap.players[0].hand[0].code;
      const field = zone(OcgLocation.MZONE, 2, OcgPosition.FACEUP_ATTACK);
      const gy = zone(OcgLocation.GRAVE, 0, OcgPosition.FACEUP_ATTACK);
      await host.animator.play([moveMsg(code, hand(0), field)]);
      await pause(host, 400);
      await host.animator.play([moveMsg(code, field, gy, REASON.DESTROY), chainMsg(code, gy)]);
    },
  },
  attackPreview("#7 Attack: you attack a monster", "mine", true),
  attackPreview("#7 Attack: direct attack", "mine", false),
  attackPreview("#7 Attack: opponent attacks you", "theirs", true),
  attackPreview("#7 Attack: attack stopped (attacker destroyed)", "mine", true, true),
  damagePreview("#8 Damage: opponent takes 1500", 1, 1500),
  damagePreview("#8 Damage: you take 450", 0, 450),
  damagePreview("#8 Damage: lethal (opponent to 0)", 1, 8000),
  lpPreview("#9 LP: you gain 1000 (recover)", { type: OcgMessageType.RECOVER, player: 0, amount: 1000 }),
  lpPreview("#9 LP: you pay 1000 (cost)", { type: OcgMessageType.PAY_LPCOST, player: 0, amount: 1000 }),
  lpPreview("#9 LP: opponent's LP set to 4000", { type: OcgMessageType.LPUPDATE, player: 1, lp: 4000 }),
  lpPreview("#10 Turn banner: your turn", { type: OcgMessageType.NEW_TURN, player: 0, turn: 3 }),
  lpPreview("#10 Turn banner: opponent's turn", { type: OcgMessageType.NEW_TURN, player: 1, turn: 4 }),
  {
    label: "#12 Search: card revealed (lifts), then hand shuffled (you)",
    async run(host, snap) {
      // As after Sangan's search: CONFIRM_CARDS to the opponent, then SHUFFLE_HAND with the new order.
      const hand = snap.players[0].hand.map((c) => c.code);
      await host.animator.play([
        { type: OcgMessageType.CONFIRM_CARDS, player: 1, cards: [{ code: hand[0], controller: 0, location: OcgLocation.HAND, sequence: 0 }] } as OcgMessage,
        { type: OcgMessageType.SHUFFLE_HAND, player: 0, cards: [...hand].reverse() } as OcgMessage,
      ]);
    },
  },
  {
    label: "#12 Search: opponent's card flips up, back down, hand shuffled",
    async run(host, snap) {
      // As after the opponent's Sangan: the added card (last in hand) is revealed to you, then their hand shuffles.
      const n = snap.players[1].hand.length, code = snap.players[0].hand[0].code;
      await host.animator.play([
        { type: OcgMessageType.CONFIRM_CARDS, player: 0, cards: [{ code, controller: 1, location: OcgLocation.HAND, sequence: n - 1 }] } as OcgMessage,
        { type: OcgMessageType.SHUFFLE_HAND, player: 1, cards: Array(n).fill(0) } as OcgMessage,
      ]);
    },
  },
  {
    label: "#12 Confiscation: opponent's hand flips up, one discarded, rest flip down + shuffle",
    async run(host, snap) {
      // CONFIRM_CARDS of their whole hand, (your pick: here a pause), the pick goes to the GY, then SHUFFLE_HAND.
      const n = snap.players[1].hand.length, mine = snap.players[0].hand.map((c) => c.code);
      const codes = Array.from({ length: n }, (_, i) => mine[i % mine.length]);
      await host.animator.play([{
        type: OcgMessageType.CONFIRM_CARDS, player: 0,
        cards: codes.map((code, sequence) => ({ code, controller: 1, location: OcgLocation.HAND, sequence })),
      } as OcgMessage]);
      await pause(host, 1500);
      await host.animator.play([
        moveMsg(codes[0], { controller: 1, location: OcgLocation.HAND, sequence: 0, position: OcgPosition.FACEDOWN_DEFENSE },
          { controller: 1, location: OcgLocation.GRAVE, sequence: 0, position: OcgPosition.FACEUP_ATTACK }, REASON.DISCARD),
        { type: OcgMessageType.SHUFFLE_HAND, player: 1, cards: Array(n - 1).fill(0) } as OcgMessage,
      ]);
    },
  },
  {
    label: "#12 Search: opponent's hand shuffled",
    async run(host, snap) {
      const n = snap.players[1].hand.length;
      await host.animator.play([{ type: OcgMessageType.SHUFFLE_HAND, player: 1, cards: Array(n).fill(0) } as OcgMessage]);
    },
  },
  {
    label: "#11 Phase change: whole turn (no actions)",
    async run(host) {
      // Draw, Standby, Main 1, Battle, Main 2, End, back-to-back as the engine sends them.
      await host.animator.play([0x1, 0x2, 0x4, 0x8, 0x100, 0x200].map((phase) => ({ type: OcgMessageType.NEW_PHASE, phase }) as OcgMessage));
    },
  },
  lpPreview("#13 Coin toss: heads", { type: OcgMessageType.TOSS_COIN, player: 0, results: [true] }),
  lpPreview("#13 Coin toss: tails", { type: OcgMessageType.TOSS_COIN, player: 0, results: [false] }),
  {
    label: "#13 Coin toss: opponent calls heads, tails comes up",
    run: (host) => host.animator.play([
      { type: OcgMessageType.HINT, hint_type: 4, player: 1, hint: 60n },
      { type: OcgMessageType.TOSS_COIN, player: 1, results: [false] },
    ] as unknown as OcgMessage[]),
  },
  lpPreview("#13 Coin toss: three coins", { type: OcgMessageType.TOSS_COIN, player: 0, results: [true, false, true] }),
  {
    label: "#14 Die roll: random result",
    run: (host) => host.animator.play([{ type: OcgMessageType.TOSS_DICE, player: 0, results: [1 + Math.floor(Math.random() * 6)] } as OcgMessage]),
  },
  lpPreview("#14 Die roll: two dice (6, 1)", { type: OcgMessageType.TOSS_DICE, player: 0, results: [6, 1] }),
];

/** Plays a single engine message (LP changes, coin tosses, die rolls). */
function lpPreview(label: string, msg: object): Preview {
  return { label, run: (host) => host.animator.play([msg as OcgMessage]) };
}

function damagePreview(label: string, player: number, amount: number): Preview {
  return {
    label,
    async run(host) {
      await host.animator.play([{ type: OcgMessageType.DAMAGE, player, amount } as unknown as OcgMessage]);
    },
  };
}

/** Puts a monster on each side (your first hand card, and a stand-in for the opponent), then one attacks. */
function attackPreview(label: string, attacker: "mine" | "theirs", atMonster: boolean, negated = false): Preview {
  return {
    label,
    async run(host, snap) {
      const mine = { controller: 0, location: OcgLocation.MZONE, sequence: 2, position: OcgPosition.FACEUP_ATTACK };
      const theirs = { controller: 1, location: OcgLocation.MZONE, sequence: 2, position: OcgPosition.FACEUP_ATTACK };
      const myCode = snap.players[0].hand[0].code;
      const theirCode = snap.players[0].hand[1]?.code ?? myCode;
      const setup = [moveMsg(myCode, hand(0), mine)];
      if (atMonster || attacker === "theirs") {
        setup.push(moveMsg(theirCode, { controller: 1, location: OcgLocation.HAND, sequence: 0, position: OcgPosition.FACEDOWN_DEFENSE }, theirs));
      }
      await host.animator.play(setup);
      await pause(host, 500);
      const [from, to] = attacker === "mine" ? [mine, theirs] : [theirs, mine];
      // Declaration (outlines), a moment for responses, then the hit (lunge) and the end of the damage step.
      await host.animator.play([{ type: OcgMessageType.ATTACK, card: from, target: atMonster ? to : null } as unknown as OcgMessage]);
      await pause(host, 1000);
      if (negated) {
        // e.g. Mirror Force: the attacker is destroyed, no hit.
        await host.animator.play([moveMsg(attacker === "mine" ? myCode : theirCode, from, { ...from, location: OcgLocation.GRAVE, sequence: 0 }, REASON.DESTROY)]);
        return;
      }
      const placeholder = { controller: 0, location: 0, sequence: 0, position: 0 };
      await host.animator.play([
        { type: OcgMessageType.BATTLE, card: from, target: atMonster ? to : placeholder } as unknown as OcgMessage,
        { type: OcgMessageType.DAMAGE_STEP_END } as unknown as OcgMessage,
      ]);
    },
  };
}

function chainMsg(code: number, at: { controller: number; location: number; sequence: number; position: number }): OcgMessage {
  return {
    type: OcgMessageType.CHAINING, code, ...at, triggering_controller: at.controller, triggering_location: at.location,
    triggering_sequence: at.sequence, description: 0n, chain_size: 1,
  } as unknown as OcgMessage;
}

/** Puts the first hand card on the field in `from`, then changes it to `to`. */
function posPreview(label: string, from: number, to: number): Preview {
  return {
    label,
    async run(host, snap) {
      const code = snap.players[0].hand[0].code;
      await host.animator.play([moveMsg(code, hand(0), zone(OcgLocation.MZONE, 2, from))]);
      await pause(host, 500);
      await host.animator.play([
        { type: OcgMessageType.POS_CHANGE, code, controller: 0, location: OcgLocation.MZONE, sequence: 2, prev_position: from, position: to } as OcgMessage,
      ]);
    },
  };
}

/** SUMMONING / SPSUMMONING / FLIPSUMMONING-style message for a card at `at`. */
function cardMsg(type: OcgMessageType, code: number, at: { controller: number; location: number; sequence: number; position: number }): OcgMessage {
  return { type, code, ...at } as unknown as OcgMessage;
}

const hand = (sequence: number) => ({ controller: 0, location: OcgLocation.HAND, sequence, position: OcgPosition.FACEUP_ATTACK });
const zone = (location: number, sequence: number, position: number) => ({ controller: 0, location, sequence, position });

function moveMsg(code: number, from: object, to: object, reason = 0): OcgMessage {
  return { type: OcgMessageType.MOVE, card: code, from, to, reason } as unknown as OcgMessage;
}

function drawMsg(codes: number[]): OcgMessage {
  return { type: OcgMessageType.DRAW, player: 0, drawn: codes.map((code) => ({ code, position: OcgPosition.FACEDOWN_DEFENSE })) } as OcgMessage;
}

/** Adds the dropdown + Play button (plain HTML above the game). Call once the duel has started. */
export function installAnimPreview(real: PreviewHost) {
  const swapped = () => real.me() === 1;
  const host: PreviewHost = {
    ...real,
    animator: { play: (messages, onMessage) => real.animator.play(swapped() ? swapSeats(messages) : messages, onMessage) },
    snapshot: () => { const s = real.snapshot(); return s && swapped() ? swapSeats(s) : s; },
    renderBoard: (snap) => real.renderBoard(swapped() ? swapSeats(snap) : snap),
  };
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;left:6px;top:6px;z-index:10;display:flex;gap:4px;font:12px monospace";
  const select = document.createElement("select");
  PREVIEWS.forEach((p, i) => select.add(new Option(p.label, String(i))));
  const play = document.createElement("button");
  play.textContent = "Play";
  box.append(select, play);
  document.body.append(box);
  host.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => box.remove());

  let busy = false;
  const run = async () => {
    const snap = host.snapshot();
    if (busy || !snap) return;
    busy = true;
    try {
      await PREVIEWS[Number(select.value)].run(host, snap);
      await pause(host, 500);
    } finally {
      host.renderBoard(snap); // back to the real game state
      busy = false;
    }
  };
  play.addEventListener("click", run);
  select.addEventListener("change", run);
}
