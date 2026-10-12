// Browser-side loader: fetches the built game data and initialises ocgcore once.
import createCore, { type OcgCoreSync } from "ocgcore-wasm";
import { CardDb, type CardRecord } from "./cardData.ts";
import { DuelText, type SystemStrings } from "./text.ts";

export interface Engine {
  core: OcgCoreSync;
  cards: CardDb;
  readScript: (name: string) => string | null;
  text: DuelText;
  /**
   * Hash of the card data and scripts. Peer-to-peer duels only start when both machines have the same
   * one: a different script version could play a card differently and split the duel.
   */
  fingerprint: number;
}

let engine: Promise<Engine> | null = null;

export function loadEngine(): Promise<Engine> {
  engine ??= (async () => {
    const base = import.meta.env.BASE_URL;
    const [records, scripts, strings, core] = await Promise.all([
      fetch(`${base}data/cards.json`).then((r) => r.json() as Promise<CardRecord[]>),
      fetch(`${base}data/scripts.json`).then((r) => r.json() as Promise<Record<string, string>>),
      fetch(`${base}data/strings.json`).then((r) => r.json() as Promise<SystemStrings>),
      createCore({ sync: true }),
    ]);
    const cards = new CardDb(records);
    return {
      core,
      cards,
      text: new DuelText(cards, strings),
      readScript: (name) => scripts[name.split("/").pop()!] ?? null,
      fingerprint: fnv1a(JSON.stringify([records, Object.entries(scripts).sort(([a], [b]) => (a < b ? -1 : 1))])),
    };
  })();
  return engine;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
