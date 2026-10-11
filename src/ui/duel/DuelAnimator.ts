// Plays engine messages as animations on the currently displayed board.
// It only has to look right: after a batch finishes, DuelScene redraws the board from the
// engine snapshot, which corrects any drift (e.g. hand order after several cards leave).
import Phaser from "phaser";
import { OcgLocation, OcgMessageType, OcgPosition, type OcgMessage } from "ocgcore-wasm";
import type { CardDb } from "../../duel/cardData.ts";
import { HUMAN } from "../../duel/DuelController.ts";
import { REASON, type MoveMessage } from "../../duel/DuelSession.ts";
import { PHASE_NAMES } from "../../duel/text.ts";
import { text } from "../pixel.ts";
import { CardSprite } from "./CardSprite.ts";
import { FIELD, FIELD_CENTER, ROWS, handXY, slotXY } from "./layout.ts";

export interface AnimHost {
  readonly scene: Phaser.Scene;
  readonly cards: CardDb;
  /** Displayed card sprites keyed `controller:location:sequence`; the animator re-keys them as cards move. */
  readonly sprites: Map<string, CardSprite>;
  /** Container the board lives in (cleared on every redraw, so temporary sprites go here too). */
  readonly board: Phaser.GameObjects.Container;
  /** Displayed hand sizes, kept in sync while animating. */
  readonly handCount: [number, number];
  /** Called with the engine phase bit on NEW_PHASE. */
  setPhase(phase: number, name: string): void;
  /** Animates the LP display of `player` to `lp`, with a floating `delta` label. */
  changeLP(player: number, lp: number, delta: number): Promise<void>;
  lp(player: number): number;
  /** Marks the declared attack (1px outlines on attacker / target); keys or null to clear. */
  markAttack(attacker: string | null, target: string | null): void;
}

interface Loc {
  controller: number;
  location: number;
  sequence: number;
  position?: number;
}

const FACEDOWN = OcgPosition.FACEDOWN_ATTACK | OcgPosition.FACEDOWN_DEFENSE;
const DEFENSE = OcgPosition.FACEUP_DEFENSE | OcgPosition.FACEDOWN_DEFENSE;
const ON_FIELD = OcgLocation.MZONE | OcgLocation.SZONE;
const key = (l: Loc) => `${l.controller}:${l.location}:${l.sequence}`;

/**
 * Timings (ms, at speed 1). Pixel-art style: quick, direct moves; no squash/stretch, no overshoot,
 * no in-between scales or angles. Faces swap instantly, rotations snap.
 */
const T = {
  /** Card flying between zones / to the hand / to the GY. */
  move: 320,
  /** Each drawn card's flight from the deck, and the delay between consecutive cards. */
  draw: 350,
  drawStagger: 150,
  /** Other hand cards sliding to make room. */
  relayout: 210,
  /** Attack declaration: pause after marking attacker and target. */
  declare: 300,
  /** Attack hit (damage calculation): lunge toward the target and back. */
  lunge: 190,
  /** Position change: rotating between attack and defense. */
  rotate: 300,
  /** White (summon / hit) or red (destroyed) flash on a card. */
  flash: 240,
  /** Activated card shown at 2x in the middle of the field. */
  activateHold: 950,
  /** Screen shake when damage takes a player's LP to 0. */
  lethalShake: 300,
  /** Turn banner on screen. */
  banner: 1100,
};
const EASE = "Quad.easeOut";

const sideOf = (controller: number) => (controller === HUMAN ? 0 : 1) as 0 | 1;

export class DuelAnimator {
  /** Global speed multiplier (2 = twice as fast). */
  speed = 1;
  /** True while messages are being animated (hover effects stay off meanwhile). */
  get busy(): boolean {
    return this.current !== null;
  }

  /** Sprite keys of the currently declared attack (attacker, target). */
  private attackKeys: [string | null, string | null] = [null, null];

  private clearAttack() {
    if (!this.attackKeys[0] && !this.attackKeys[1]) return;
    this.attackKeys = [null, null];
    this.host.markAttack(null, null);
  }

  /** Message currently being animated (debugging aid). */
  current: OcgMessage | null = null;
  /** Card just flipped face-up (it already flashed, so a following FLIPSUMMONING doesn't flash again). */
  private justFlipped: string | null = null;
  private readonly host: AnimHost;

  constructor(host: AnimHost) {
    this.host = host;
  }

  /** Animates `messages` in order; `onMessage` runs as each one starts (e.g. to log it). */
  async play(messages: OcgMessage[], onMessage?: (m: OcgMessage) => void): Promise<void> {
    for (const m of messages) {
      onMessage?.(m);
      this.current = m;
      await this.playOne(m);
    }
    this.current = null;
  }

