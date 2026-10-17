import Phaser from "phaser";

/** A phone or tablet (coarse pointer), or `&touch` to try the touch controls on a desktop. */
export const TOUCH = window.matchMedia("(pointer: coarse)").matches || new URLSearchParams(location.search).has("touch");

/** Full screen (where the browser allows it: not on iPhones, where the home-screen app is the way), landscape if it can. */
export function enterFullscreen(game: Phaser.Game) {
  if (!game.scale.fullscreen.available || game.scale.isFullscreen) return;
  game.scale.startFullscreen();
  const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  orientation.lock?.("landscape").catch(() => { /* not supported / not allowed */ });
}

/**
 * On touch devices the first tap anywhere goes full screen (browsers only allow it from a tap). Leaving full screen
 * afterwards sticks; the world menu's FULL SCREEN button brings it back.
 */
export function fullscreenOnFirstTap(game: Phaser.Game) {
  if (!TOUCH) return;
  document.addEventListener("pointerup", () => enterFullscreen(game), { once: true });
}
