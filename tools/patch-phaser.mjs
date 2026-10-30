// Fixes a GPU memory leak in Phaser 4.2.1 (runs as npm's postinstall after patch-ocgcore, so dev, build and CI all get it).
//
// A DynamicTexture (every RenderTexture has one) is built on a TextureSource whose `init` creates a full-size WebGL
// texture; the constructor then points the source at its DrawingContext's texture instead, without deleting the first
// one. Every RenderTexture so kept a second texture its own size alive forever: the overworld's ~1,700 baked pieces
// left ~150 MB on the GPU each time the scene restarted (back from a duel, warps), and the renderer's list of textures
// (searched on every delete) kept growing.
//
// Patches the two unminified builds (Vite imports phaser.esm.js); the minified ones aren't used. Idempotent; fails
// loudly if Phaser changed (then check whether the leak is fixed upstream and drop this).
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const DIST = path.resolve(import.meta.dirname, "../node_modules/phaser/dist");
const FILES = ["phaser.esm.js", "phaser.js"];
const broken = `            var frame = this.get();
            frame.source.glTexture = this.drawingContext.texture;`;
const fixed = `            var frame = this.get();
            renderer.deleteTexture(frame.source.glTexture); // patched by tools/patch-phaser.mjs: was leaked
            frame.source.glTexture = this.drawingContext.texture;`;

let failed = false, changed = false;
for (const name of FILES) {
  const file = path.join(DIST, name);
  // Windows checkouts of the package may use CRLF; match either.
  const src = readFileSync(file, "utf-8"), eol = src.includes("\r\n") ? "\r\n" : "\n";
  const [b, f] = [broken, fixed].map((s) => s.replaceAll("\n", eol));
  if (src.includes(f)) {
    console.log(`patch-phaser: ${name} already patched`);
  } else if (src.split(b).length === 2) {
    writeFileSync(file, src.replace(b, f));
    changed = true;
    console.log(`patch-phaser: fixed the DynamicTexture leak in ${name}`);
  } else {
    console.error(`patch-phaser: Phaser's DynamicTexture constructor changed in ${name}; review tools/patch-phaser.mjs`);
    failed = true;
  }
}
// Vite pre-bundles Phaser into node_modules/.vite and doesn't notice the change: drop that cache (a running
// `npm run dev` still has to be restarted).
if (changed) {
  rmSync(path.resolve(import.meta.dirname, "../node_modules/.vite"), { recursive: true, force: true });
  console.log("patch-phaser: restart any running `npm run dev` to pick this up");
}
if (failed) process.exit(1);
