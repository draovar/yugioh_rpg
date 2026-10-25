// Plays engine messages as animations on the currently displayed board.
// It only has to look right: after a batch finishes, DuelScene redraws the board from the
// engine snapshot, which corrects any drift (e.g. hand order after several cards leave).
import Phaser from "phaser";
import { OcgLocation, OcgMessageType, OcgPosition, type OcgMessage } from "ocgcore-wasm";
import type { CardDb } from "../duel/engine/cardData.ts";
import { REASON, type MoveMessage, type NewTurnMessage } from "../duel/engine/DuelSession.ts";
import { coinCallText, declarationText } from "../duel/engine/text.ts";
import { text } from "../ui/pixel.ts";
import { THEME } from "../ui/theme.ts";
import { CardSprite } from "./CardSprite.ts";
import { pause, playTween } from "./tweens.ts";
import { CARD, FIELD, FIELD_CENTER, ROWS, cardKey, handXY, slotXY } from "./layout.ts";

export interface AnimHost {
  readonly scene: Phaser.Scene;
  readonly cards: CardDb;
  /** Seat of the player on this machine: drawn at the bottom (side 0). */
  readonly me: 0 | 1;
  /** Displayed card sprites keyed `controller:location:sequence`; the animator re-keys them as cards move. */
  readonly sprites: Map<string, CardSprite>;
  /** Container the board lives in (cleared on every redraw, so temporary sprites go here too). */
  readonly board: Phaser.GameObjects.Container;
  /** Displayed hand sizes, kept in sync while animating. */
  readonly handCount: [number, number];
  /** Called with the engine phase bit on NEW_PHASE. */
  setPhase(phase: number): void;
  /** Animates the LP display of `player` to `lp`, with a floating `delta` label. */
  changeLP(player: number, lp: number, delta: number): Promise<void>;
  lp(player: number): number;
  /** Marks the declared attack (1px outlines on attacker / target); keys or null to clear. */
  markAttack(attacker: string | null, target: string | null): void;
  /** A message the player must acknowledge (text + OK dialog); resolves when closed. */
  notice(message: string): Promise<void>;
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

/** Coin toss sheet: 8 frames 32x32, a looping flip; frame 0 = heads, 4 = tails. */
export const COIN_SHEET = "coin-flip";
const COIN_FRAMES = 8, COIN_HEADS = 0, COIN_TAILS = 4;
/** Die sheet: 6 frames 16x16, faces 1..6 in order. */
export const DICE_SHEET = "dice";

/**
 * Timings (ms, at speed 1). Pixel-art style: quick, direct moves; no squash/stretch, no overshoot,
 * no in-between scales or angles. Faces swap instantly, rotations snap. Exception: a set Spell/Trap
 * flipping up to activate squashes to its centre line and opens on its face (like the card action menu).
 */
export const T = {
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
  /** Each half of a set Spell/Trap flipping face-up (squash, then open). */
  flip: 50,
  /** White (summon / hit) or red (destroyed) flash on a card. */
  flash: 240,
  /** Activated card shown at 2x in the middle of the field. */
  activateHold: 950,
  /** Cards revealed to a player (e.g. a searched card): flipped face-up in place (or yours lifted) this long. */
  confirmHold: 900,
  /** How far your own cards rise while revealed to the opponent. */
  confirmLift: 8,
  /** Hand shuffle: cards slide into a stack, rest there, then spread out in their new order. */
  shuffleGather: 180,
  shuffleHold: 140,
  shuffleSpread: 220,
  /** Screen shake when damage takes a player's LP to 0. */
  lethalShake: 300,
  /** Turn banner on screen. */
  banner: 1100,
  /** Coin toss / die roll: each frame while spinning, spin time (coin: minimum), then the result is held. */
  coinFrame: 60,
  diceFrame: 120,
  coinSpin: 700,
  diceSpin: 1000,
  tossHold: 800,
  /** A chain mark appearing: its ring spins one full turn and slows to a stop (the number stays still). */
  chainSpin: 450,
};
const EASE = "Quad.easeOut";

const turnLine = (turn: number | undefined) => (turn ? `TURN ${turn}` : undefined);

export class DuelAnimator {
  /** Global speed multiplier (2 = twice as fast). */
  speed = 1;
  /** True while messages are being animated (hover effects stay off meanwhile). */
  get busy(): boolean {
    return this.current !== null;
  }

