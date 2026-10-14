// Dev previews (`&anims`, `&dialogs`) are written with seat 0 as you and seat 1 as the opponent. When you are seat 1
// (you went second), their messages and the board they read go through `swapSeats` so they still show your side.

const PLAYER_KEYS = new Set(["player", "controller", "triggering_controller"]);

/** A copy of `value` with every player number (0 <-> 1) swapped; a snapshot's `players` also swap places. */
export function swapSeats<T>(value: T): T {
  if (Array.isArray(value)) return value.map(swapSeats) as T;
  if (!value || typeof value !== "object") return value;
  const out = Object.fromEntries(Object.entries(value).map(([k, v]) =>
    [k, PLAYER_KEYS.has(k) && (v === 0 || v === 1) ? 1 - v : swapSeats(v)]));
  if (Array.isArray(out.players) && out.players.length === 2) out.players = [out.players[1], out.players[0]];
  return out as T;
}
