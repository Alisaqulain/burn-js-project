/**
 * Creates a consistent online backup with SQLite's VACUUM INTO (safe while the API is running).
 * Output: backups/bunbench-<timestamp>.sqlite (or the path given as the first argument).
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadConfig } from "../apps/api/src/config.ts";
import { openDatabase } from "../apps/api/src/db/database.ts";
import { ROOT } from "./lib.ts";

const config = loadConfig();
if (config.dbPath === ":memory:" || !existsSync(config.dbPath)) {
  console.error(`No database file at ${config.dbPath}`);
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const target = resolve(process.argv[2] ?? join(ROOT, "backups", `bunbench-${stamp}.sqlite`));
if (existsSync(target)) {
  console.error(`Refusing to overwrite existing file ${target}`);
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
const db = openDatabase(config.dbPath);
db.query("VACUUM INTO ?").run(target);
db.close();
console.log(`Backup written to ${target}`);