  /** Sprite keys of the currently declared attack (attacker, target). */
  private attackKeys: [string | null, string | null] = [null, null];
  /** Message currently being animated (debugging aid). */
  current: OcgMessage | null = null;
  /** Card just flipped face-up (it already flashed, so a following FLIPSUMMONING doesn't flash again). */
  private justFlipped: string | null = null;
  /**
   * Hidden cards revealed to you (CONFIRM_CARDS) that are still face-up, by position: the scene's redraw
   * shows them face-up too, so e.g. Confiscation's prompt picks from the opponent's open hand.
   */
  readonly revealed = new Map<string, number>();
  /**
   * The open chain: sprite key of each link's card (index 0 = chain link 1). Once the chain is longer than one
   * link, each card shows a chain mark with its link number until that link resolves; a chain of one shows none.
   */
  readonly chainLinks: string[] = [];
  /** The open chain has reached two links: its marks are shown (until CHAIN_END). */
  private chainMarked = false;
  /** Links whose marks are shown (the scene's redraw puts them back): none for a chain of one. */
  get markedChainLinks(): readonly string[] {
    return this.chainMarked ? this.chainLinks : [];
  }
  /** The same cards' sprites while animating (sprites survive hand re-keying, positions don't). */
  private revealedSprites = new Set<CardSprite>();
  private readonly host: AnimHost;

  constructor(host: AnimHost) {
    this.host = host;
  }

  /** Screen side of a player: 0 = you (bottom), 1 = opponent (top). */
  private side(player: number): 0 | 1 {
    return player === this.host.me ? 0 : 1;
  }

  /** Animates `messages` in order; `onMessage` runs as each one starts (e.g. to log it). */
  async play(messages: OcgMessage[], onMessage?: (m: OcgMessage) => void): Promise<void> {
    const h = this.host;
    this.revealedSprites = new Set([...this.revealed.keys()].map((k) => h.sprites.get(k)).filter((sp): sp is CardSprite => !!sp));
    for (const m of messages) {
      onMessage?.(m);
      this.current = m;
      if (this.revealedSprites.size) await this.beforeRevealed(m);
      await this.playOne(m);
    }
    this.current = null;
    // Still face-up (only hints followed: a prompt about them comes next): remember where they are now.
    this.revealed.clear();
    for (const [k, sp] of h.sprites) if (this.revealedSprites.has(sp)) this.revealed.set(k, sp.code);
  }

  /**
   * Revealed cards stay face-up through hints and flip face-down again before anything else happens,
   * except a revealed card that is moving away (e.g. the one Confiscation discards): it leaves face-up.
   */
  private async beforeRevealed(m: OcgMessage): Promise<void> {
    if (m.type === OcgMessageType.HINT || m.type === OcgMessageType.CARD_HINT || m.type === OcgMessageType.CONFIRM_CARDS) return;
    // The prompt ending the batch (e.g. Confiscation's card choice) is asked with them face-up.
    if (/^(SELECT|ANNOUNCE|SORT)_/.test(OcgMessageType[m.type] ?? "")) return;
    if (m.type === OcgMessageType.MOVE) {
      const sp = this.host.sprites.get(cardKey(m.from));
      if (sp && this.revealedSprites.delete(sp)) return;
    }
    await this.hideRevealed();
  }

  private async hideRevealed(): Promise<void> {
    const sprites = [...this.revealedSprites];
    this.revealedSprites.clear();
    this.revealed.clear();
    await Promise.all(sprites.map((sp) => this.flipReveal(sp, 0)));
  }

