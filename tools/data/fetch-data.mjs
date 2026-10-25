// Clones (or updates) the Project Ignis data repos into vendor/.
// CardScripts: Lua card scripts + engine utility scripts (AGPL-3.0).
// BabelCDB: SQLite card databases (cards.cdb = card stats, also card text).
// strings.conf: EDOPro system strings (prompt titles, "Normal Summon", ...).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const VENDOR = path.resolve(import.meta.dirname, "../../vendor");
/**
 * `commit`: pinned, because the scripts must match the ocgcore build inside ocgcore-wasm. Newer CardScripts
 * can call engine features that build doesn't have: from 2026-06-09 ("add Chain namespace", #1258) the helpers
 * query CHAININFO flags ocgcore-wasm 0.1.2 rejects, which silently drops effects registered mid-chain (e.g.
 * Sinister Serpent's End Phase banish). Move the pin only together with an ocgcore-wasm update, then run both
 * smoke tests and watch for "[ocgcore]" script errors. No commit = follow the latest.
 */
const REPOS = {
  CardScripts: { url: "https://github.com/ProjectIgnis/CardScripts.git", commit: "643f490e37ad2aff97413d00cdf494a932938e87" },
  BabelCDB: { url: "https://github.com/ProjectIgnis/BabelCDB.git" },
};

for (const [name, { url, commit }] of Object.entries(REPOS)) {
  const dir = path.join(VENDOR, name);
  const git = (...args) => execFileSync("git", args, { stdio: "inherit" });
  // Shallow fetch of the pinned commit (GitHub serves any commit by hash) or the latest one, then check it
  // out detached; works for a fresh clone and an update alike, even when upstream rewrote history.
  console.log(`${name} @ ${commit ? commit.slice(0, 8) : "latest"}`);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    git("-C", dir, "init", "-q");
    git("-C", dir, "remote", "add", "origin", url);
  }
  git("-C", dir, "fetch", "-q", "--depth", "1", "origin", commit ?? "HEAD");
  git("-C", dir, "checkout", "-q", "--detach", "FETCH_HEAD");
}

const STRINGS_URL = "https://raw.githubusercontent.com/ProjectIgnis/Distribution/master/config/strings.conf";
console.log("downloading strings.conf");
const res = await fetch(STRINGS_URL);
if (!res.ok) throw new Error(`strings.conf: HTTP ${res.status}`);
writeFileSync(path.join(VENDOR, "strings.conf"), await res.text());
