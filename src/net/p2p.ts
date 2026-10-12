// Peer-to-peer duel link over WebRTC (PeerJS). The host opens a room under a short code and the guest
// connects to it. PeerJS's free public server only introduces the two browsers; the duel's data then
// goes directly between them. Browser only (no Phaser).
//
// Handshake: guest -> "hello" (protocol, data fingerprint, its deck), host -> "start" (duel seed, which seat the
// host plays, its deck) or "reject". Decks travel as passcode lists, not names, so both machines build the duel
// from exactly the same cards. After that both sides send "answer" packets (see DuelController), a "ping"
// every few seconds, "surrender" when a player forfeits, and "bye" when leaving. WebRTC itself takes very long
// (or forever) to notice a closed tab, so silence for HEARTBEAT.timeoutMs also counts as the other player leaving.
import { Peer, type DataConnection, type PeerError } from "peerjs";
import type { OcgResponse } from "ocgcore-wasm";
import type { RemotePeer } from "../duel/DuelController.ts";
import type { Deck } from "../duel/DuelSession.ts";
import { decodeResponse, encodeResponse } from "./wire.ts";

/** Bump when the packets or anything else that changes how a duel plays out on both machines changes. */
const PROTOCOL = 2;
/** PeerJS ids are global on its public server; the prefix keeps our rooms apart from other apps'. */
const ID_PREFIX = "ygorpg-";
/** Room codes: letters only, without the ones the tiny5 font draws like a digit or each other (B/8, I/1, L, O/0, S/5, Z/2). */
const CODE_CHARS = "ACDEFGHJKMNPQRTUVWXY";
export const CODE_LENGTH = 5;
/** Give up when the guest can't reach the host (e.g. a network that blocks direct connections). */
const CONNECT_TIMEOUT_MS = 15_000;
/** Pings keep the link alive; silence longer than the timeout means the other side is gone. */
const HEARTBEAT = { everyMs: 3_000, timeoutMs: 20_000 };

type Seed = [bigint, bigint, bigint, bigint];

type Packet =
  | { t: "hello"; protocol: number; fingerprint: number; deck: Deck }
  | { t: "start"; seed: string[]; hostSeat: 0 | 1; deck: Deck }
  | { t: "reject"; reason: string }
  | { t: "answer"; response: string; checksum: number }
  | { t: "ping" }
  | { t: "surrender" }
  | { t: "bye" };

/** A connected peer-to-peer duel, ready to hand to the Duel scene. */
export interface NetDuel {
  /** Seat this machine plays (0 goes first). */
  me: 0 | 1;
  seed: Seed;
  /** Both players' decks, by seat. */
  decks: [Deck, Deck];
  remote: RemotePeer;
  /** Called once when the connection drops (the other player left or the network failed). */
  onClose(handler: () => void): void;
  /** Tells the other player we forfeit the duel. */
  surrender(): void;
  /** Called when the other player forfeits. */
  onSurrender(handler: () => void): void;
  /** Leaves the duel and closes the connection. */
  close(): void;
}

/** Hosting or joining in progress. */
export interface PendingDuel {
  ready: Promise<NetDuel>;
  cancel(): void;
}

/** What this machine brings to a duel: data fingerprint, its deck, and a check for the other player's deck. */
export interface DuelEntry {
  fingerprint: number;
  deck: Deck;
  /** Problems with a received deck (see deckProblems); a non-empty list refuses the duel. */
  deckProblems: (deck: Deck) => string[];
}

/** Opens a room; `onCode` gets its code once it is reachable. Resolves when a guest has joined. */
export function hostDuel(entry: DuelEntry, onCode: (code: string) => void): PendingDuel {
  let peer: Peer | null = null;
  const ready = new Promise<NetDuel>((resolve, reject) => {
    const open = (attempt: number) => {
      const code = randomCode();
      const p = (peer = new Peer(ID_PREFIX + code));
      let taken = false;
      p.on("open", () => onCode(code));
      p.on("error", (e) => {
        if (e.type === "unavailable-id" && attempt < 5) { p.destroy(); open(attempt + 1); return; } // code in use
        if (!taken) reject(new Error(describe(e)));
      });
      p.on("connection", (conn) => {
        conn.once("data", (raw) => {
          const hello = parse(raw);
          const refuse = (reason: string) => { send(conn, { t: "reject", reason }); setTimeout(() => conn.close(), 500); };
          if (hello?.t !== "hello") { conn.close(); return; }
          if (taken) return refuse("This room already has two players.");
          if (hello.protocol !== PROTOCOL || hello.fingerprint !== entry.fingerprint) {
            return refuse("Your game version differs from the host's. Both reload the page and try again.");
          }
          const problems = entry.deckProblems(hello.deck);
          if (problems.length) return refuse(`The host's game refused your deck: ${problems.join(", ")}.`);
          taken = true;
          const seed = randomSeed();
          const hostSeat = (crypto.getRandomValues(new Uint8Array(1))[0] & 1) as 0 | 1;
          send(conn, { t: "start", seed: seed.map(String), hostSeat, deck: entry.deck });
          const decks = (hostSeat === 0 ? [entry.deck, hello.deck] : [hello.deck, entry.deck]) as [Deck, Deck];
          resolve(link(p, conn, hostSeat, seed, decks));
        });
      });
    };
    open(0);
  });
  return { ready, cancel: () => peer?.destroy() };
}

