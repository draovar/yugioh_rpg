import type { OcgCardData } from "ocgcore-wasm";

/** One card as stored in public/data/cards.json (built by tools/build-data.mjs). */
export interface CardRecord {
  code: number;
  alias: number;
  /** 64-bit packed setcodes, as a decimal string (too big for a JS number). */
  setcode: string;
  type: number;
  atk: number;
  def: number;
  /** Packed: low byte = level, bits 16-23 / 24-31 = pendulum scales. */
  level: number;
  /** 64-bit race bitmask, as a decimal string. */
  race: string;
  attribute: number;
  name: string;
  desc: string;
}

export function toOcgCardData(r: CardRecord): OcgCardData {
  const setcode = BigInt(r.setcode);
  const setcodes: number[] = [];
  for (let i = 0n; i < 4n; i++) {
    const s = Number((setcode >> (i * 16n)) & 0xffffn);
    if (s) setcodes.push(s);
  }
  return {
    code: r.code,
    alias: r.alias,
    setcodes,
    type: r.type,
    level: r.level & 0xff,
    attribute: r.attribute,
    race: BigInt(r.race),
    attack: r.atk,
    defense: r.def,
    lscale: (r.level >>> 24) & 0xff,
    rscale: (r.level >>> 16) & 0xff,
    link_marker: 0,
  };
}

export class CardDb {
  readonly records = new Map<number, CardRecord>();
  private readonly ocg = new Map<number, OcgCardData>();

  constructor(records: CardRecord[]) {
    for (const r of records) {
      this.records.set(r.code, r);
      this.ocg.set(r.code, toOcgCardData(r));
    }
  }

  get(code: number): OcgCardData | null {
    return this.ocg.get(code) ?? null;
  }

  name(code: number): string {
    return this.records.get(code)?.name ?? `#${code}`;
  }
}
