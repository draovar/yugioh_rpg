import Phaser from "phaser";
import { DECKS, deckProblems } from "../duel/decks.ts";
import { loadEngine } from "../duel/loadEngine.ts";
import { CODE_LENGTH, hostDuel, joinDuel, type DuelEntry, type NetDuel, type PendingDuel } from "../net/p2p.ts";
import { chosenDeck } from "../ui/prefs.ts";
import { WHITE, border, text } from "../ui/pixel.ts";
import { createTextInput } from "../ui/textInput.ts";
import { makeButton } from "../ui/widgets.ts";
import type { DuelSceneData } from "./DuelScene.ts";

export interface LobbyData {
  /** Room code to join straight away (from a `?join=CODE` link). */
  join?: string;
}

const CX = 320;
const SOFT = 0x9aa6c8;
const ERROR = 0xff7777;
const BUTTON = { w: 120, h: 16 };

/**
 * Placeholder multiplayer menu: host a peer-to-peer duel (shows a room code and a link to share) or join
 * one by typing the code. Each player brings the deck picked in the world menu. Once connected, starts the Duel scene.
 */
export class Lobby extends Phaser.Scene {
  private view!: Phaser.GameObjects.Container;
  private pending: PendingDuel | null = null;
  /** Join screen: typed code and the listeners that feed it (removed when leaving the screen). */
  private code = "";
  private detach: (() => void) | null = null;

  constructor() {
    super("Lobby");
  }

  create(data: LobbyData) {
    this.cameras.main.setBackgroundColor(0x040218);
    this.view = this.add.container(0, 0);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.reset());
    if (data?.join) this.connect(data.join.toUpperCase().slice(0, CODE_LENGTH));
    else this.showMenu();
  }

  /** Clears the screen, the join screen's listeners and any hosting / joining in progress. */
  private reset() {
    this.view.removeAll(true);
    this.detach?.();
    this.detach = null;
    this.pending?.cancel();
    this.pending = null;
  }

  private header(subtitle: string) {
    this.view.add(text(this, CX, 50, "MULTIPLAYER", { color: WHITE, scale: 2, originX: 0.5 }));
    this.view.add(text(this, CX, 70, subtitle, { color: SOFT, originX: 0.5, maxWidth: 420 }));
    this.view.add(text(this, CX, 330, `YOUR DECK: ${DECKS[chosenDeck()].label.toUpperCase()} (CHANGE IT IN THE WORLD MENU)`, { color: SOFT, originX: 0.5 }));
  }

  /** This machine's side of the handshake: data fingerprint, the chosen deck, and the check for the other deck. */
  private async entry(): Promise<DuelEntry> {
    const { fingerprint, cards } = await loadEngine();
    return { fingerprint, deck: DECKS[chosenDeck()].deck, deckProblems: (deck) => deckProblems(deck, cards) };
  }

  private button(y: number, label: string, onClick: () => void) {
    const b = makeButton(this, CX, y, BUTTON.w, BUTTON.h, label, onClick);
    this.view.add(b);
    return b;
  }

  private showMenu(error?: string) {
    this.reset();
    this.header("DUEL A FRIEND ON ANOTHER COMPUTER.");
    this.button(150, "HOST A DUEL", () => this.host());
    this.button(172, "JOIN A DUEL", () => this.showJoin());
    this.button(210, "BACK", () => this.scene.start("Overworld"));
    if (error) this.view.add(text(this, CX, 250, error.toUpperCase(), { color: ERROR, originX: 0.5, maxWidth: 440 }));
  }

  private async host() {
    this.reset();
    this.header("SEND THE ROOM CODE OR THE LINK TO YOUR FRIEND.");
    const status = text(this, CX, 120, "OPENING A ROOM...", { color: SOFT, originX: 0.5 });
    this.view.add(status);
    this.button(250, "CANCEL", () => this.showMenu());
    const pending = (this.pending = hostDuel(await this.entry(), (code) => {
      status.destroy();
      const link = `${location.origin}${location.pathname}?join=${code}`;
      this.view.add(text(this, CX, 104, "ROOM CODE", { color: SOFT, originX: 0.5 }));
      this.view.add(text(this, CX, 114, code, { color: WHITE, scale: 3, originX: 0.5 }));
      this.view.add(text(this, CX, 146, link.toUpperCase(), { color: SOFT, originX: 0.5 }));
      const copy = this.button(170, "COPY LINK", () => {
        navigator.clipboard?.writeText(link).then(() => copy.setLabel("COPIED!"), () => copy.setLabel("COPY FAILED"));
      });
      this.view.add(text(this, CX, 200, "WAITING FOR YOUR FRIEND TO JOIN...", { color: SOFT, originX: 0.5 }));
    }));
    this.await(pending);
  }

  private showJoin() {
    this.reset();
    this.header("TYPE OR PASTE THE ROOM CODE YOUR FRIEND SENT YOU.");
    this.code = "";
    // The code field: an outlined box (tap it on a phone to get the keyboard) with the code at 3x.
    const box = { x: CX - 70, y: 106, w: 140, h: 31 };
    const outline = this.add.graphics();
    border(outline, box.x, box.y, box.w, box.h, SOFT);
    const field = text(this, CX, 114, "", { color: WHITE, scale: 3 });
    this.view.add([outline, field]);
    const join = this.button(170, "JOIN", () => this.connect(this.code));
    this.button(192, "BACK", () => this.showMenu());
    const refresh = () => {
      field.setText([...this.code.padEnd(CODE_LENGTH, "_")].join(" "));
      field.setX(Math.round(CX - field.width / 2));
      join.setEnabled(this.code.length === CODE_LENGTH);
    };
    // Typed or pasted: the code itself, or the whole invite link (its ?join= part is used).
    const input = createTextInput(this, box, {
      onChange: (value) => {
        const code = (value.match(/join=([a-z0-9]+)/i)?.[1] ?? value).replace(/[^a-z0-9]/gi, "");
        this.code = code.toUpperCase().slice(0, CODE_LENGTH);
        refresh();
      },
      onKey: (e) => {
        if (e.key !== "Enter") return false;
        if (this.code.length === CODE_LENGTH) void this.connect(this.code);
        return true;
      },
      maxLength: 200,
    });
    this.detach = () => input.destroy();
    refresh();
    input.focus();
  }

  private async connect(code: string) {
    this.reset();
    this.header(`JOINING ROOM ${code}...`);
    this.view.add(text(this, CX, 120, "CONNECTING...", { color: SOFT, originX: 0.5 }));
    this.button(250, "CANCEL", () => this.showMenu());
    this.await((this.pending = joinDuel(code, await this.entry())));
  }

  /** Starts the duel once connected; back to the menu with the reason if it fails. */
  private await(pending: PendingDuel) {
    pending.ready.then(
      (net: NetDuel) => {
        if (this.pending !== pending) return net.close(); // cancelled meanwhile
        this.pending = null; // the Duel scene owns the connection now
        const data: DuelSceneData = { net, opponentName: "Opponent", returnScene: "Lobby" };
        this.scene.start("Duel", data);
      },
      (e: Error) => { if (this.pending === pending) this.showMenu(e.message); },
    );
  }
}
