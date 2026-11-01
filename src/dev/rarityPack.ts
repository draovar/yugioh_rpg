// Dev-only pack for previewing the reveal animations: open the shop with `?shop&anims` and BUY deals one card of each
// rarity, lowest first (Common, Short Print, Super Short Print, Rare, Super Rare, Ultra Rare, Secret Rare), so flipping
// them left to right shows every reveal effect in turn.
import { RARITIES, type BoosterList, type Pull } from "../shop/boosters.ts";

/** One card of each rarity: the picked set's first one, or another set's when the picked one has none (LOB has no SSP). */
export function rarityPack(picked: BoosterList, all: BoosterList[]): Pull[] {
  const pulls: Pull[] = [];
  for (const [rarity] of [...RARITIES].reverse()) {
    const card = [picked, ...all].flatMap((l) => l.cards).find(([, , r]) => r === rarity);
    if (card) pulls.push({ code: card[1], rarity });
  }
  return pulls;
}
