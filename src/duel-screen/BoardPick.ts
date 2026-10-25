// Choosing on the board instead of in a dialog: cards (when every candidate is a field or hand card), counters to
// remove, and zones. Candidate cards get a yellow 1px outline and picked ones an orange 2px one (`highlight`, drawn
// by the scene); the prompt text and CONFIRM / CANCEL go in the field's prompt strip.
import Phaser from "phaser";
import { OcgLocation, type OcgCardLoc, type SelectFieldPlace } from "ocgcore-wasm";
import { counterTotal, type FieldSnapshot } from "../duel/engine/DuelSession.ts";
import { freePlaces } from "../duel/ai/autoBot.ts";
import { border } from "../ui/pixel.ts";
import { THEME } from "../ui/theme.ts";
import type { ListButton } from "../ui/widgets.ts";
import type { CardHighlight, CardSprite } from "./CardSprite.ts";
import { CARD, cardKey, slotXY, type Slot } from "./layout.ts";
import { pickCounter, togglePick, type PickerOptions } from "./Modal.ts";

export interface PromptButton {
  label: string;
  onClick: () => void;
  enabled?: boolean;
}

export interface BoardPickHost {
  readonly scene: Phaser.Scene;
  /** The displayed cards by `cardKey`. */
  readonly sprites: Map<string, CardSprite>;
  /** The board as last drawn (counter badges count every kind of counter on a card). */
  snapshot(): FieldSnapshot | null;
  /** Screen side of a player: 0 = you (bottom), 1 = opponent (top). */
  side(player: number): 0 | 1;
  /** Shows the prompt strip and its buttons (with a counter line over them if `counter`); null hides it. */
  setPrompt(label: string | null, buttons?: PromptButton[], counter?: boolean): { buttons: ListButton[]; counter: Phaser.GameObjects.BitmapText | null };
  /** Draws the counter badge of the card at `key` with `count`. */
  counterBadge(key: string, count: number): void;
  /** Redraws the card outlines and cursors (they ask `highlight`). */
  applyHighlights(): void;
}

/**
 * Removing counters: `need` in all, `available[i]` of this kind on card i, `picked[i]` taken from it so far,
 * `total[i]` = all its counters (what its badge counts).
 */
interface CounterPick { need: number; available: number[]; picked: number[]; total: number[] }

/** A card choice on the board: `keys[i]` is the sprite key of `opts.cards[i]`. */
interface CardPick {
  keys: string[];
  selected: Set<number>;
  opts: PickerOptions;
  /** CONFIRM in multi mode, and the "1/2" line above the buttons. */
  confirm: ListButton | null;
  counter: Phaser.GameObjects.BitmapText | null;
  counters?: CounterPick;
}

export class BoardPick {
  private readonly host: BoardPickHost;
  private pick: CardPick | null = null;
  private placeTargets: Phaser.GameObjects.GameObject[] = [];

  constructor(host: BoardPickHost) {
    this.host = host;
  }

  /** A card choice is waiting for clicks on the board. */
  get active(): boolean {
    return this.pick !== null;
  }

  /**
   * Lets the player choose cards on the board: clicking picks (single mode: answers at once; multi: toggles, then
   * CONFIRM in the strip). Returns false, showing nothing, when a candidate isn't a card on the board (Graveyard,
   * Deck...): the caller uses the picker dialog then. `locs[i]` is where `opts.cards[i]` is.
   */
  cards(locs: OcgCardLoc[], opts: PickerOptions): boolean {
    const keys = locs.map(cardKey);
    const shown = OcgLocation.MZONE | OcgLocation.SZONE | OcgLocation.HAND;
    if (!locs.every((c) => c.location & shown) || !keys.every((k) => this.host.sprites.has(k))) return false;
    const selected = new Set(opts.cards.flatMap((c, i) => (c.selected || c.locked ? [i] : [])));
    const multi = opts.mode === "multi";
    const buttons = [...(opts.buttons ?? [])];
    // CONFIRM first; its counter ("1/2") is a line above the buttons, kept up to date by `refresh`.
    if (multi) buttons.unshift({ label: "Confirm", onClick: () => opts.onConfirm([...selected].sort((a, b) => a - b)) });
    const made = this.host.setPrompt(opts.title, buttons, multi && !!pickCounter(opts));
    this.pick = { keys, selected, opts, confirm: multi ? made.buttons[0] : null, counter: made.counter };
    this.refresh();
    return true;
  }

  /**
   * Removing counters (SELECT_COUNTER), like tributing: click the cards to take counters from (one per click),
   * CONFIRM once `need` are taken; badges count down. `cards[i].count` = how many of this kind card i has.
   * Counters are only ever on field cards, so this is normally on the board; returns false if not.
   */
  counters(cards: (OcgCardLoc & { code: number; count: number })[], need: number,
    opts: Pick<PickerOptions, "title" | "onHover" | "onHoverEnd"> & { onConfirm: (picked: number[]) => void }): boolean {
    const cp: CounterPick = { need, available: cards.map((c) => c.count), picked: cards.map(() => 0), total: [] };
    const sum = () => cp.picked.reduce((a, b) => a + b, 0);
    const onBoard = this.cards(cards, {
      ...opts,
      cards: cards.map((c) => ({ code: c.code })),
      mode: "multi",
      isValid: () => sum() === need,
      counter: { value: sum, of: need },
      onConfirm: () => opts.onConfirm([...cp.picked]),
    });
    if (!onBoard) return false;
    // The badges count every kind of counter on the card.
    const views = new Map((this.host.snapshot()?.players ?? []).flatMap((p) => [...p.monsters, ...p.spells])
      .flatMap((v) => (v ? [[cardKey(v), v] as const] : [])));
    cp.total = this.pick!.keys.map((k, i) => Math.max(counterTotal(views.get(k)?.counters ?? []), cards[i].count));
    this.pick!.counters = cp;
    this.refresh();
    return true;
  }