  private async playOne(m: OcgMessage): Promise<void> {
    const h = this.host;
    if (m.type !== OcgMessageType.POS_CHANGE && m.type !== OcgMessageType.FLIPSUMMONING) this.justFlipped = null;
    switch (m.type) {
      case OcgMessageType.NEW_TURN:
        this.clearAttack();
        return this.banner(m.player === h.me ? "YOUR TURN" : "OPPONENT'S TURN", turnLine((m as NewTurnMessage).turn), m.player === h.me ? THEME.banner.mine : THEME.banner.theirs);
      case OcgMessageType.HINT: {
        // After a declaration the engine hints what was declared (player = who declared). The opponent's
        // declaration waits for an OK (text only, also for card names); your own is only logged. A coin call
        // (heads / tails, before the toss) works the same way.
        if (m.player === h.me) return;
        const call = coinCallText(m.hint_type, m.hint);
        if (call) return h.notice(`Your opponent called:\n${call}`);
        const what = declarationText(m.hint_type, m.hint, (code) => h.cards.name(code));
        if (what === null) return;
        return h.notice(`Your opponent declared:\n${what}`);
      }
      case OcgMessageType.NEW_PHASE:
        if (!(m.phase & 0xf8)) this.clearAttack(); // left the battle phase
        h.setPhase(m.phase);
        return this.wait(120);
      case OcgMessageType.DRAW:
        return this.draw(m.player, m.drawn.map((d) => d.code));
      case OcgMessageType.MOVE:
        this.followChainLink(cardKey(m.from), cardKey(m.to));
        return this.move(m.card, m.from, m.to, ((m as MoveMessage).reason ?? 0) & REASON.DESTROY ? "destroyed" : null);
      case OcgMessageType.SUMMONING:
      case OcgMessageType.SPSUMMONING:
      case OcgMessageType.FLIPSUMMONING:
        // A Flip Summon's flip already flashed (see posChange); don't flash twice.
        if (m.type === OcgMessageType.FLIPSUMMONING && this.justFlipped === cardKey(m)) return;
        return this.summonBurst(m, m.type === OcgMessageType.SPSUMMONING ? 0x5aa8ff : 0xfff2a8);
      case OcgMessageType.POS_CHANGE:
        return this.posChange(m, m.code, m.prev_position, m.position);
      case OcgMessageType.CONFIRM_CARDS:
        return this.confirm(m.player, m.cards);
      case OcgMessageType.SHUFFLE_HAND:
        return this.shuffleHand(m.player, m.cards);
      case OcgMessageType.CHAINING:
        await this.activate(m, m.code);
        this.chainLinks.push(cardKey(m));
        if (this.chainLinks.length > 1) this.chainMarked = true;
        // The second link also marks the first; marks spin in as they appear.
        return this.showChainMarks(this.chainLinks.length === 2 ? [0, 1] : [this.chainLinks.length - 1]);
      case OcgMessageType.CHAIN_SOLVED: {
        // The link resolved: its mark goes (the card may still be on the field, e.g. a Continuous Trap).
        const k = this.chainLinks[m.chain_size - 1];
        if (k !== undefined) h.sprites.get(k)?.setChainMark(null);
        this.chainLinks.length = Math.min(this.chainLinks.length, m.chain_size - 1);
        return;
      }
      case OcgMessageType.CHAIN_END:
        for (const k of this.chainLinks) h.sprites.get(k)?.setChainMark(null);
        this.chainLinks.length = 0;
        this.chainMarked = false;
        return;
      case OcgMessageType.ATTACK:
        // Declaration: only mark attacker and target; the lunge plays at the hit (BATTLE).
        this.attackKeys = [cardKey(m.card), m.target ? cardKey(m.target) : null];
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
      case OcgMessageType.TOSS_COIN:
        return this.toss(m.results.map((heads) => (heads ? COIN_HEADS : COIN_TAILS)), COIN_SHEET);
      case OcgMessageType.TOSS_DICE:
        return this.toss(m.results.map((n) => n - 1), DICE_SHEET);
      case OcgMessageType.LPUPDATE:
        // LP set to a value (e.g. by an effect): show the difference like any other change.
        return h.changeLP(m.player, m.lp, m.lp - h.lp(m.player));
    }
  }

  // ---------------------------------------------------------------- individual animations

  private async draw(player: number, codes: number[]): Promise<void> {
    const h = this.host;
    const side = this.side(player);
    const deck = slotXY(side, { kind: "deck" });
    // Every card goes straight to its place in the final hand, so the hand doesn't re-space mid-draw.
    const first = h.handCount[side];
    const finalCount = first + codes.length;
    this.relayoutHand(side, finalCount);
    h.handCount[side] = finalCount;
    const flights = codes.map((code, i) => {
      const target = handXY(side, first + i, finalCount);
      const sp = this.tempSprite(deck.x, deck.y, 0);
      h.sprites.set(cardKey({ controller: player, location: OcgLocation.HAND, sequence: first + i }), sp);
      return this.wait(i * T.drawStagger).then(async () => {
        await this.tween({ targets: sp, x: target.x, y: target.y, duration: T.draw, ease: EASE });
        if (player === h.me) this.reveal(sp, code);
      });
    });
    await Promise.all(flights);
  }

