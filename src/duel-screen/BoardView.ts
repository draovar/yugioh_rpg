import Phaser from "phaser";
import { OcgLocation, OcgPosition } from "ocgcore-wasm";
import { counterTotal, type CardView, type FieldSnapshot } from "../duel/engine/DuelSession.ts";
import type { CardDb } from "../duel/engine/cardData.ts";
import { CardSprite } from "./CardSprite.ts";
import type { DuelAnimator } from "./DuelAnimator.ts";
import type { InfoPanel } from "./InfoPanel.ts";
import { CARD, cardKey, handXY, slotXY, type Slot } from "./layout.ts";
import { INK, WHITE, text } from "../ui/pixel.ts";

const DEFENSE = OcgPosition.FACEUP_DEFENSE | OcgPosition.FACEDOWN_DEFENSE;

export interface BoardViewHost {
  scene: Phaser.Scene;
  cards: CardDb;
  panel: InfoPanel;
  readonly animator: DuelAnimator;
  /** Testing aid: the AI's hand and set cards are shown (never in multiplayer). */
  readonly revealOpponent: boolean;
  readonly me: 0 | 1;
  /** Screen side of a player: 0 = you (bottom), 1 = opponent (top). */
  side(player: number): 0 | 1;
  /** Shared with the animator and the LP bar. */
  handCount: [number, number];
  lpValue: [number, number];
  onCardClick(k: string): void;
  openDeckMenu(sp: CardSprite): void;
  browsePile(side: 0 | 1, contents: CardView[], banished: CardView[], pile: "grave" | "extra"): void;
  applyHighlights(): void;
}

/** The cards on the board, redrawn from a snapshot after every engine step. */
export class BoardView {
  readonly container: Phaser.GameObjects.Container;
  readonly sprites = new Map<string, CardSprite>();
  /** Counter badges on field cards; hidden while animating (they don't follow moving cards), redrawn after. */
  private counterBadges = new Map<string, Phaser.GameObjects.Container>();

  private host: BoardViewHost;

  constructor(host: BoardViewHost) {
    this.host = host;
    this.container = host.scene.add.container(0, 0);
  }

  hideCounterBadges() {
    for (const b of this.counterBadges.values()) b.setVisible(false);
  }

  render(snap: FieldSnapshot) {
    const h = this.host;
    this.container.removeAll(true);
    this.sprites.clear();
    this.counterBadges.clear();
    snap.players.forEach((p, player) => {
      const s = h.side(player);
      h.handCount[s] = p.hand.length;
      h.lpValue[s] = p.lp;
      h.panel.lpBars[s].set(p.lp);
      p.monsters.forEach((c, seq) => c && this.placeCard(c, slotXY(s, { kind: "mzone", seq })));
      p.spells.forEach((c, seq) => c && this.placeCard(c, slotXY(s, { kind: "szone", seq })));
      this.drawPile(s, { kind: "deck" }, p.deckCount, null);
      // Only your own Extra Deck can be browsed (the opponent's cards are hidden anyway).
      this.drawPile(s, { kind: "extra" }, p.extraCount, null, s === 0 ? p.extra : undefined);
      this.drawPile(s, { kind: "grave" }, p.grave.length, p.grave.at(-1) ?? null, [...p.grave].reverse(), p.banished);
      this.drawHand(s, p.hand);
    });
    this.linkEquips(snap);
    // Chain links still open (the chain is being built or resolved across several prompts), if 2+ links.
    h.animator.markedChainLinks.forEach((k, i) => this.sprites.get(k)?.setChainMark(i + 1));
    h.applyHighlights();
    h.panel.refreshCounters(snap);
  }

  /**
   * Counters: a number badge on the card's top-right corner, like the pile counts. Redrawn with the count
   * left on the card while you pick counters to remove.
   */
  counterBadge(k: string, count: number) {
    const sp = this.sprites.get(k);
    if (!sp) return;
    this.counterBadges.get(k)?.destroy();
    const sideways = sp.angle !== 0;
    const badge = this.badge(sp.x + (sideways ? CARD.h : CARD.w) / 2, sp.y - (sideways ? CARD.w : CARD.h) / 2, String(count), 1);
    this.counterBadges.set(k, badge);
    this.container.add(badge);
  }

  private placeCard(c: CardView, at: { x: number; y: number }) {
    const sp = this.cardSprite(c, at.x, at.y);
    const sideways = c.location === OcgLocation.MZONE && (c.position & DEFENSE) !== 0;
    if (sideways) sp.setAngle(90);
    const total = counterTotal(c.counters);
    if (total) this.counterBadge(cardKey(c), total);
  }

