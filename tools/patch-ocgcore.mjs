// Fixes message-parser bugs in ocgcore-wasm 0.1.2 (runs as npm's postinstall, so dev, build and CI all get it).
// loc_info (a card's place in the core's messages) = u8 controller, u8 location, u32 sequence, u32 position.
//
// MSG_SHUFFLE_SET_CARD (face-down cards shuffled in place, e.g. after Cyber Jar summons monsters face-down) is written
// by the core as: location u8, count u8, `count` old places, then `count` new places. The package reads a u32 count
// and alternating old/new places, runs past the end of the message and throws "eof", which stops the whole duel.
//
// MSG_SELECT_SUM (Ritual tributes by Level, e.g. White Dragon Ritual) is written as: player u8, mode u8, target u32,
// min u32, max u32, then the "must" cards and then the selectable ones, each list a u32 count of
// (code u32, loc_info, value u32). The package reads the selectable list first and no position, so the lists come out
// swapped and every card after the first is garbage (the duel then dies on a RETRY).
//
// Idempotent; fails loudly if the package changed (then check whether the bugs are fixed upstream and drop this).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const FILE = path.resolve(import.meta.dirname, "../node_modules/ocgcore-wasm/dist/index.js");
const PATCHES = [
  {
    name: "MSG_SHUFFLE_SET_CARD",
    broken: "case 36:return{type:t,location:e.u8(),cards:Array.from({length:e.u32()},()=>({from:p(e),to:p(e)}))};",
    fixed: "case 36:{let l=e.u8(),n=e.u8(),f=Array.from({length:n},()=>p(e));return{type:t,location:l,cards:f.map(x=>({from:x,to:p(e)}))}}",
  },
  {
    name: "MSG_SELECT_SUM",
    broken: "case 23:return{type:t,player:e.u8(),select_max:e.u8(),amount:e.u32(),min:e.u32(),max:e.u32(),"
      + "selects:Array.from({length:e.u32()},()=>({code:e.u32(),controller:e.u8(),location:e.u8(),sequence:e.u32(),amount:e.u32()})),"
      + "selects_must:Array.from({length:e.u32()},()=>({code:e.u32(),controller:e.u8(),location:e.u8(),sequence:e.u32(),amount:e.u32()}))};",
    fixed: "case 23:{let c=()=>({code:e.u32(),controller:e.u8(),location:e.u8(),sequence:e.u32(),position:e.u32(),amount:e.u32()}),"
      + "r={type:t,player:e.u8(),select_max:e.u8(),amount:e.u32(),min:e.u32(),max:e.u32()};"
      + "r.selects_must=Array.from({length:e.u32()},c);r.selects=Array.from({length:e.u32()},c);return r}",
  },
];

let src = readFileSync(FILE, "utf-8");
let failed = false, changed = false;
for (const { name, broken, fixed } of PATCHES) {
  if (src.includes(fixed)) {
    console.log(`patch-ocgcore: ${name} already patched`);
  } else if (src.includes(broken)) {
    src = src.replace(broken, fixed);
    changed = true;
    console.log(`patch-ocgcore: fixed the ${name} parser`);
  } else {
    console.error(`patch-ocgcore: ocgcore-wasm's ${name} parser changed; review tools/patch-ocgcore.mjs`);
    failed = true;
  }
}
writeFileSync(FILE, src);
// Vite doesn't watch node_modules: a dev server started before this keeps serving the old parser from memory.
if (changed) console.log("patch-ocgcore: restart any running `npm run dev` to pick this up");
if (failed) process.exit(1);
