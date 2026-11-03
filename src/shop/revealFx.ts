// The show a turned card makes by rarity (the pack opening, the deck unboxing): a Rare flashes; Super Rares and up
// first shake with a pulsing glow in their rarity's colour, then flash and burst into sparkles; Ultra and Secret Rares
// also flash the screen and get a shine across them now and then; a Secret Rare's glow and sparkles run through the
// colours. Each effect draws into the opening's current `layer` (the ones on the card just above its sprite, so cards
// drawn after it cover them too); the ones that run on (glows, shines) go in `loops` so the opening can stop them when
// the cards are put away.
import Phaser from "phaser";
import { pause, playTween } from "../duel-screen/tweens.ts";

export interface FxHost {
  scene: Phaser.Scene;
  layer: Phaser.GameObjects.Container;
  loops: (Phaser.Time.TimerEvent | Phaser.Tweens.Tween)[];
  /** The opening was closed: a shine waiting for its turn doesn't start. */
  closed: () => boolean;
}

/**
 * A card on screen: its centre, its size (as drawn) and its sprite (shaken, shone across while it's still there).
 * `tight`: packed against other cards (the deck's mat), so its glow runs along its own edge instead of around it.
 */
export interface FxCard {
  x: number;
  y: number;
  w: number;
  h: number;
  sprite: Phaser.GameObjects.Container;
  tight?: boolean;
}

/** An effect on the card itself goes just above its sprite: cards drawn after it (overlapping ones) cover it too. */
function onCard(host: FxHost, c: FxCard, obj: Phaser.GameObjects.GameObject) {
  host.layer.addAt(obj, host.layer.getIndex(c.sprite) + 1);
}

export const FX_T = { shake: 45, flash: 250, screenFlash: 300, sparkle: 550, shine: 450, shineEvery: 2600 };
/** Sparkles a reveal bursts into, by rarity tier (0 = commons ... 4 = Secret Rare). */
export const SPARKLES = [0, 0, 8, 12, 16];

/** Anticipation: the card trembles a pixel each way. */
export async function shake(host: FxHost, c: FxCard) {
  for (const dx of [1, -1, 1, -1, 1, -1, 0]) {
    c.sprite.x = c.x + dx;
    await pause(host.scene, FX_T.shake, 1);
  }
}

/** A pulsing 2px border around the card (a tight one: along its edge); a Secret Rare's runs through the colours. */
export function glow(host: FxHost, c: FxCard, color: number, rainbow: boolean) {
  const g = host.scene.add.graphics();
  onCard(host, c, g);
  const out = c.tight ? 0 : 2;
  const draw = (col: number) => {
    const l = c.x - c.w / 2 - out, t = c.y - c.h / 2 - out, w = c.w + 2 * out, h = c.h + 2 * out;
    g.clear().fillStyle(col).fillRect(l, t, w, 2).fillRect(l, t + h - 2, w, 2).fillRect(l, t + 2, 2, h - 4).fillRect(l + w - 2, t + 2, 2, h - 4);
  };
  draw(color);
  host.loops.push(host.scene.tweens.add({ targets: g, alpha: 0.4, duration: 500, yoyo: true, repeat: -1 }));
  if (rainbow) {
    const hue = { h: 0 };
    host.loops.push(host.scene.tweens.add({
      targets: hue, h: 1, duration: 1200, repeat: -1, onUpdate: () => draw(Phaser.Display.Color.HSVToRGB(hue.h, 0.55, 1).color),
    }));
  }
}

export function flash(host: FxHost, c: FxCard) {
  const r = host.scene.add.rectangle(c.x, c.y, c.w, c.h, 0xffffff, 0.8);
  onCard(host, c, r);
  void playTween(host.scene, { targets: r, alpha: 0, duration: FX_T.flash, onComplete: () => r.destroy() }, 1);
}

export function screenFlash(host: FxHost) {
  const r = host.scene.add.rectangle(0, 0, 640, 360, 0xffffff, 0.35).setOrigin(0);
  host.layer.add(r);
  void playTween(host.scene, { targets: r, alpha: 0, duration: FX_T.screenFlash, onComplete: () => r.destroy() }, 1);
}

/**
 * Plus-shaped sparkles flying out from the card, in its rarity's colour and white (any colour for a Secret Rare), as
 * far as the card is wide (60-100 px from a card 76 px wide).
 */
export function sparkles(host: FxHost, c: FxCard, color: number, n: number, rainbow: boolean) {
  const reach = c.w / 76;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 + Math.random() * 0.4, dist = (60 + Math.random() * 40) * reach;
    const col = rainbow ? Phaser.Display.Color.HSVToRGB(Math.random(), 0.55, 1).color : i % 2 ? 0xffffff : color;
    const g = host.scene.add.graphics({ x: c.x, y: c.y }).fillStyle(col).fillRect(-2, 0, 5, 1).fillRect(0, -2, 1, 5);
    host.layer.add(g);
    void playTween(host.scene, {
      targets: g, x: c.x + Math.cos(angle) * dist, y: c.y + Math.sin(angle) * dist, alpha: 0,
      duration: FX_T.sparkle * (0.8 + Math.random() * 0.4), ease: "Quad.Out", onComplete: () => g.destroy(),
    }, 1);
  }
}

/** A slanted band of light sweeping across the card face (clipped to the card), its width scaled with the card. */
export function shine(host: FxHost, c: FxCard) {
  if (host.closed() || !c.sprite.active) return;
  const g = host.scene.add.graphics();
  onCard(host, c, g);
  const left = c.x - c.w / 2, top = c.y - c.h / 2, band = Math.round(c.w * 10 / 76), slant = 0.4;
  const sweep = { p: 0 };
  host.loops.push(host.scene.tweens.add({
    targets: sweep, p: 1, duration: FX_T.shine,
    onUpdate: () => {
      const start = left - band - c.h * slant + sweep.p * (c.w + band + c.h * slant);
      g.clear().fillStyle(0xffffff, 0.45);
      for (let r = 0; r < c.h; r++) {
        const x0 = Math.max(left, Math.round(start + r * slant)), x1 = Math.min(left + c.w, Math.round(start + r * slant) + band);
        if (x1 > x0) g.fillRect(x0, top + r, x1 - x0, 1);
      }
    },
    onComplete: () => g.destroy(),
  }));
}

/** After the card's face is up: a Rare and up flash; Super Rares and up sparkle; Ultra / Secret Rares flash the screen and shine every few seconds. */
export function revealShow(host: FxHost, c: FxCard, look: { color: number; tier: number }) {
  if (look.tier >= 1) flash(host, c);
  if (look.tier >= 2) sparkles(host, c, look.color, SPARKLES[look.tier], look.tier >= 4);
  if (look.tier >= 3) {
    screenFlash(host);
    shine(host, c);
    host.loops.push(host.scene.time.addEvent({ delay: FX_T.shineEvery, loop: true, callback: () => shine(host, c) }));
  }
}