  private async move(code: number, from: Loc, to: Loc, cause: "destroyed" | null = null): Promise<void> {
    const h = this.host;
    const dest = this.locXY(to);
    if (!dest) return;
    if (this.attackKeys.includes(cardKey(from))) this.clearAttack();
    let sp = this.findSprite(from, code);
    if (sp) {
      h.sprites.delete(cardKey(from));
    } else {
      const src = this.locXY(from);
      if (!src) return;
      sp = this.tempSprite(src.x, src.y, this.visible(code, from) ? code : 0);
    }
    if (from.location === OcgLocation.HAND) {
      h.handCount[this.side(from.controller)]--;
      this.rekeyHand(from.controller);
      this.relayoutHand(this.side(from.controller));
    }
    const toHand = to.location === OcgLocation.HAND;
    const toSide = this.side(to.controller);
    const target = toHand ? handXY(toSide, h.handCount[toSide]++, h.handCount[toSide]) : dest;
    if (toHand) this.relayoutHand(toSide);

    // Destroyed cards (by battle or effect) flash red before leaving; other moves to the GY don't.
    if (cause === "destroyed") await this.flash(sp, 0xff4444);
    h.board.bringToTop(sp);
    const showCode = this.visible(code, to) ? code : 0;
    // Going face-down (a Set): turn to the back as it leaves, like placing a real card face-down.
    if (!showCode && sp.code) this.reveal(sp, 0);
    // Rotate into defense position (or back to attack) while flying.
    const angle = to.location === OcgLocation.MZONE && (to.position ?? 0) & DEFENSE ? 90 : 0;
    await this.tween({ targets: sp, x: target.x, y: target.y, angle, duration: T.move, ease: EASE });
    // Becoming visible (e.g. a monster summoned face-up from the hand of the opponent): reveal on landing.
    if (showCode !== sp.code) this.reveal(sp, showCode);
    h.sprites.set(cardKey(to), sp);
    if (toHand) this.rekeyHand(to.controller);
  }

  /** Summoned card flashes (white for Normal/Flip, blue for Special Summons). */
  private async summonBurst(l: Loc, color: number): Promise<void> {
    const sp = this.host.sprites.get(cardKey(l));
    if (sp) await this.flash(sp, color);
  }

  /**
   * Attack <-> defense: rotate smoothly, change face at the end. A card flipped face-up (Flip Summon,
   * or a set monster that got attacked) then flashes white, like a summon.
   */
  private async posChange(l: Loc, code: number, prevPosition: number, position: number): Promise<void> {
    const sp = this.host.sprites.get(cardKey(l));
    if (!sp) return;
    // Only monsters have attack/defense orientation; Spell/Trap cards stay upright (their position bits
    // still say "defense" while set, e.g. when a set card is flipped up to be activated).
    const monster = l.location === OcgLocation.MZONE;
    const angle = monster && position & DEFENSE ? 90 : 0;
    if (sp.angle !== angle) await this.tween({ targets: sp, angle, duration: T.rotate, ease: "Sine.easeInOut" });
    const showCode = this.visible(code, { ...l, position }) ? code : 0;
    if (showCode !== sp.code) {
      // A set Spell/Trap turning face-up (to activate) flips over; everything else swaps instantly.
      if (!monster && showCode && !sp.code) await this.flipReveal(sp, showCode);
      else this.reveal(sp, showCode);
    }
    // A monster flipped face-up flashes like a summon; Spells/Traps flash when they activate instead.
    if (monster && prevPosition & FACEDOWN && !(position & FACEDOWN)) {
      this.justFlipped = cardKey(l);
      await this.flash(sp, 0xfff2a8);
    }
  }

  /** The activated card is shown at exactly 2x in the middle of the field for a moment. */
  private async activate(l: Loc, code: number): Promise<void> {
    const h = this.host;
    const src = h.sprites.get(cardKey(l));
    if (src && src.code !== code) await this.flipReveal(src, code); // face-down card being activated
    if (src) await this.flash(src, 0xffffff);
    const big = new CardSprite(h.scene, FIELD_CENTER.x, FIELD_CENTER.y).show(code, h.cards.records.get(code)).setScale(2).setDepth(600);
    await this.wait(T.activateHold);
    big.destroy();
  }

