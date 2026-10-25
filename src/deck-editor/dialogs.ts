import Phaser from "phaser";
import { INSET } from "../duel-screen/layout.ts";
import { text } from "../ui/pixel.ts";
import { createTextInput } from "../ui/textInput.ts";
import { THEME, ui } from "../ui/theme.ts";
import { LIST_BUTTON_H, makeListButton } from "../ui/widgets.ts";

/** The editor's overlay: a shade over everything (swallowing clicks) and a board centred on the screen. */
export interface Overlay {
  open(w: number, h: number): { root: Phaser.GameObjects.Container; left: number; top: number };
  close(): void;
}

/** A message with buttons in a row; any button closes it. */
export function messageDialog(scene: Phaser.Scene, overlay: Overlay, message: string, buttons: { label: string; onClick: () => void }[]) {
  const w = 240, bw = 56, gap = 4;
  const msg = text(scene, 0, 0, message, { color: THEME.panel.ink, maxWidth: w - 2 * (INSET.board + 6) }).setCenterAlign();
  const h = INSET.board + 8 + msg.height + 10 + LIST_BUTTON_H + 8 + INSET.board;
  const { root, left, top } = overlay.open(w, h);
  msg.setPosition(Math.round(left + (w - msg.width) / 2), top + INSET.board + 8);
  root.add(msg);
  const rowW = buttons.length * bw + (buttons.length - 1) * gap;
  buttons.forEach((b, i) => root.add(makeListButton(scene, left + Math.round((w - rowW) / 2) + i * (bw + gap), msg.y + msg.height + 10, bw, b.label,
    () => { overlay.close(); b.onClick(); })));
}

/** Name field (typed, at most `maxLength` characters) with OK / CANCEL; Enter = OK, Esc = CANCEL. Calls `onRename` with a new name. */
export function nameDialog(scene: Phaser.Scene, overlay: Overlay, current: string, maxLength: number, onRename: (name: string) => void) {
  const w = 200, fieldH = 15, bw = 56;
  const h = INSET.board + 6 + 5 + 6 + fieldH + 8 + LIST_BUTTON_H + 6 + INSET.board;
  const { root, left, top } = overlay.open(w, h);
  const innerX = left + INSET.board + 6, innerW = w - 2 * (INSET.board + 6);
  root.add(text(scene, left + w / 2, top + INSET.board + 6, "DECK NAME", { color: THEME.panel.ink, originX: 0.5 }));
  const fieldY = top + INSET.board + 6 + 5 + 6;
  const ps = THEME.panel.paperSlice;
  root.add(scene.add.nineslice(innerX, fieldY, ui("panel-paper"), undefined, innerW, fieldH, ps, ps, ps, ps).setOrigin(0));
  const typed = text(scene, innerX + 5, fieldY + 5, "", { color: THEME.panel.paperInk });
  const caret = text(scene, innerX + 5, fieldY + 5, "_", { color: THEME.panel.paperInk });
  root.add([typed, caret]);
  const blink = scene.time.addEvent({ delay: 450, loop: true, callback: () => caret.setVisible(!caret.visible) });
  let value = current;
  const show = () => { typed.setText(value.toUpperCase()); caret.setX(typed.x + typed.width + (value ? 1 : 0)); };
  show();
  const done = (ok: boolean) => {
    input.destroy();
    blink.remove();
    overlay.close();
    const name = value.trim().toUpperCase();
    if (ok && name && name !== current) onRename(name);
  };
  const input = createTextInput(scene, { x: innerX, y: fieldY, w: innerW, h: fieldH }, {
    maxLength,
    onChange: (v) => { value = v; show(); },
    onKey: (e) => {
      if (e.key === "Enter") { done(true); return true; }
      if (e.key === "Escape") { done(false); return true; }
      return false;
    },
  });
  input.setValue(value);
  input.focus();
  const by = fieldY + fieldH + 8;
  root.add(makeListButton(scene, left + w / 2 - bw - 2, by, bw, "OK", () => done(true)));
  root.add(makeListButton(scene, left + w / 2 + 2, by, bw, "CANCEL", () => done(false)));
}
