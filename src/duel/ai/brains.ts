// The available brains by name (arena, URL options, later trainer profiles).
import { autoRespond } from "../autoBot.ts";
import type { Brain } from "./AiSeat.ts";

/** autoBot behind the Brain interface: the first legal option. The baseline every real brain must beat. */
export const autoBotBrain: Brain = {
  name: "autobot",
  decide: (prompt, view) => ({ response: autoRespond(prompt, view.rng, view.cards), reason: "first legal option" }),
};

export const BRAINS = {
  autobot: () => autoBotBrain,
} satisfies Record<string, () => Brain>;

export type BrainName = keyof typeof BRAINS;

export function isBrainName(name: string): name is BrainName {
  return name in BRAINS;
}
