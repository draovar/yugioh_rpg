import Phaser from "phaser";
import type { DuelAnimator } from "./DuelAnimator.ts";
import type { InfoPanel } from "./InfoPanel.ts";
import { CARD } from "./layout.ts";
import { ANIM_SPEEDS, CHAIN_MODES, chainMode, setAnimSpeed, setChainMode } from "../ui/prefs.ts";
import { makeWoodButton } from "../ui/widgets.ts";

/**
 * Top-right corner of the field, stacked in the space above the mat (top 59): animation speed
 * (1x/2x/4x), the info panel's LOG/CARD toggle and the chain mode (AUTO/ALL/OFF: when you're asked to
 * chain). All the same width; right edges line up with the right pile column (card centre 614).
 */
export function createCornerButtons(scene: Phaser.Scene, animator: DuelAnimator, panel: InfoPanel) {
  const top = 1, pitch = 18 + 1, w = 24;
  const x = 614 + CARD.w / 2 - w;
  const speed = makeWoodButton(scene, x, top, w, `${animator.speed}X`, () => {
    animator.speed = ANIM_SPEEDS[(ANIM_SPEEDS.indexOf(animator.speed) + 1) % ANIM_SPEEDS.length];
    speed.setLabel(`${animator.speed}X`);
    setAnimSpeed(animator.speed);
  });
  // Switch the info panel between card mode and log mode.
  const panelToggle = makeWoodButton(scene, x, top + pitch, w, "LOG", () => {
    panelToggle.setLabel(panel.toggleMode() === "card" ? "LOG" : "CARD");
  });
  const chainLabel = () => chainMode().toUpperCase();
  const chain = makeWoodButton(scene, x, top + 2 * pitch, w, chainLabel(), () => {
    setChainMode(CHAIN_MODES[(CHAIN_MODES.indexOf(chainMode()) + 1) % CHAIN_MODES.length]);
    chain.setLabel(chainLabel());
    panel.log({
      auto: "Chain prompts: only when a card fits the moment",
      all: "Chain prompts: whenever a card can be used",
      off: "Chain prompts: off (forced effects still ask)",
    }[chainMode()]);
  });
}