  private async playOne(m: OcgMessage): Promise<void> {
    const h = this.host;
    if (m.type !== OcgMessageType.POS_CHANGE && m.type !== OcgMessageType.FLIPSUMMONING) this.justFlipped = null;
    switch (m.type) {
      case OcgMessageType.NEW_TURN:
        this.clearAttack();
        return this.banner(m.player === HUMAN ? "YOUR TURN" : "OPPONENT'S TURN", m.player === HUMAN ? 0x1d6da0 : 0xa02020);
      case OcgMessageType.NEW_PHASE:
        if (!(m.phase & 0xf8)) this.clearAttack(); // left the battle phase
        h.setPhase(m.phase, PHASE_NAMES[m.phase] ?? "");
        return this.wait(120);
      case OcgMessageType.DRAW:
        return this.draw(m.player, m.drawn.map((d) => d.code));
      case OcgMessageType.MOVE:
        return this.move(m.card, m.from, m.to, ((m as MoveMessage).reason ?? 0) & REASON.DESTROY ? "destroyed" : null);
      case OcgMessageType.SUMMONING:
      case OcgMessageType.SPSUMMONING:
      case OcgMessageType.FLIPSUMMONING:
        // A Flip Summon's flip already flashed (see posChange); don't flash twice.
        if (m.type === OcgMessageType.FLIPSUMMONING && this.justFlipped === key(m)) return;
        return this.summonBurst(m, m.type === OcgMessageType.SPSUMMONING ? 0x5aa8ff : 0xfff2a8);
      case OcgMessageType.POS_CHANGE:
        return this.posChange(m, m.code, m.prev_position, m.position);
      case OcgMessageType.CHAINING:
        return this.activate(m, m.code);
      case OcgMessageType.ATTACK:
        // Declaration: only mark attacker and target; the lunge plays at the hit (BATTLE).
        this.attackKeys = [key(m.card), m.target ? key(m.target) : null];
        h.markAttack(...this.attackKeys);
        return this.wait(T.declare);
      case OcgMessageType.BATTLE: {
        // Damage calculation = the hit. Direct attacks carry a placeholder target with location 0.
        const target = m.target && m.target.location ? m.target : null;
        this.clearAttack(); // marks go as the attacker takes off
        return this.attack(m.card, target);
      }
      case OcgMessageType.ATTACK_DISABLED:
      case OcgMessageType.DAMAGE_STEP_END:
        this.clearAttack();
        break;
      case OcgMessageType.DAMAGE:
        // The finishing blow shakes the screen; other damage doesn't.
        if (h.lp(m.player) - m.amount <= 0) h.scene.cameras.main.shake(T.lethalShake / this.speed, 0.01);
        return h.changeLP(m.player, h.lp(m.player) - m.amount, -m.amount);
      case OcgMessageType.PAY_LPCOST:
        return h.changeLP(m.player, h.lp(m.player) - m.amount, -m.amount);
      case OcgMessageType.RECOVER:
        return h.changeLP(m.player, h.lp(m.player) + m.amount, m.amount);
      case OcgMessageType.LPUPDATE:
        return h.changeLP(m.player, m.lp, 0);
    }
  }

  // ---------------------------------------------------------------- individual animations

  private async draw(player: number, codes: number[]): Promise<void> {
    const h = this.host;
    const side = sideOf(player);
    const deck = slotXY(side, { kind: "deck" });
    // Every card goes straight to its place in the final hand, so the hand doesn't re-space mid-draw.
    const first = h.handCount[side];
    const finalCount = first + codes.length;
    this.relayoutHand(side, finalCount);
    h.handCount[side] = finalCount;
    const flights = codes.map((code, i) => {
      const target = handXY(side, first + i, finalCount);
      const sp = this.tempSprite(deck.x, deck.y, 0);
      h.sprites.set(key({ controller: player, location: OcgLocation.HAND, sequence: first + i }), sp);
      return this.wait(i * T.drawStagger).then(async () => {
        await this.tween({ targets: sp, x: target.x, y: target.y, duration: T.draw, ease: EASE });
        if (player === HUMAN) this.reveal(sp, code);
      });
    });
    await Promise.all(flights);
  }