  /**
   * Coin tosses / die rolls in the middle of the field at 2x, side by side if several, over the dialogs' shade:
   * the coin loops its flip, the die shows random faces, then each stops on its result (a frame index) and holds it.
   */
  private async toss(results: number[], sheet: string): Promise<void> {
    if (!results.length) return;
    const h = this.host;
    const coin = sheet === COIN_SHEET;
    const size = coin ? 64 : 32, pitch = size + 8;
    const left = FIELD_CENTER.x - ((results.length - 1) * pitch) / 2;
    const shade = h.scene.add.rectangle(0, 0, 640, 360, 0x000000, THEME.shadeAlpha).setOrigin(0).setDepth(599);
    const sprites = results.map((_, i) => h.scene.add.image(Math.round(left + i * pitch), FIELD_CENTER.y, sheet, 0).setScale(2).setDepth(600));
    const frame = coin ? T.coinFrame : T.diceFrame;
    const steps = Math.ceil((coin ? T.coinSpin : T.diceSpin) / frame);
    // The coin keeps flipping until it lands on its face; the die never shows the same face twice in a row.
    const coinSteps = results.map((r) => steps + ((r - steps) % COIN_FRAMES + COIN_FRAMES) % COIN_FRAMES);
    const total = coin ? Math.max(...coinSteps) : steps;
    let faces = results.map(() => 0);
    for (let step = 1; step <= total; step++) {
      await this.wait(frame);
      faces = faces.map((f, i) => {
        if (coin) return step <= coinSteps[i] ? step % COIN_FRAMES : results[i];
        if (step === total) return results[i];
        const next = Math.floor(Math.random() * 5);
        return next >= f ? next + 1 : next;
      });
      sprites.forEach((sp, i) => sp.setFrame(faces[i]));
    }
    await this.wait(T.tossHold);
    for (const sp of sprites) sp.destroy();
    shade.destroy();
  }

  /**
   * Cards revealed to `viewer` (CONFIRM_CARDS: a searched card, Confiscation's look at the hand...), in
   * place: hidden cards revealed to you flip face-up and stay up (see `beforeRevealed`); your own cards
   * revealed to the opponent rise a little for a moment. Cards not on the board (e.g. in the Deck) are
   * shown side by side in the middle of the field.
   */
  private async confirm(viewer: number, cards: (Loc & { code: number })[]): Promise<void> {
    const h = this.host;
    const anims: Promise<void>[] = [], lifted: CardSprite[] = [], offBoard: number[] = [];
    for (const c of cards) {
      // Only what this screen's player may see: cards revealed to you, or your own.
      if (viewer !== h.me && c.controller !== h.me) continue;
      const sp = h.sprites.get(cardKey(c));
      if (!sp) offBoard.push(c.code);
      else if (viewer === h.me && sp.code === 0 && c.code) {
        this.revealedSprites.add(sp);
        anims.push(this.flipReveal(sp, c.code));
      } else if (viewer !== h.me) {
        lifted.push(sp);
        anims.push(this.tween({ targets: sp, y: sp.y - T.confirmLift, duration: T.relayout, ease: EASE }));
      }
    }
    if (anims.length) {
      await Promise.all(anims);
      await this.wait(T.confirmHold);
      await Promise.all(lifted.map((sp) => this.tween({ targets: sp, y: sp.y + T.confirmLift, duration: T.relayout, ease: EASE })));
    }
    await this.confirmOffBoard(offBoard);
  }

  /** Revealed cards with no sprite: shown side by side at 2x in the middle of the field (1x if more than four). */
  private async confirmOffBoard(codes: number[]): Promise<void> {
    const h = this.host;
    const shown = codes.filter((c) => c && h.cards.records.has(c));
    if (!shown.length) return;
    const scale = shown.length > 4 ? 1 : 2, pitch = CARD.w * scale + 4;
    const left = FIELD_CENTER.x - ((shown.length - 1) * pitch) / 2;
    const big = shown.map((code, i) =>
      new CardSprite(h.scene, Math.round(left + i * pitch), FIELD_CENTER.y).show(code, h.cards.records.get(code)).setScale(scale).setDepth(600));
    await this.wait(T.confirmHold);
    for (const b of big) b.destroy();
  }

