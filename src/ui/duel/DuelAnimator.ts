// Plays engine messages as animations on the currently displayed board.
// It only has to look right: after a batch finishes, DuelScene redraws the board from the
// engine snapshot, which corrects any drift (e.g. hand order after several cards leave).
import Phaser from "phaser";
import { OcgLocation, OcgMessageType, OcgPosition, type OcgMessage } from "ocgcore-wasm";
import type { CardDb } from "../../duel/cardData.ts";
import { HUMAN } from "../../duel/DuelController.ts";
import { PHASE_NAMES } from "../../duel/text.ts";
import { FONT } from "../widgets.ts";
import { CardSprite } from "./CardSprite.ts";
import { FIELD_CARD, FIELD_CENTER_X, ROWS, handXY, slotXY } from "./layout.ts";

export interface AnimHost {
  readonly scene: Phaser.Scene;
  readonly cards: CardDb;
  /** Displayed card sprites keyed `controller:location:sequence`; the animator re-keys them as cards move. */
  readonly sprites: Map<string, CardSprite>;
  /** Container the board lives in (cleared on every redraw, so temporary sprites go here too). */
  readonly board: Phaser.GameObjects.Container;
  /** Displayed hand sizes, kept in sync while animating. */
  readonly handCount: [number, number];
  setPhaseText(text: string): void;
  /** Animates the LP display of `player` to `lp`, with a floating `delta` label. */
  changeLP(player: number, lp: number, delta: number): Promise<void>;
  lp(player: number): number;
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
const sideOf = (controller: number) => (controller === HUMAN ? 0 : 1) as 0 | 1;

export class DuelAnimator {
  /** Global speed multiplier (2 = twice as fast). */
  speed = 1;
  /** Message currently being animated (debugging aid). */
  current: OcgMessage | null = null;
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
    switch (m.type) {
      case OcgMessageType.NEW_TURN:
        return this.banner(m.player === HUMAN ? "Your Turn" : "Opponent's Turn", m.player === HUMAN ? "#8fd3ff" : "#ff9a9a");
      case OcgMessageType.NEW_PHASE:
        h.setPhaseText(PHASE_NAMES[m.phase] ?? "");
        return this.wait(120);
      case OcgMessageType.DRAW:
        return this.draw(m.player, m.drawn.map((d) => d.code));
      case OcgMessageType.MOVE:
        return this.move(m.card, m.from, m.to);
      case OcgMessageType.SUMMONING:
      case OcgMessageType.SPSUMMONING:
      case OcgMessageType.FLIPSUMMONING:
        return this.summonBurst(m, m.type === OcgMessageType.SPSUMMONING ? 0xc58cff : 0xfff2a8);
      case OcgMessageType.POS_CHANGE:
        return this.posChange(m, m.code, m.position);
      case OcgMessageType.CHAINING:
        return this.activate(m, m.code);
      case OcgMessageType.ATTACK:
        return this.attack(m.card, m.target);
      case OcgMessageType.DAMAGE:
        if (m.amount >= 1000) h.scene.cameras.main.shake(180 / this.speed, 0.006);
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
    const flights: Promise<void>[] = [];
    for (const [i, code] of codes.entries()) {
      const index = h.handCount[side]++;
      this.relayoutHand(side);
      const target = handXY(side, index, h.handCount[side]);
      const sp = this.tempSprite(deck.x, deck.y, target.w, target.h, 0, true);
      sp.setScale(FIELD_CARD.w / target.w);
      h.sprites.set(key({ controller: player, location: OcgLocation.HAND, sequence: index }), sp);
      const reveal = player === HUMAN ? code : 0;
      flights.push(this.wait(i * 90).then(async () => {
        await this.tween({ targets: sp, x: target.x, y: target.y, scale: 1, duration: 260, ease: "Cubic.easeOut" });
        if (reveal) await this.flip(sp, reveal);
      }));
    }
    await Promise.all(flights);
  }

