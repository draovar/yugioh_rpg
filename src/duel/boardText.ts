// The whole board as text, both hands and every face-down card included: for misplay reports (`&aitrace`, L key).
import { OcgPosition } from "ocgcore-wasm";
import type { CardDb } from "./cardData.ts";
import type { CardView, FieldSnapshot, PlayerView } from "./DuelSession.ts";

/** Both players' sides as each sees their own (so nothing is hidden): side p comes from `snapshot(p)`. */
export function fullBoard(own: [FieldSnapshot, FieldSnapshot]): FieldSnapshot {
  return { players: [own[0].players[0], own[1].players[1]] };
}

const POSITION: [number, string][] = [
  [OcgPosition.FACEUP_ATTACK, "ATK"], [OcgPosition.FACEUP_DEFENSE, "DEF"],
  [OcgPosition.FACEDOWN_DEFENSE, "set DEF"], [OcgPosition.FACEDOWN_ATTACK, "set ATK"],
];

/** One line per zone row and pile; `labels` names the players (e.g. "you", "AI"). The opponent's side first, like the screen. */
export function formatBoard(board: FieldSnapshot, cards: CardDb, labels: [string, string], bottom: 0 | 1): string {
  const name = (c: CardView) => (c.code ? cards.name(c.code) : "(hidden)");
  const counters = (c: CardView) => {
    const n = c.counters.reduce((sum, k) => sum + k.count, 0);
    return n ? ` [${n} counter${n > 1 ? "s" : ""}]` : "";
  };
  const equip = (c: CardView) => {
    const t = c.equipTarget;
    const target = t && board.players[t.controller].monsters[t.sequence];
    const targets = (c.cardTargets ?? []).map((x) => board.players[x.controller].monsters[x.sequence]).filter((m) => m);
    return target ? ` -> equipped to ${name(target)}` : targets.length ? ` -> targets ${targets.map((m) => name(m!)).join(", ")}` : "";
  };
  const monster = (c: CardView | null) => {
    if (!c) return "-";
    const pos = POSITION.find(([bits]) => c.position & bits)?.[1] ?? "?";
    return `${name(c)} ${c.attack}/${c.defense} ${pos}${counters(c)}`;
  };
  const spell = (c: CardView | null) => (c ? `${name(c)}${c.faceDown ? " (set)" : ""}${counters(c)}${equip(c)}` : "-");
  const list = (cs: CardView[]) => (cs.length ? cs.map(name).join(", ") : "-");
  const side = (p: PlayerView, label: string) => [
    `${label}: LP ${p.lp}, Deck ${p.deckCount}, Extra ${p.extraCount}`,
    `  hand (${p.hand.length}): ${list(p.hand)}`,
    `  monsters: ${p.monsters.map((c, i) => `${i + 1} ${monster(c)}`).join(" | ")}`,
    `  spells/traps: ${p.spells.slice(0, 5).map((c, i) => `${i + 1} ${spell(c)}`).join(" | ")} | field ${spell(p.spells[5] ?? null)}`,
    `  GY (${p.grave.length}, newest last): ${list(p.grave)}`,
    ...(p.banished.length ? [`  banished: ${list(p.banished)}`] : []),
  ];
  const top = (1 - bottom) as 0 | 1;
  return [...side(board.players[top], labels[top]), ...side(board.players[bottom], labels[bottom])].join("\n");
}