/** Connects to the room `code`. Resolves once the host has started the duel. */
export function joinDuel(code: string, entry: DuelEntry): PendingDuel {
  const peer = new Peer();
  const ready = new Promise<NetDuel>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error("Couldn't reach the host. Their network may block direct connections.")); peer.destroy(); }, CONNECT_TIMEOUT_MS);
    const fail = (message: string) => { clearTimeout(timer); reject(new Error(message)); peer.destroy(); };
    peer.on("error", (e) => fail(e.type === "peer-unavailable" ? `No open room with the code ${code}.` : describe(e)));
    peer.on("open", () => {
      const conn = peer.connect(ID_PREFIX + code.toUpperCase(), { reliable: true });
      conn.on("open", () => send(conn, { t: "hello", protocol: PROTOCOL, fingerprint: entry.fingerprint, deck: entry.deck }));
      conn.once("data", (raw) => {
        const p = parse(raw);
        if (p?.t === "reject") return fail(p.reason);
        if (p?.t !== "start") return fail("The host sent something unexpected.");
        const problems = entry.deckProblems(p.deck);
        if (problems.length) { conn.close(); return fail(`The host's deck isn't valid here: ${problems.join(", ")}.`); }
        clearTimeout(timer);
        const me = (1 - p.hostSeat) as 0 | 1;
        const decks = (me === 0 ? [entry.deck, p.deck] : [p.deck, entry.deck]) as [Deck, Deck];
        resolve(link(peer, conn, me, p.seed.map(BigInt) as Seed, decks));
      });
    });
  });
  return { ready, cancel: () => peer.destroy() };
}

/** Wraps an open connection as the duel's RemotePeer. Answers that arrive before the duel listens are kept. */
function link(peer: Peer, conn: DataConnection, me: 0 | 1, seed: Seed, decks: [Deck, Deck]): NetDuel {
  let onAnswer: ((response: OcgResponse, checksum: number) => void) | null = null;
  const early: [OcgResponse, number][] = [];
  let onClose: (() => void) | null = null;
  let onSurrender: (() => void) | null = null;
  let surrendered = false;
  let closed = false;
  let lastHeard = Date.now();
  const heartbeat = setInterval(() => {
    if (Date.now() - lastHeard > HEARTBEAT.timeoutMs) gone();
    else send(conn, { t: "ping" });
  }, HEARTBEAT.everyMs);
  // Closing or reloading the tab: tell the other side right away (best effort).
  const leaving = () => send(conn, { t: "bye" });
  window.addEventListener("pagehide", leaving);
  const shutDown = () => {
    closed = true;
    clearInterval(heartbeat);
    window.removeEventListener("pagehide", leaving);
  };
  const gone = () => {
    if (closed) return;
    shutDown();
    onClose?.();
  };
  conn.on("data", (raw) => {
    lastHeard = Date.now();
    const p = parse(raw);
    if (p?.t === "bye") return gone();
    if (p?.t === "surrender") {
      surrendered = true;
      return onSurrender?.();
    }
    if (p?.t !== "answer") return;
    const response = decodeResponse(p.response);
    if (onAnswer) onAnswer(response, p.checksum);
    else early.push([response, p.checksum]);
  });
  conn.on("close", gone);
  conn.on("error", gone);
  return {
    me,
    seed,
    decks,
    remote: {
      send: (response, checksum) => send(conn, { t: "answer", response: encodeResponse(response), checksum }),
      onResponse: (handler) => {
        onAnswer = handler;
        for (const [r, c] of early.splice(0)) handler(r, c);
      },
    },
    onClose: (handler) => {
      onClose = handler;
      if (closed) handler();
    },
    surrender: () => send(conn, { t: "surrender" }),
    onSurrender: (handler) => {
      onSurrender = handler;
      if (surrendered) handler();
    },
    close: () => {
      if (!closed) leaving();
      shutDown();
      // Let the "bye" go out before the connection closes.
      conn.close({ flush: true });
      setTimeout(() => peer.destroy(), 1_000);
    },
  };
}

function send(conn: DataConnection, p: Packet) {
  void conn.send(JSON.stringify(p));
}

function parse(raw: unknown): Packet | null {
  try {
    return typeof raw === "string" ? (JSON.parse(raw) as Packet) : null;
  } catch {
    return null;
  }
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

function randomSeed(): Seed {
  const a = crypto.getRandomValues(new BigUint64Array(4));
  return [a[0], a[1], a[2], a[3]];
}

function describe(e: PeerError<string>): string {
  switch (e.type) {
    case "browser-incompatible": return "This browser doesn't support peer-to-peer connections.";
    case "network": case "server-error": case "socket-error": case "socket-closed":
      return "Couldn't reach the matchmaking server. Check your internet connection.";
    default: return `Connection failed (${e.type}).`;
  }
}