  private async move(code: number, from: Loc, to: Loc, cause: "destroyed" | null = null): Promise<void> {
    const h = this.host;
    const dest = this.locXY(to);
    if (!dest) return;
    if (this.attackKeys.includes(key(from))) this.clearAttack();
    let sp = this.findSprite(from, code);
    if (sp) {
      h.sprites.delete(key(from));
    } else {
      const src = this.locXY(from);
      if (!src) return;
      sp = this.tempSprite(src.x, src.y, this.visible(code, from) ? code : 0);
    }
    if (from.location === OcgLocation.HAND) {
      h.handCount[sideOf(from.controller)]--;
      this.rekeyHand(from.controller);
      this.relayoutHand(sideOf(from.controller));
    }
    const toHand = to.location === OcgLocation.HAND;
    const toSide = sideOf(to.controller);
    const target = toHand ? handXY(toSide, h.handCount[toSide]++, h.handCount[toSide]) : dest;
    if (toHand) this.relayoutHand(toSide);

    // Destroyed cards (by battle or effect) flash red before leaving; other moves to the GY don't.
    if (cause === "destroyed") await this.destroyFlash(sp);
    h.board.bringToTop(sp);
    const showCode = this.visible(code, to) ? code : 0;
    // Going face-down (a Set): turn to the back as it leaves, like placing a real card face-down.
    if (!showCode && sp.code) this.reveal(sp, 0);
    // Rotate into defense position (or back to attack) while flying.
    const angle = to.location === OcgLocation.MZONE && (to.position ?? 0) & DEFENSE ? 90 : 0;
    await this.tween({ targets: sp, x: target.x, y: target.y, angle, duration: T.move, ease: EASE });
    // Becoming visible (e.g. a monster summoned face-up from the hand of the opponent): reveal on landing.
    if (showCode !== sp.code) this.reveal(sp, showCode);
    h.sprites.set(key(to), sp);
    if (toHand) this.rekeyHand(to.controller);
  }

  /** #3 Destroy: red flash on the card before it leaves for the GY. */
  private async destroyFlash(sp: CardSprite): Promise<void> {
    await this.flash(sp, 0xff4444);
  }

  /** Summoned card flashes (white for Normal/Flip, blue for Special Summons). */
  private async summonBurst(l: Loc, color: number): Promise<void> {
    const sp = this.host.sprites.get(key(l));
    if (sp) await this.flash(sp, color);
  }

  /**
   * Attack <-> defense: rotate smoothly, change face at the end. A card flipped face-up (Flip Summon,
   * or a set monster that got attacked) then flashes white, like a summon.
   */
  private async posChange(l: Loc, code: number, prevPosition: number, position: number): Promise<void> {
    const sp = this.host.sprites.get(key(l));
    if (!sp) return;
    // Only monsters have attack/defense orientation; Spell/Trap cards stay upright (their position bits
    // still say "defense" while set, e.g. when a set card is flipped up to be activated).
    const monster = l.location === OcgLocation.MZONE;
    const angle = monster && position & DEFENSE ? 90 : 0;
    if (sp.angle !== angle) await this.tween({ targets: sp, angle, duration: T.rotate, ease: "Sine.easeInOut" });
    const showCode = this.visible(code, { ...l, position }) ? code : 0;
    if (showCode !== sp.code) this.reveal(sp, showCode);
    // A monster flipped face-up flashes like a summon; Spells/Traps flash when they activate instead.
    if (monster && prevPosition & FACEDOWN && !(position & FACEDOWN)) {
      this.justFlipped = key(l);
      await this.flash(sp, 0xfff2a8);
    }
  }

  /** The activated card is shown at exactly 2x in the middle of the field for a moment. */
  private async activate(l: Loc, code: number): Promise<void> {
    const h = this.host;
    const src = h.sprites.get(key(l));
    if (src && src.code !== code) this.reveal(src, code); // face-down card being activated
    if (src) await this.flash(src, 0xffffff);
    const big = new CardSprite(h.scene, FIELD_CENTER.x, FIELD_CENTER.y).show(code, h.cards.records.get(code)).setScale(2).setDepth(600);
    await this.wait(T.activateHold);
    big.destroy();
  }

  private async attack(card: Loc, target: Loc | null): Promise<void> {
    const h = this.host;
    const sp = h.sprites.get(key(card));
    if (!sp) return;
    const to = target ? this.locXY(target) : { x: FIELD_CENTER.x, y: card.controller === HUMAN ? ROWS.oppHand : ROWS.myHand };
    if (!to) return;
    h.board.bringToTop(sp);
    const sx = sp.x, sy = sp.y;
    await this.tween({ targets: sp, x: sx + (to.x - sx) * 0.7, y: sy + (to.y - sy) * 0.7, duration: T.lunge, ease: "Quad.easeIn" });
    if (target) {
      const victim = h.sprites.get(key(target));
      if (victim) void this.flash(victim, 0xffffff);
    }
    await this.tween({ targets: sp, x: sx, y: sy, duration: T.lunge, ease: EASE });
  }

  /** Turn banner: a coloured band with the text, on and off without transitions. */
  private async banner(label: string, color: number): Promise<void> {
    const s = this.host.scene;
    const band = s.add.rectangle(FIELD.left, FIELD_CENTER.y - 9, FIELD.right - FIELD.left, 18, color, 0.9).setOrigin(0).setDepth(700);
    const t = text(s, FIELD_CENTER.x, FIELD_CENTER.y - 5, label, { color: 0xffffff, scale: 2, originX: 0.5 }).setDepth(701);
    await this.wait(T.banner);
    band.destroy();
    t.destroy();
  }

