// Rock-paper-scissors on the duel board, before the duel starts: both players draw ROCK, PAPER and SCISSORS,
// each sets one face-down in their middle Monster Zone, both flip together, and the winner chooses to go first
// or second (a draw: the cards go back to the hands and both pick again). The engine isn't running yet; who goes
// first decides the seats (seat 0 goes first).
import Phaser from "phaser";
import { RPS_HANDS, RPS_NAMES, rpsWinner, type RpsHand, type RpsOpponent } from "../../duel/rps.ts";
import { CardSprite } from "./CardSprite.ts";
import { T } from "./DuelAnimator.ts";
import { handXY, slotXY } from "./layout.ts";
import { pause, playTween } from "./tweens.ts";

/** Card art for the three hands: 3 frames 32x32 (rock, paper, scissors), shown in a token frame. */
export const RPS_SHEET = "rps";

export interface RpsHost {
  readonly scene: Phaser.Scene;
  readonly opponent: RpsOpponent;
  /** Animation speed multiplier (the duel's 1X/2X/4X). */
  speed(): number;
  /** Text in the field's prompt strip; null hides it. */
  prompt(label: string | null): void;
  /** A dialog with one button per label; resolves with the clicked index. */
  ask(message: string, buttons: string[]): Promise<number>;
  log(line: string): void;
  /** False once the duel was stopped (e.g. the opponent left); nothing more is played then. */
  active(): boolean;
}

const EASE = "Quad.easeOut";
/** Hover lift of your cards while picking, as in the duel's hand. */
const LIFT = 6;
/** Pauses: both cards set before they flip, the flipped result before the outcome. */
const BEFORE_FLIP = 350;

export class RpsIntro {
  private readonly host: RpsHost;
  private readonly layer: Phaser.GameObjects.Container;
  /** Hand cards by screen side; yours are index = hand (ROCK, PAPER, SCISSORS from the left). */
  private readonly hands: [CardSprite[], CardSprite[]] = [[], []];

  constructor(host: RpsHost) {
    this.host = host;
    this.layer = host.scene.add.container(0, 0);
  }

  /** Plays until someone wins and has chosen; resolves with whether you go first. */
  async run(): Promise<boolean> {
    await this.deal();
    for (;;) {
      const [mine, theirs] = await this.round();
      if (!this.host.active()) return new Promise(() => {}); // the duel was stopped: never continue
      const winner = rpsWinner(mine, theirs);
      const line = `Rock-paper-scissors: you ${RPS_NAMES[mine]}, opponent ${RPS_NAMES[theirs]}`;
      if (winner === null) {
        this.host.log(`${line}: a draw`);
        this.host.prompt("A DRAW! PICK AGAIN");
        await this.wait(T.confirmHold);
        await this.takeBack();
        continue;
      }
      this.host.log(`${line}: ${winner === 0 ? "you win" : "your opponent wins"}`);
      await this.flash(winner === 0 ? 1 : 0);
      const meFirst = await this.chooseOrder(winner === 0);
      this.host.log(meFirst ? "You go first" : "Your opponent goes first");
      await this.collect();
      return meFirst;
    }
  }

  /** Removes everything (also when the scene shuts down mid-game). */
  destroy() {
    this.layer.destroy();
  }

  // ---------------------------------------------------------------- steps

  /** A card back on each deck slot, then three cards each fly to the hands; yours open up as they land. */
  private async deal() {
    const flights: Promise<void>[] = [];
    for (const side of [0, 1] as const) {
      const deck = slotXY(side, { kind: "deck" });
      this.card(deck.x, deck.y); // the deck pile
      for (const hand of RPS_HANDS) {
        const sp = this.card(deck.x, deck.y);
        this.hands[side].push(sp);
        const to = handXY(side, hand, 3);
        flights.push(this.wait(hand * T.drawStagger).then(async () => {
          await this.tween({ targets: sp, x: to.x, y: to.y, duration: T.draw, ease: EASE });
          if (side === 0) this.face(sp, hand);
        }));
      }
    }
    await Promise.all(flights);
  }

  /** One round: you pick a card, the opponent picks theirs (in any order), then both flip. */
  private async round(): Promise<[RpsHand, RpsHand]> {
    const theirs = this.host.opponent.nextHand().then(async (hand) => {
      // Which of their face-down cards moves is only for show (it says nothing about the hand).
      await this.set(1, Math.floor(Math.random() * 3));
      return hand;
    });
    this.host.prompt("ROCK, PAPER OR SCISSORS? PICK A CARD");
    const mine = await this.pick();
    this.host.opponent.sendHand(mine);
    this.host.prompt(null);
    await this.set(0, mine);
    let waiting = true;
    void theirs.then(() => (waiting = false));
    await this.wait(0);
    if (waiting) this.host.prompt("WAITING FOR YOUR OPPONENT...");
    const hand = await theirs;
    this.host.prompt(null);
    await this.wait(BEFORE_FLIP);
    await Promise.all([this.flip(this.setCard(0), mine), this.flip(this.setCard(1), hand)]);
    await this.wait(T.confirmHold);
    return [mine, hand];
  }

