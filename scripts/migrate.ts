/** Applies pending database migrations to the configured database (BUNBENCH_DB_PATH). */
import { loadConfig } from "../apps/api/src/config.ts";
import { currentSchemaVersion, migrate, openDatabase } from "../apps/api/src/db/database.ts";

const config = loadConfig();
const db = openDatabase(config.dbPath);
const before = currentSchemaVersion(db);
const applied = migrate(db);
console.log(`Database: ${config.dbPath}`);
console.log(applied.length ? `Applied migrations ${applied.join(", ")} (schema v${before} → v${currentSchemaVersion(db)})` : `Up to date (schema v${before})`);
db.close();
