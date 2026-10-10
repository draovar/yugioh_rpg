// Browser-side loader: fetches the built game data and initialises ocgcore once.
import createCore, { type OcgCoreSync } from "ocgcore-wasm";
import { CardDb, type CardRecord } from "./cardData.ts";

export interface Engine {
  core: OcgCoreSync;
  cards: CardDb;
  readScript: (name: string) => string | null;
}

let engine: Promise<Engine> | null = null;

export function loadEngine(): Promise<Engine> {
  engine ??= (async () => {
    const base = import.meta.env.BASE_URL;
    const [records, scripts, core] = await Promise.all([
      fetch(`${base}data/cards.json`).then((r) => r.json() as Promise<CardRecord[]>),
      fetch(`${base}data/scripts.json`).then((r) => r.json() as Promise<Record<string, string>>),
      createCore({ sync: true }),
    ]);
    return {
      core,
      cards: new CardDb(records),
      readScript: (name) => scripts[name.split("/").pop()!] ?? null,
    };
  })();
  return engine;
}
