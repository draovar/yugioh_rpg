# Credits

## Engine & card data
- **ocgcore** (EDOPro rules engine) and **CardScripts** — [Project Ignis](https://github.com/ProjectIgnis), AGPL-3.0.
  Because the game embeds them, the game itself is distributed under AGPL-3.0.
- **BabelCDB** card database and **strings.conf** — Project Ignis.
- **ocgcore-wasm** — n1xx1.

## Libraries & services
- **Phaser** (MIT) — game framework.
- **PeerJS** (MIT) — WebRTC peer-to-peer connections for multiplayer. Rooms are brokered by PeerJS's free public
  server (0.peerjs.com); the duel data itself goes directly between the two browsers.

## Art & UI
- **Complete UI Essential Pack** by **Crusenho Agus Hennihuno** — https://crusenho.itch.io —
  licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Used: Runewood theme sprites
  (phase buttons, LP bars, panel frames, card action menu) and Hologram theme sprites, trimmed/nine-sliced; see `tools/art/import-ui.mjs`.
- **3x3 Font for Nerds** — Norwegian Ink (www.noink.no). *No license found (checked 2026-10: none in the font file, noink.no is gone); kept by the project owner's choice for this non-commercial project.*
- **Modern Exteriors** tileset by **LimeZu** (paid pack, https://limezu.itch.io): overworld map tiles. Not in this
  repository; only the tiles the maps use are packed into the built game.
- Overworld characters, props and reaction balloons — from *Yu-Gi-Oh! Reshef of Destruction* (© Konami), sheet ripped
  by **Darkbolt99** (The Spriters Resource); sliced by `tools/art/build-characters.mjs`.
- Card frames, card back, attribute icons, Spell/Trap kind icons and level star — made for this project.
- **tiny5** pixel font — made for this project.

## Card artwork
Card names, text and artwork are © Konami. Artwork is downloaded from [YGOPRODeck](https://ygoprodeck.com)
at build time (not stored in this repository) and downscaled to pixel art. This is a non-commercial fan
project, not affiliated with or endorsed by Konami.