  // ---------------------------------------------------------------- helpers

  /** Whether a card at `l` is drawn face-up. Face-down cards on the field show their back for everyone. */
  private visible(code: number, l: Loc): boolean {
    if (!code) return false;
    if (l.location & (OcgLocation.GRAVE | OcgLocation.REMOVED)) return true;
    if (l.location & ON_FIELD) return !this.faceDown(l);
    if (l.controller === HUMAN) return l.location !== OcgLocation.DECK;
    return false; // opponent's hand / deck / extra deck
  }

  private faceDown(l: Loc): boolean {
    return ((l.position ?? 0) & FACEDOWN) !== 0;
  }

  private locXY(l: Loc): { x: number; y: number } | null {
    const side = sideOf(l.controller);
    switch (l.location) {
      case OcgLocation.MZONE: return slotXY(side, { kind: "mzone", seq: Math.min(l.sequence, 4) });
      case OcgLocation.SZONE: return slotXY(side, { kind: "szone", seq: Math.min(l.sequence, 5) });
      case OcgLocation.GRAVE: return slotXY(side, { kind: "grave" });
      case OcgLocation.REMOVED: return slotXY(side, { kind: "banished" });
      case OcgLocation.DECK: return slotXY(side, { kind: "deck" });
      case OcgLocation.EXTRA: return slotXY(side, { kind: "extra" });
      case OcgLocation.HAND: return handXY(side, l.sequence, Math.max(this.host.handCount[side], l.sequence + 1));
      default: return null;
    }
  }

  /** Finds the sprite for a moving card; for hands, falls back to matching by passcode. */
  private findSprite(l: Loc, code: number): CardSprite | undefined {
    const sp = this.host.sprites.get(key(l));
    if (l.location !== OcgLocation.HAND || !code || sp?.code === code) return sp;
    for (const [k, s] of this.host.sprites) {
      if (k.startsWith(`${l.controller}:${OcgLocation.HAND}:`) && s.code === code) {
        this.host.sprites.delete(k);
        this.host.sprites.set(key(l), s);
        return s;
      }
    }
    return sp;
  }

  /** Re-numbers a player's hand sprites 0..n-1 in left-to-right order. */
  private rekeyHand(controller: number) {
    const prefix = `${controller}:${OcgLocation.HAND}:`;
    const hand = [...this.host.sprites].filter(([k]) => k.startsWith(prefix)).sort((a, b) => a[1].x - b[1].x);
    for (const [k] of hand) this.host.sprites.delete(k);
    hand.forEach(([, s], i) => this.host.sprites.set(prefix + i, s));
  }

  /** Slides the cards already in a hand to their positions for a hand of `n` cards (default: current size). */
  private relayoutHand(side: 0 | 1, n = this.host.handCount[side]) {
    const prefix = `${side === 0 ? HUMAN : 1 - HUMAN}:${OcgLocation.HAND}:`;
    const hand = [...this.host.sprites].filter(([k]) => k.startsWith(prefix)).sort((a, b) => a[1].x - b[1].x);
    hand.forEach(([, s], i) => {
      const p = handXY(side, i, Math.max(n, hand.length));
      this.host.scene.tweens.add({ targets: s, x: p.x, y: p.y, duration: T.relayout / this.speed, ease: EASE });
    });
  }

  private tempSprite(x: number, y: number, code: number): CardSprite {
    const sp = new CardSprite(this.host.scene, x, y).show(code, this.host.cards.records.get(code), { back: !code });
    this.host.board.add(sp);
    return sp;
  }

  /** Shows another face (or the back) instantly -- no squash/stretch flip. */
  private reveal(sp: CardSprite, code: number) {
    sp.show(code, this.host.cards.records.get(code), { back: !code });
  }

  private async flash(sp: CardSprite, color: number): Promise<void> {
    const r = this.host.scene.add.rectangle(sp.x, sp.y, sp.w, sp.h, color, 0.75).setAngle(sp.angle);
    this.host.board.add(r);
    await this.tween({ targets: r, alpha: 0, duration: T.flash, onComplete: () => r.destroy() });
  }

  private tween(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    // The animation takes over its target: stop anything else moving it (e.g. the hand hover lift).
    this.host.scene.tweens.killTweensOf(config.targets);
    return new Promise((resolve) => {
      const onComplete = config.onComplete;
      this.host.scene.tweens.add({
        ...config,
        duration: ((config.duration as number) ?? 200) / this.speed,
        onComplete: (...args: unknown[]) => {
          (onComplete as ((...a: unknown[]) => void) | undefined)?.(...args);
          resolve();
        },
      });
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.host.scene.time.delayedCall(ms / this.speed, resolve));
  }
}
