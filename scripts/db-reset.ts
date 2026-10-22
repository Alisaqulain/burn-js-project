/**
 * Deletes the local database (and WAL files) and recreates an empty schema.
 * Requires --yes. Stop the API first. Make a backup with `bun run db:backup` if you need the data.
 */
import { existsSync, rmSync } from "node:fs";
import { loadConfig } from "../apps/api/src/config.ts";
import { migrate, openDatabase } from "../apps/api/src/db/database.ts";

if (!process.argv.includes("--yes")) {
  console.error("This permanently deletes all saved benchmark runs. Re-run with: bun run db:reset -- --yes");
  process.exit(2);
}
const { dbPath } = loadConfig();
if (dbPath === ":memory:") {
  console.error("BUNBENCH_DB_PATH is :memory:, nothing to reset");
  process.exit(1);
}
for (const suffix of ["", "-wal", "-shm"]) {
  if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
}
const db = openDatabase(dbPath);
migrate(db);
db.close();
console.log(`Database reset: ${dbPath}`);
