// Clones (or updates) the Project Ignis data repos into vendor/.
// CardScripts: Lua card scripts + engine utility scripts (AGPL-3.0).
// BabelCDB: SQLite card databases (cards.cdb = card stats, also card text).
// strings.conf: EDOPro system strings (prompt titles, "Normal Summon", ...).
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

const VENDOR = path.resolve(import.meta.dirname, "../vendor");
const REPOS = {
  CardScripts: "https://github.com/ProjectIgnis/CardScripts.git",
  BabelCDB: "https://github.com/ProjectIgnis/BabelCDB.git",
};

for (const [name, url] of Object.entries(REPOS)) {
  const dir = path.join(VENDOR, name);
  const git = (...args) => execFileSync("git", args, { stdio: "inherit" });
  if (existsSync(dir)) {
    console.log(`updating ${name}`);
    git("-C", dir, "pull", "--ff-only", "--depth", "1");
  } else {
    console.log(`cloning ${name}`);
    git("clone", "--depth", "1", url, dir);
  }
}

const STRINGS_URL = "https://raw.githubusercontent.com/ProjectIgnis/Distribution/master/config/strings.conf";
console.log("downloading strings.conf");
const res = await fetch(STRINGS_URL);
if (!res.ok) throw new Error(`strings.conf: HTTP ${res.status}`);
writeFileSync(path.join(VENDOR, "strings.conf"), await res.text());
