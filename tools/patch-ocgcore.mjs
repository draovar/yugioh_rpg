// Fixes a message-parser bug in ocgcore-wasm 0.1.2 (runs as npm's postinstall, so dev, build and CI all get it).
//
// MSG_SHUFFLE_SET_CARD (face-down cards shuffled in place, e.g. after Cyber Jar summons monsters face-down) is written
// by the core as: location u8, count u8, `count` old places, then `count` new places (loc_info = u8 controller,
// u8 location, u32 sequence, u32 position). The package reads a u32 count and alternating old/new places, runs past
// the end of the message and throws "eof", which stops the whole duel.
// Idempotent; fails loudly if the package changed (then check whether the bug is fixed upstream and drop this).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const FILE = path.resolve(import.meta.dirname, "../node_modules/ocgcore-wasm/dist/index.js");
const BROKEN = "case 36:return{type:t,location:e.u8(),cards:Array.from({length:e.u32()},()=>({from:p(e),to:p(e)}))};";
const FIXED = "case 36:{let l=e.u8(),n=e.u8(),f=Array.from({length:n},()=>p(e));return{type:t,location:l,cards:f.map(x=>({from:x,to:p(e)}))}}";

const src = readFileSync(FILE, "utf-8");
if (src.includes(FIXED)) {
  console.log("patch-ocgcore: already patched");
} else if (src.includes(BROKEN)) {
  writeFileSync(FILE, src.replace(BROKEN, FIXED));
  console.log("patch-ocgcore: fixed the MSG_SHUFFLE_SET_CARD parser");
} else {
  console.error("patch-ocgcore: ocgcore-wasm's SHUFFLE_SET_CARD parser changed; review tools/patch-ocgcore.mjs");
  process.exit(1);
}