  /**
   * SHUFFLE_HAND: the player's hand cards slide together into a stack at the hand's centre, rest, then spread
   * out in their new order (`codes`, the hand after the shuffle; matched to the shown faces so the redraw that
   * follows doesn't move anything; face-down cards just fill the remaining spots). Re-keys the sprites.
   */
  private async shuffleHand(player: number, codes: number[]): Promise<void> {
    const h = this.host;
    const side = this.side(player);
    const n = h.handCount[side];
    const handKey = (i: number) => cardKey({ controller: player, location: OcgLocation.HAND, sequence: i });
    const sprites = Array.from({ length: n }, (_, i) => h.sprites.get(handKey(i))).filter((sp): sp is CardSprite => !!sp);
    if (sprites.length < 2) return;
    const center = handXY(side, 0, 1);
    await Promise.all(sprites.map((sp) => this.tween({ targets: sp, x: center.x, y: center.y, duration: T.shuffleGather, ease: EASE })));
    await this.wait(T.shuffleHold);
    // New order: first every face-up card at the spot of its code, then the rest (backs) fill the gaps.
    const pool = [...sprites];
    const slots: (CardSprite | null)[] = codes.slice(0, sprites.length).map((code) => {
      const j = pool.findIndex((sp) => sp.code !== 0 && sp.code === code);
      return j >= 0 ? pool.splice(j, 1)[0] : null;
    });
    const order = slots.map((sp) => sp ?? pool.shift()!);
    order.push(...pool); // codes shorter than the shown hand (shouldn't happen)
    order.forEach((sp, i) => h.sprites.set(handKey(i), sp));
    await Promise.all(order.map((sp, i) => {
      const to = handXY(side, i, order.length);
      return this.tween({ targets: sp, x: to.x, y: to.y, duration: T.shuffleSpread, ease: EASE });
    }));
  }

  private async attack(card: Loc, target: Loc | null): Promise<void> {
    const h = this.host;
    const sp = h.sprites.get(cardKey(card));
    if (!sp) return;
    const to = target ? this.locXY(target) : { x: FIELD_CENTER.x, y: card.controller === h.me ? ROWS.oppHand : ROWS.myHand };
    if (!to) return;
    h.board.bringToTop(sp);
    const sx = sp.x, sy = sp.y;
    await this.tween({ targets: sp, x: sx + (to.x - sx) * 0.7, y: sy + (to.y - sy) * 0.7, duration: T.lunge, ease: "Quad.easeIn" });
    if (target) {
      const victim = h.sprites.get(cardKey(target));
      if (victim) void this.flash(victim, 0xffffff);
    }
    await this.tween({ targets: sp, x: sx, y: sy, duration: T.lunge, ease: EASE });
  }

  /**
   * Turn banner: a coloured band across the field, on and off without transitions. A pixel plate: 1px
   * lighter line on top, darker at the bottom; the big text has a 1px dark drop shadow, the turn number
   * sits small under it.
   */
  private async banner(label: string, sub: string | undefined, look: { fill: number; light: number; dark: number }): Promise<void> {
    const s = this.host.scene;
    const h = sub ? 26 : 18;
    const top = FIELD_CENTER.y - Math.floor(h / 2), w = FIELD.right - FIELD.left;
    const g = s.add.graphics().setDepth(700);
    g.fillStyle(look.fill, 0.9).fillRect(FIELD.left, top, w, h);
    g.fillStyle(look.light).fillRect(FIELD.left, top, w, 1);
    g.fillStyle(look.dark).fillRect(FIELD.left, top + h - 1, w, 1);
    const parts: Phaser.GameObjects.GameObject[] = [g];
    const big = (dx: number, dy: number, color: number) =>
      parts.push(text(s, FIELD_CENTER.x + dx, top + 4 + dy, label, { color, scale: 2, originX: 0.5 }).setDepth(701));
    big(1, 1, look.dark);
    big(0, 0, 0xffffff);
    if (sub) parts.push(text(s, FIELD_CENTER.x, top + 17, sub, { color: look.light, originX: 0.5 }).setDepth(701));
    await this.wait(T.banner);
    for (const p of parts) p.destroy();
  }

