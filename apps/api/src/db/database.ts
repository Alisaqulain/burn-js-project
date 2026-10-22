import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MIGRATIONS, type Migration } from "./migrations.ts";

export type Db = Database;

/** Opens (creating if needed) the SQLite database with safe pragmas. Use ":memory:" for tests. */
export function openDatabase(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  return db;
}

export function currentSchemaVersion(db: Db): number {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
  );
  const row = db.query<{ v: number | null }, []>("SELECT MAX(version) AS v FROM schema_migrations").get();
  return row?.v ?? 0;
}

/** Applies pending migrations in order, each atomically. Returns the versions applied. */
export function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): number[] {
  const versions = migrations.map((m) => m.version);
  if (versions.some((v, i) => i > 0 && v <= versions[i - 1]!)) {
    throw new Error("Migrations must have strictly increasing versions");
  }
  const current = currentSchemaVersion(db);
  const applied: number[] = [];
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.query("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
    })();
    applied.push(migration.version);
  }
  return applied;
}
