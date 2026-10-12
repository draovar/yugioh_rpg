// How engine responses travel between peers. No PeerJS import, so Node tools can use it too.
import type { OcgResponse } from "ocgcore-wasm";

/** Responses can hold bigints, which JSON can't: they are written as {"$big": "123"}. */
export function encodeResponse(r: OcgResponse): string {
  return JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? { $big: v.toString() } : v));
}

export function decodeResponse(s: string): OcgResponse {
  return JSON.parse(s, (_k, v) => (v && typeof v === "object" && typeof v.$big === "string" ? BigInt(v.$big) : v)) as OcgResponse;
}