  /**
   * Hovering an equip card marks the monster it's equipped to with the Equip Spell icon, and hovering an
   * equipped monster marks its equip cards.
   */
  private linkEquips(snap: FieldSnapshot) {
    const partners = new Map<CardSprite, CardSprite[]>();
    const link = (a: CardSprite, b: CardSprite) => partners.set(a, [...(partners.get(a) ?? []), b]);
    for (const p of snap.players) {
      for (const c of [...p.monsters, ...p.spells]) {
        if (!c?.equipTarget) continue;
        const equip = this.sprites.get(cardKey(c));
        const target = this.sprites.get(cardKey(c.equipTarget));
        if (!equip || !target) continue;
        link(equip, target);
        link(target, equip);
      }
    }
    for (const [sp, others] of partners) {
      sp.on("pointerover", () => !this.host.animator.busy && others.forEach((o) => o.setEquipMark(true)));
      sp.on("pointerout", () => others.forEach((o) => o.setEquipMark(false)));
    }
  }

  private drawPile(side: 0 | 1, slot: Slot, count: number, top: CardView | null, contents?: CardView[], banished: CardView[] = []) {
    const h = this.host;
    const { x, y } = slotXY(side, slot);
    if (count) {
      const sp = new CardSprite(h.scene, x, y).show(top?.code ?? 0, h.cards.records.get(top?.code ?? 0), { back: !top });
      // Your own Deck opens a menu with FORFEIT.
      const ownDeck = side === 0 && slot.kind === "deck";
      sp.setInteractive({ useHandCursor: !!contents || ownDeck });
      if (ownDeck) sp.on("pointerup", () => h.openDeckMenu(sp));
      if (top) {
        sp.on("pointerover", () => h.panel.showInfo(top.code));
        sp.on("pointerout", () => h.panel.hoverEnd());
      }
      if (contents) sp.on("pointerup", () => h.browsePile(side, contents, banished, slot.kind === "extra" ? "extra" : "grave"));
      this.container.add([sp, this.badge(x + 19, y - 28, String(count), 1)]);
    }
    // Banished cards have no zone in this layout: a badge under the Graveyard, listed when browsing it.
    if (banished.length) this.container.add(this.badge(x + 19, y + 28, `B${banished.length}`, 1, 1));
  }

  /** Small white-on-black number, anchored by its (originX, originY) corner at (x, y). */
  private badge(x: number, y: number, label: string, originX: number, originY = 0): Phaser.GameObjects.Container {
    const scene = this.host.scene;
    const t = text(scene, 0, 0, label, { color: WHITE });
    const w = t.width + 4, h = 7;
    const left = Math.round(x - w * originX), top = Math.round(y - h * originY);
    t.setPosition(left + 2, top + 1);
    return scene.add.container(0, 0, [scene.add.rectangle(left, top, w, h, INK).setOrigin(0), t]);
  }

  private drawHand(side: 0 | 1, hand: CardView[]) {
    hand.forEach((c, i) => {
      const { x, y } = handXY(side, i, hand.length);
      const sp = this.cardSprite(c, x, y);
      if (side === 0) {
        // Hover lift. Skipped while animating, and for a sprite that has since left the hand (an
        // animation may be flying it to the field), so it never fights an animation.
        const k = cardKey(c);
        const lift = (dy: number) => {
          if (this.host.animator.busy || this.sprites.get(k) !== sp) return;
          this.host.scene.tweens.add({ targets: sp, y: y - dy, duration: 80 });
        };
        sp.on("pointerover", () => lift(6));
        sp.on("pointerout", () => lift(0));
      }
    });
  }

  private cardSprite(c: CardView, x: number, y: number): CardSprite {
    const h = this.host;
    const onField = c.location === OcgLocation.MZONE;
    const k = cardKey(c);
    // A hidden card revealed to you (e.g. by Confiscation) stays face-up until the animator flips it back.
    const revealed = h.animator.revealed.get(k);
    const code = revealed ?? c.code;
    // The AI's set cards with "AI CARDS" shown: face-up but faded, so they still read as set.
    const peek = h.revealOpponent && c.controller !== h.me && c.faceDown && c.code !== 0;
    const sp = new CardSprite(h.scene, x, y).show(code, h.cards.records.get(code), {
      // Face-down cards show the back, yours too; hovering your own still shows it in the info panel.
      back: !revealed && !peek && (c.code === 0 || c.faceDown),
      atk: onField ? c.attack : undefined, def: onField ? c.defense : undefined,
    });
    if (peek) sp.setAlpha(0.6);
    sp.setInteractive({ useHandCursor: true });
    // Field cards: the info panel lists their counters and keeps them current (see InfoPanel.refreshCounters).
    const fieldKey = c.location === OcgLocation.HAND ? null : k;
    sp.on("pointerover", () => code && h.panel.showInfo(code, c.counters, fieldKey));
    sp.on("pointerout", () => h.panel.hoverEnd());
    sp.on("pointerup", () => h.onCardClick(k));
    this.sprites.set(k, sp);
    this.container.add(sp);
    return sp;
  }
}
