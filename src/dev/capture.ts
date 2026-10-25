// Dev-only frame capture: pauses Phaser's own loop and steps the game at a fixed frame rate,
// saving every frame through the dev server (see vite.config.ts), so animations can be recorded
// smoothly even when the browser tab is hidden. Turn the frames into a GIF with tools/art/make-gif.mjs.
//
// From the browser console (dev build):
//   await captureClip(game, "draw", 2.5, () => pressSomething())
//   await captureClip(game, "moves", 8, [[0, () => press("3")], [2, () => press("4")]])  // timed actions (seconds)
import type Phaser from "phaser";

type Action = () => void;

export async function captureClip(game: Phaser.Game, name: string, seconds: number, actions?: Action | [number, Action][], fps = 30): Promise<number> {
  const dt = 1000 / fps;
  const frames = Math.round(seconds * fps);
  game.loop.sleep();
  let t = performance.now();
  try {
    const timed = typeof actions === "function" ? [[0, actions] as [number, Action]] : [...(actions ?? [])];
    for (let i = 0; i < frames; i++) {
      for (const [at, run] of timed) if (Math.round(at * fps) === i) run();
      t += dt;
      const img = await new Promise<HTMLImageElement>((resolve) => {
        game.renderer.snapshot((snap) => resolve(snap as HTMLImageElement));
        game.step(t, dt);
      });
      await img.decode?.().catch(() => undefined);
      const blob = await fetch(img.src).then((r) => r.blob());
      await fetch(`/__capture?name=${encodeURIComponent(name)}&i=${i}`, { method: "POST", body: blob });
      // Let promise-based animation code (awaiting tween completions) run between frames.
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    game.loop.wake();
  }
  return frames;
}

if (import.meta.env.DEV) (window as unknown as { captureClip: typeof captureClip }).captureClip = captureClip;
