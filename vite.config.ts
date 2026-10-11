import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * Dev-only: lets the game save captured frames (POST /__capture?name=<clip>&i=<frame>, body = PNG)
 * into captures/<clip>/ so tools/make-gif.mjs can turn them into a GIF. See src/dev/capture.ts.
 */
function captureEndpoint(): Plugin {
  const root = path.resolve(import.meta.dirname, "captures");
  return {
    name: "dev-capture",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__capture", (req, res) => {
        const url = new URL(req.url ?? "", "http://x");
        const name = (url.searchParams.get("name") ?? "clip").replace(/[^a-z0-9_-]/gi, "");
        const i = Number(url.searchParams.get("i") ?? 0);
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          const dir = path.join(root, name);
          mkdirSync(dir, { recursive: true });
          writeFileSync(path.join(dir, `${String(i).padStart(4, "0")}.png`), Buffer.concat(chunks));
          res.end("ok");
        });
      });
    },
  };
}

export default defineConfig({
  base: "./",
  server: { port: 5173 },
  build: { target: "es2022", assetsInlineLimit: 0 },
  optimizeDeps: { exclude: ["ocgcore-wasm"] },
  plugins: [captureEndpoint()],
});
