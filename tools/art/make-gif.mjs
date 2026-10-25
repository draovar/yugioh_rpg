// Turns captured frames (captures/<clip>/*.png, see src/dev/capture.ts) into captures/<clip>.gif.
//   node tools/art/make-gif.mjs <clip> [scale=2] [fps=30] [crop=x,y,w,h]
import { readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const [clip, scaleArg, fpsArg, cropArg] = process.argv.slice(2);
if (!clip) { console.error("usage: make-gif.mjs <clip> [scale] [fps] [x,y,w,h]"); process.exit(1); }
const dir = path.resolve(import.meta.dirname, "../../captures", clip);
const scale = Number(scaleArg ?? 2), fps = Number(fpsArg ?? 30);
const crop = cropArg ? cropArg.split(",").map(Number) : null;

const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
const frames = [];
for (const f of files) {
  let img = sharp(path.join(dir, f));
  if (crop) img = img.extract({ left: crop[0], top: crop[1], width: crop[2], height: crop[3] });
  const meta = await img.png().toBuffer({ resolveWithObject: true });
  frames.push(await sharp(meta.data).resize(meta.info.width * scale, meta.info.height * scale, { kernel: "nearest" }).png().toBuffer());
}
const out = path.join(dir, "..", `${clip}.gif`);
await sharp(frames, { join: { animated: true } })
  .gif({ delay: frames.map(() => Math.round(1000 / fps)), loop: 0, effort: 7 })
  .toFile(out);
console.log(`${out}: ${frames.length} frames`);
