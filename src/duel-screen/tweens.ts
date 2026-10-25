// Promise-based tweens and pauses for the duel's animations (DuelAnimator, RpsIntro), scaled by the animation speed.
import Phaser from "phaser";

/**
 * Plays a tween and resolves when it completes; its duration (default 200ms) is divided by `speed`. The animation
 * takes over its targets: anything else moving them (e.g. the hand's hover lift) is stopped first.
 */
export function playTween(scene: Phaser.Scene, config: Phaser.Types.Tweens.TweenBuilderConfig, speed: number): Promise<void> {
  scene.tweens.killTweensOf(config.targets);
  return new Promise((resolve) => {
    const onComplete = config.onComplete;
    scene.tweens.add({
      ...config,
      duration: ((config.duration as number) ?? 200) / speed,
      onComplete: (...args: unknown[]) => {
        (onComplete as ((...a: unknown[]) => void) | undefined)?.(...args);
        resolve();
      },
    });
  });
}

/** Resolves after `ms` (divided by `speed`) of game time. */
export function pause(scene: Phaser.Scene, ms: number, speed: number): Promise<void> {
  return new Promise((resolve) => scene.time.delayedCall(ms / speed, resolve));
}