  private async move(code: number, from: Loc, to: Loc): Promise<void> {
    const h = this.host;
    const dest = this.locXY(to);
    if (!dest) return;
    let sp = this.findSprite(from, code);
    if (sp) {
      h.sprites.delete(key(from));
    } else {
      const src = this.locXY(from);
      if (!src) return;
      sp = this.tempSprite(src.x, src.y, src.w, src.h, code, !this.visible(code, from));
    }
    if (from.location === OcgLocation.HAND) {
      h.handCount[sideOf(from.controller)]--;
      this.rekeyHand(from.controller);
      this.relayoutHand(sideOf(from.controller));
    }
    const toHand = to.location === OcgLocation.HAND;
    const target = toHand ? handXY(sideOf(to.controller), h.handCount[sideOf(to.controller)]++, h.handCount[sideOf(to.controller)]) : dest;
    if (toHand) this.relayoutHand(sideOf(to.controller));

    // Destroyed cards flash red before leaving the field.
    if (from.location & ON_FIELD && to.location & (OcgLocation.GRAVE | OcgLocation.REMOVED)) {
      await this.flash(sp, 0xff4444);
    }
    h.board.bringToTop(sp);
    const angle = to.location === OcgLocation.MZONE && (to.position ?? 0) & DEFENSE ? 90 : 0;
    await this.tween({
      targets: sp, x: target.x, y: target.y, angle,
      scaleX: target.w / sp.w, scaleY: target.h / sp.h, duration: 320, ease: "Cubic.easeInOut",
    });
    const showCode = this.visible(code, to) ? code : 0;
    if (showCode !== sp.code) await this.flip(sp, showCode, to.controller === HUMAN && this.faceDown(to));
    h.sprites.set(key(to), sp);
    if (toHand) this.rekeyHand(to.controller);
  }

  private async summonBurst(l: Loc, color: number): Promise<void> {
    const sp = this.host.sprites.get(key(l));
    const at = this.locXY(l);
    if (!at) return;
    const ring = this.host.scene.add.circle(at.x, at.y, 20, color, 0).setStrokeStyle(4, color);
    this.host.board.add(ring);
    const pulse = sp ? this.tween({ targets: sp, scaleX: sp.scaleX * 1.25, scaleY: sp.scaleY * 1.25, duration: 160, yoyo: true }) : Promise.resolve();
    await Promise.all([pulse, this.tween({ targets: ring, radius: 70, alpha: 0, duration: 380, onComplete: () => ring.destroy() })]);
  }

  private async posChange(l: Loc, code: number, position: number): Promise<void> {
    const sp = this.host.sprites.get(key(l));
    if (!sp) return;
    const faceDown = (position & FACEDOWN) !== 0;
    const showCode = this.visible(code, { ...l, position }) ? code : 0;
    const angle = position & DEFENSE ? 90 : 0;
    await this.tween({ targets: sp, angle, duration: 240, ease: "Sine.easeInOut" });
    if (showCode !== sp.code) await this.flip(sp, showCode, l.controller === HUMAN && faceDown);
  }

  /** The activated card zooms to the middle of the field, then shrinks back. */
  private async activate(l: Loc, code: number): Promise<void> {
    const h = this.host;
    const from = this.locXY(l) ?? { x: FIELD_CENTER_X, y: ROWS.center, w: FIELD_CARD.w, h: FIELD_CARD.h };
    const src = h.sprites.get(key(l));
    if (src && src.code !== code) await this.flip(src, code); // face-down card being activated
    const big = this.tempSprite(from.x, from.y, 150, 218, code, false).setScale(from.w / 150).setDepth(600);
    big.setHighlight("action");
    h.board.remove(big);
    h.scene.add.existing(big);
    await this.tween({ targets: big, x: FIELD_CENTER_X, y: ROWS.center, scale: 1, duration: 260, ease: "Back.easeOut" });
    await this.wait(420);
    await this.tween({ targets: big, x: from.x, y: from.y, scale: from.w / 150, alpha: 0, duration: 220, ease: "Cubic.easeIn" });
    big.destroy();
  }

  private async attack(card: Loc, target: Loc | null): Promise<void> {
    const h = this.host;
    const sp = h.sprites.get(key(card));
    if (!sp) return;
    const to = target ? this.locXY(target) : { x: FIELD_CENTER_X, y: card.controller === HUMAN ? ROWS.oppHand + 40 : ROWS.myHand - 40 };
    if (!to) return;
    h.board.bringToTop(sp);
    const sx = sp.x, sy = sp.y;
    await this.tween({ targets: sp, x: sx + (to.x - sx) * 0.75, y: sy + (to.y - sy) * 0.75, duration: 200, ease: "Quad.easeIn" });
    if (target) {
      const victim = h.sprites.get(key(target));
      if (victim) void this.flash(victim, 0xffffff);
    }
    await this.tween({ targets: sp, x: sx, y: sy, duration: 220, ease: "Quad.easeOut" });
  }