  /** Your hand cards become clickable (lift on hover, no outline); resolves with the clicked one. */
  private pick(): Promise<RpsHand> {
    const cards = this.hands[0];
    return new Promise((resolve) => {
      cards.forEach((sp, hand) => {
        const y = handXY(0, hand, 3).y;
        sp.setInteractive({ useHandCursor: true });
        sp.on("pointerover", () => this.host.scene.tweens.add({ targets: sp, y: y - LIFT, duration: 80 }));
        sp.on("pointerout", () => this.host.scene.tweens.add({ targets: sp, y, duration: 80 }));
        sp.on("pointerup", () => {
          if (!this.host.active()) return;
          for (const c of cards) c.removeAllListeners().disableInteractive();
          resolve(hand as RpsHand);
        });
      });
    });
  }

  /** Sets hand card `index` of `side` face-down in that side's middle Monster Zone; the rest close up. */
  private async set(side: 0 | 1, index: number) {
    const sp = this.hands[side][index];
    const zone = slotXY(side, { kind: "mzone", seq: 2 });
    const rest = this.hands[side].filter((c) => c !== sp);
    rest.forEach((c, i) => {
      const p = handXY(side, i, rest.length);
      void this.tween({ targets: c, x: p.x, y: p.y, duration: T.relayout, ease: EASE });
    });
    sp.setData("set", true);
    if (side === 0) sp.show(0, undefined, { back: true });
    await this.tween({ targets: sp, x: zone.x, y: zone.y, duration: T.move, ease: EASE });
  }

  private setCard(side: 0 | 1): CardSprite {
    return this.hands[side].find((c) => c.getData("set"))!;
  }

  /** A draw: the set cards go back to the hands (the opponent's face-down again), in their original order. */
  private async takeBack() {
    this.host.prompt(null);
    await this.flip(this.setCard(1), null);
    const moves: Promise<void>[] = [];
    for (const side of [0, 1] as const) {
      this.setCard(side).setData("set", false);
      this.hands[side].forEach((c, i) => {
        const p = handXY(side, i, 3);
        moves.push(this.tween({ targets: c, x: p.x, y: p.y, duration: T.move, ease: EASE }));
      });
    }
    await Promise.all(moves);
  }

  /** The loser's card flashes red, like a destroyed card. */
  private async flash(loserSide: 0 | 1) {
    const sp = this.setCard(loserSide);
    const r = this.host.scene.add.rectangle(sp.x, sp.y, sp.w, sp.h, 0xff4444, 0.75);
    this.layer.add(r);
    await this.tween({ targets: r, alpha: 0, duration: T.flash, onComplete: () => r.destroy() });
  }

  /** The winner chooses; the other player is told what was chosen. Resolves with whether you go first. */
  private async chooseOrder(iWon: boolean): Promise<boolean> {
    if (iWon) {
      const meFirst = (await this.host.ask("YOU WIN!\nDO YOU WANT TO GO FIRST OR SECOND?", ["FIRST", "SECOND"])) === 0;
      this.host.opponent.sendOrder(meFirst);
      return meFirst;
    }
    this.host.prompt("YOUR OPPONENT WINS AND IS CHOOSING...");
    const theyFirst = await this.host.opponent.order();
    this.host.prompt(null);
    if (!this.host.active()) return new Promise(() => {});
    await this.host.ask(`YOUR OPPONENT WINS AND CHOOSES TO GO ${theyFirst ? "FIRST" : "SECOND"}.`, ["OK"]);
    return !theyFirst;
  }

  /** All cards fly back into the decks, then the layer goes (the duel draws its own board). */
  private async collect() {
    const flights: Promise<void>[] = [];
    for (const side of [0, 1] as const) {
      const deck = slotXY(side, { kind: "deck" });
      for (const sp of this.hands[side]) {
        sp.show(0, undefined, { back: true });
        flights.push(this.tween({ targets: sp, x: deck.x, y: deck.y, duration: T.move, ease: EASE }));
      }
    }
    await Promise.all(flights);
    this.destroy();
  }

  // ---------------------------------------------------------------- helpers

  private card(x: number, y: number): CardSprite {
    const sp = new CardSprite(this.host.scene, x, y).show(0, undefined, { back: true });
    this.layer.add(sp);
    return sp;
  }

  private face(sp: CardSprite, hand: RpsHand) {
    sp.showPlain("token", { key: RPS_SHEET, frame: hand }, RPS_NAMES[hand]);
  }

  /** Squashes the card to its centre line, shows `hand` (null = the back), opens it again. */
  private async flip(sp: CardSprite, hand: RpsHand | null) {
    await this.tween({ targets: sp, scaleX: 0, duration: T.flip });
    if (hand === null) sp.show(0, undefined, { back: true });
    else this.face(sp, hand);
    await this.tween({ targets: sp, scaleX: 1, duration: T.flip });
  }

  private tween(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return playTween(this.host.scene, config, this.host.speed());
  }

  private wait(ms: number): Promise<void> {
    return pause(this.host.scene, ms, this.host.speed());
  }
}