  // ---------------------------------------------------------------- helpers

  private clearAttack() {
    if (!this.attackKeys[0] && !this.attackKeys[1]) return;
    this.attackKeys = [null, null];
    this.host.markAttack(null, null);
  }

  /** Puts chain marks on the cards of the given links (indexes into the open chain) and spins their rings in. */
  private async showChainMarks(links: number[]): Promise<void> {
    if (!this.chainMarked) return;
    const rings = links.map((i) => this.host.sprites.get(this.chainLinks[i])?.setChainMark(i + 1).chainRing);
    await Promise.all(rings.map((ring) =>
      ring && this.tween({ targets: ring, angle: { from: 0, to: 360 }, duration: T.chainSpin, ease: "Cubic.easeOut", onComplete: () => ring.setAngle(0) })));
  }

  /** A chained card moving (e.g. sent to the GY as a cost) keeps its link: the mark travels with its sprite. */
  private followChainLink(from: string, to: string) {
    const i = this.chainLinks.lastIndexOf(from);
    if (i >= 0) this.chainLinks[i] = to;
  }

  /** Whether a card at `l` is drawn face-up. Face-down cards on the field show their back for everyone. */
  private visible(code: number, l: Loc): boolean {
    if (!code) return false;
    if (l.location & (OcgLocation.GRAVE | OcgLocation.REMOVED)) return true;
    if (l.location & ON_FIELD) return !this.faceDown(l);
    if (l.controller === this.host.me) return l.location !== OcgLocation.DECK;
    return false; // opponent's hand / deck / extra deck
  }

  private faceDown(l: Loc): boolean {
    return ((l.position ?? 0) & FACEDOWN) !== 0;
  }

  private locXY(l: Loc): { x: number; y: number } | null {
    const side = this.side(l.controller);
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
    const sp = this.host.sprites.get(cardKey(l));
    if (l.location !== OcgLocation.HAND || !code || sp?.code === code) return sp;
    for (const [k, s] of this.host.sprites) {
      if (k.startsWith(`${l.controller}:${OcgLocation.HAND}:`) && s.code === code) {
        this.host.sprites.delete(k);
        this.host.sprites.set(cardKey(l), s);
        return s;
      }
    }
    return sp;
  }

  /** A player's hand sprites with their keys, left to right. */
  private handSprites(controller: number): [string, CardSprite][] {
    const prefix = `${controller}:${OcgLocation.HAND}:`;
    return [...this.host.sprites].filter(([k]) => k.startsWith(prefix)).sort((a, b) => a[1].x - b[1].x);
  }

  /** Re-numbers a player's hand sprites 0..n-1 in left-to-right order. */
  private rekeyHand(controller: number) {
    const prefix = `${controller}:${OcgLocation.HAND}:`;
    const hand = this.handSprites(controller);
    for (const [k] of hand) this.host.sprites.delete(k);
    hand.forEach(([, s], i) => this.host.sprites.set(prefix + i, s));
  }

  /** Slides the cards already in a hand to their positions for a hand of `n` cards (default: current size). */
  private relayoutHand(side: 0 | 1, n = this.host.handCount[side]) {
    const me = this.host.me;
    const hand = this.handSprites(side === 0 ? me : 1 - me);
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

  /** Shows another face (or the back) instantly: no squash/stretch flip. */
  private reveal(sp: CardSprite, code: number) {
    sp.show(code, this.host.cards.records.get(code), { back: !code });
  }

  /** Squashes the card to its centre line, swaps the face, opens it again. */
  private async flipReveal(sp: CardSprite, code: number): Promise<void> {
    await this.tween({ targets: sp, scaleX: 0, duration: T.flip });
    this.reveal(sp, code);
    await this.tween({ targets: sp, scaleX: 1, duration: T.flip });
  }

  private async flash(sp: CardSprite, color: number): Promise<void> {
    const r = this.host.scene.add.rectangle(sp.x, sp.y, sp.w, sp.h, color, 0.75).setAngle(sp.angle);
    this.host.board.add(r);
    await this.tween({ targets: r, alpha: 0, duration: T.flash, onComplete: () => r.destroy() });
  }

  private tween(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return playTween(this.host.scene, config, this.speed);
  }

  private wait(ms: number): Promise<void> {
    return pause(this.host.scene, ms, this.speed);
  }
}