  /**
   * Zone choice: free zones get a semi-transparent yellow fill with a yellow 1px border, more opaque while
   * hovered or once picked (when several are needed). Collects `count` clicks, then calls `onDone`.
   */
  places(player: number, fieldMask: number, count: number, label: string, onDone: (places: SelectFieldPlace[]) => void) {
    const s = this.host.scene;
    const chosen: SelectFieldPlace[] = [];
    this.host.setPrompt(label);
    for (const place of freePlaces(player, fieldMask, 32)) {
      if (place.location === OcgLocation.MZONE && place.sequence > 4) continue; // no Extra Monster Zones in GOAT
      const slot: Slot = place.location === OcgLocation.MZONE ? { kind: "mzone", seq: place.sequence } : { kind: "szone", seq: place.sequence };
      const { x, y } = slotXY(this.host.side(place.player), slot);
      const g = s.add.graphics().setDepth(790);
      const draw = (on: boolean) => {
        g.clear();
        g.fillStyle(THEME.pick.zone, on ? THEME.pick.zoneHoverAlpha : THEME.pick.zoneAlpha).fillRect(x - CARD.w / 2, y - CARD.h / 2, CARD.w, CARD.h);
        border(g, x - CARD.w / 2, y - CARD.h / 2, CARD.w, CARD.h, THEME.pick.zone);
      };
      draw(false);
      let picked = false;
      const hit = s.add.zone(x, y, CARD.w, CARD.h).setInteractive({ useHandCursor: true }).setDepth(791);
      hit.on("pointerover", () => draw(true));
      hit.on("pointerout", () => draw(picked));
      hit.on("pointerup", () => {
        picked = true;
        draw(true);
        hit.disableInteractive();
        chosen.push(place);
        if (chosen.length >= count) onDone(chosen);
      });
      this.placeTargets.push(g, hit);
    }
  }

  /** A card was clicked; returns false when no card choice is running (the click is the scene's). */
  click(key: string): boolean {
    const p = this.pick;
    if (!p) return false;
    const i = p.keys.indexOf(key);
    if (i < 0 || p.opts.cards[i].locked) return true;
    if (p.counters) this.counterClick(p, p.counters, i);
    else if (p.opts.mode === "single") p.opts.onConfirm([i]);
    else if (togglePick(p.selected, i, p.opts.max)) this.refresh();
    return true;
  }

  /** How the card at `key` looks in the running choice (undefined: not a candidate), and whether it can be clicked. */
  highlight(key: string): { look: CardHighlight | undefined; clickable: boolean } {
    const p = this.pick;
    const i = p ? p.keys.indexOf(key) : -1;
    if (i < 0) return { look: undefined, clickable: false };
    const locked = !!p!.opts.cards[i].locked;
    return { look: p!.selected.has(i) || locked ? "selected" : "choice", clickable: !locked };
  }

  /** Ends any choice: counter badges back to the counts on the cards, zone targets removed. */
  clear() {
    const p = this.pick;
    if (p?.counters) p.keys.forEach((k, i) => this.host.counterBadge(k, p.counters!.total[i]));
    this.pick = null;
    for (const o of this.placeTargets) o.destroy();
    this.placeTargets = [];
  }

  /**
   * A click while removing counters: takes one more of the card's counters; once it has given all it can (or
   * enough are taken), the next click puts its counters back.
   */
  private counterClick(p: CardPick, cp: CounterPick, i: number) {
    const sum = cp.picked.reduce((a, b) => a + b, 0);
    if (sum < cp.need && cp.picked[i] < cp.available[i]) cp.picked[i]++;
    else if (cp.picked[i]) cp.picked[i] = 0;
    else if (cp.need === 1) { cp.picked.fill(0); cp.picked[i] = 1; } // swap the one pick
    else return; // full: unpick one first
    p.selected = new Set(cp.picked.flatMap((n, j) => (n ? [j] : [])));
    this.refresh();
  }

  /** Badges, CONFIRM, the counter line and outlines after a change. */
  private refresh() {
    const p = this.pick;
    if (!p) return;
    const sel = [...p.selected].sort((a, b) => a - b);
    const cp = p.counters;
    if (cp) p.keys.forEach((k, i) => this.host.counterBadge(k, cp.total[i] - cp.picked[i]));
    p.confirm?.setEnabled(p.opts.isValid ? p.opts.isValid(sel) : true);
    const count = pickCounter(p.opts);
    if (count && p.counter) {
      p.counter.setText(`${count.value(sel)}/${count.of}`);
      p.counter.setX(Math.round(slotXY(0, { kind: "extra" }).x - p.counter.width / 2)); // centred on the plate
    }
    this.host.applyHighlights();
  }
}
