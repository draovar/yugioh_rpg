// Text entry for a canvas game: an invisible HTML <input> laid exactly over a box drawn in the game (native
// 640x360 coordinates). The game draws the text itself (bitmap font); the input only collects it, so phones
// open their on-screen keyboard when the box is tapped, and paste / IME work on desktop.
import Phaser from "phaser";

export interface TextInput {
  readonly value: string;
  focus(): void;
  /** Sets the text (no onChange). */
  setValue(value: string): void;
  /** Hidden: the box can't be tapped or typed into (e.g. while a dialog covers it). */
  setVisible(on: boolean): void;
  destroy(): void;
}

export interface TextInputOptions {
  /** Called on every change with the whole text. */
  onChange: (value: string) => void;
  /** Keys the game handles itself (arrows, Enter); return true to keep the browser from acting on them too. */
  onKey?: (e: KeyboardEvent) => boolean;
  maxLength?: number;
}

export function createTextInput(scene: Phaser.Scene, box: { x: number; y: number; w: number; h: number }, opts: TextInputOptions): TextInput {
  const el = document.createElement("input");
  Object.assign(el, { type: "text", autocomplete: "off", spellcheck: false, maxLength: opts.maxLength ?? 64 });
  el.setAttribute("autocapitalize", "off");
  el.setAttribute("autocorrect", "off");
  el.setAttribute("enterkeyhint", "done");
  // Invisible but tappable; 16px text stops iOS from zooming the page when it gets focus.
  Object.assign(el.style, {
    position: "fixed", opacity: "0", border: "0", padding: "0", margin: "0", fontSize: "16px",
    background: "transparent", color: "transparent", caretColor: "transparent", zIndex: "10",
  });
  const place = () => {
    const r = scene.game.canvas.getBoundingClientRect();
    const sx = r.width / 640, sy = r.height / 360;
    Object.assign(el.style, {
      left: `${r.left + box.x * sx}px`, top: `${r.top + box.y * sy}px`, width: `${box.w * sx}px`, height: `${box.h * sy}px`,
    });
  };
  place();
  document.body.appendChild(el);
  window.addEventListener("resize", place);
  el.addEventListener("input", () => opts.onChange(el.value));
  el.addEventListener("keydown", (e) => {
    if (opts.onKey?.(e)) e.preventDefault();
    e.stopPropagation(); // the game's own keyboard handling stays out of it
  });
  // Phaser captures some keys (space, arrows) for the whole page; they must reach the input while it's in use.
  const keyboard = scene.input.keyboard;
  keyboard?.disableGlobalCapture();

  return {
    get value() { return el.value; },
    focus: () => el.focus({ preventScroll: true }),
    setValue: (value: string) => { el.value = value; },
    setVisible: (on: boolean) => {
      el.style.display = on ? "" : "none";
      if (!on) el.blur();
    },
    destroy: () => {
      window.removeEventListener("resize", place);
      el.remove();
      keyboard?.enableGlobalCapture();
    },
  };
}