  private async banner(text: string, color: string): Promise<void> {
    const s = this.host.scene;
    const band = s.add.rectangle(FIELD_CENTER_X, ROWS.center, 740, 64, 0x000000, 0.7).setDepth(700).setAlpha(0);
    const t = s.add.text(FIELD_CENTER_X - 120, ROWS.center, text, { fontFamily: FONT, fontSize: "34px", color, fontStyle: "bold" })
      .setOrigin(0.5).setDepth(701).setAlpha(0);
    await Promise.all([
      this.tween({ targets: band, alpha: 1, duration: 220 }),
      this.tween({ targets: t, alpha: 1, x: FIELD_CENTER_X, duration: 220, ease: "Cubic.easeOut" }),
    ]);
    await this.wait(450);
    await this.tween({ targets: [band, t], alpha: 0, duration: 200 });
    band.destroy();
    t.destroy();
  }

  // ---------------------------------------------------------------- helpers

  private visible(code: number, l: Loc): boolean {
    if (!code) return false;
    if (l.location & (OcgLocation.GRAVE | OcgLocation.REMOVED)) return true;
    if (l.controller === HUMAN) return l.location !== OcgLocation.DECK;
    if (l.location === OcgLocation.HAND || l.location === OcgLocation.DECK || l.location === OcgLocation.EXTRA) return false;
    return !this.faceDown(l);
  }

  private faceDown(l: Loc): boolean {
    return ((l.position ?? 0) & FACEDOWN) !== 0;
  }

  private locXY(l: Loc): { x: number; y: number; w: number; h: number } | null {
    const side = sideOf(l.controller);
    const sized = (p: { x: number; y: number }) => ({ ...p, w: FIELD_CARD.w, h: FIELD_CARD.h });
    switch (l.location) {
      case OcgLocation.MZONE: return sized(slotXY(side, { kind: "mzone", seq: Math.min(l.sequence, 4) }));
      case OcgLocation.SZONE: return sized(slotXY(side, { kind: "szone", seq: Math.min(l.sequence, 5) }));
      case OcgLocation.GRAVE: return sized(slotXY(side, { kind: "grave" }));
      case OcgLocation.REMOVED: return sized(slotXY(side, { kind: "banished" }));
      case OcgLocation.DECK: return sized(slotXY(side, { kind: "deck" }));
      case OcgLocation.EXTRA: return sized(slotXY(side, { kind: "extra" }));
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

  /** Slides the cards still in a hand to their positions for the current hand size. */
  private relayoutHand(side: 0 | 1) {
    const prefix = `${side === 0 ? HUMAN : 1 - HUMAN}:${OcgLocation.HAND}:`;
    const n = this.host.handCount[side];
    const hand = [...this.host.sprites].filter(([k]) => k.startsWith(prefix)).sort((a, b) => a[1].x - b[1].x);
    hand.forEach(([, s], i) => {
      const p = handXY(side, i, Math.max(n, hand.length));
      this.host.scene.tweens.add({ targets: s, x: p.x, y: p.y, duration: 200 / this.speed });
    });
  }

  private tempSprite(x: number, y: number, w: number, h: number, code: number, back: boolean): CardSprite {
    const sp = new CardSprite(this.host.scene, x, y, w, h).show(code, this.host.cards.records.get(code), { back: back || !code });
    this.host.board.add(sp);
    return sp;
  }

  /** Squash horizontally, swap the face, expand again. */
  private async flip(sp: CardSprite, code: number, dim = false): Promise<void> {
    const sx = sp.scaleX;
    await this.tween({ targets: sp, scaleX: 0, duration: 90, ease: "Sine.easeIn" });
    sp.show(code, this.host.cards.records.get(code), { back: !code, dim });
    await this.tween({ targets: sp, scaleX: sx, duration: 90, ease: "Sine.easeOut" });
  }

  private async flash(sp: CardSprite, color: number): Promise<void> {
    const r = this.host.scene.add.rectangle(sp.x, sp.y, sp.w * sp.scaleX, sp.h * sp.scaleY, color, 0.75).setAngle(sp.angle);
    this.host.board.add(r);
    await this.tween({ targets: r, alpha: 0, duration: 260, onComplete: () => r.destroy() });
  }

  private tween(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise((resolve) => {
      const onComplete = config.onComplete;
      this.host.scene.tweens.add({
        ...config,
        duration: (config.duration as number ?? 200) / this.speed,
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
