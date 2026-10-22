import { describe, expect, test } from "bun:test";
import { benchmarkConfigSchema, DEFAULT_SETTINGS } from "@bunbench/shared";
import { currentSchemaVersion, migrate, openDatabase } from "../src/db/database.ts";
import { LATEST_SCHEMA_VERSION } from "../src/db/migrations.ts";
import { escapeLike, RunRepository } from "../src/db/repository.ts";
import { configHash } from "../src/lib/config-hash.ts";
import { fakeOutcome, validCpuBody } from "./helpers.ts";

function setup() {
  const db = openDatabase(":memory:");
  migrate(db);
  return { db, repo: new RunRepository(db) };
}

function createRun(repo: RunRepository, overrides: Record<string, unknown> = {}, createdAt = new Date().toISOString()) {
  const config = benchmarkConfigSchema.parse({ ...validCpuBody, ...overrides });
  const id = crypto.randomUUID();
  repo.createRun({ id, config, configHash: configHash(config), idempotencyKey: null, createdAt });
  return { id, config };
}

describe("migrations", () => {
  test("apply once, are idempotent and record the schema version", () => {
    const db = openDatabase(":memory:");
    expect(currentSchemaVersion(db)).toBe(0);
    expect(migrate(db)).toEqual([1]);
    expect(migrate(db)).toEqual([]);
    expect(currentSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((t) => t.name);
    for (const t of ["runs", "workload_configs", "run_runtimes", "executions", "runtime_metadata", "measurements", "aggregate_results", "latency_buckets", "run_warnings", "settings", "schema_migrations"]) {
      expect(tables).toContain(t);
    }
  });

  test("a failing migration rolls back and is not recorded", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    expect(() => migrate(db, [{ version: 1, name: "x", sql: "" }, { version: 2, name: "broken", sql: "CREATE TABLE ok_table (a INTEGER); SELECT * FROM missing_table;" }])).toThrow();
    expect(currentSchemaVersion(db)).toBe(1);
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'ok_table'").get()).toBeNull();
  });

  test("rejects out-of-order migrations", () => {
    const db = openDatabase(":memory:");
    expect(() => migrate(db, [{ version: 2, name: "b", sql: "" }, { version: 1, name: "a", sql: "" }])).toThrow(/increasing/);
  });

  test("foreign keys are enforced", () => {
    const { db } = setup();
    expect(() => db.query("INSERT INTO run_runtimes (run_id, runtime, status) VALUES ('nope', 'bun', 'pending')").run()).toThrow();
  });
});

describe("run persistence", () => {
  test("create -> save outcome -> read back round trip", () => {
    const { repo } = setup();
    const { id, config } = createRun(repo);
    expect(repo.getStatus(id)).toBe("queued");
    repo.saveOutcome(id, fakeOutcome(config), new Date().toISOString(), 1234);
    const run = repo.getRun(id)!;
    expect(run.status).toBe("completed");
    expect(run.config).toEqual(config);
    expect(run.durationMs).toBe(1234);
    expect(run.executions).toHaveLength(2);
    expect(run.executions[0]!.measurements).toHaveLength(5);
    expect(run.executions[0]!.metadata?.cpuModel).toBe("Test CPU");
    const bun = run.aggregates.find((a) => a.runtime === "bun")!;
    expect(bun.status).toBe("completed");
    expect(bun.metrics.elapsed_median_ms?.value).toBeCloseTo(10.2, 10);
    expect(bun.metrics.elapsed_median_ms?.better).toBe("lower");
    expect(run.headline.bun?.metric).toBe("elapsed_median_ms");
  });

  test("saving an outcome twice replaces, not duplicates, results", () => {
    const { repo } = setup();
    const { id, config } = createRun(repo);
    repo.saveOutcome(id, fakeOutcome(config), new Date().toISOString(), 1);
    repo.saveOutcome(id, fakeOutcome(config), new Date().toISOString(), 1);
    expect(repo.getRun(id)!.executions).toHaveLength(2);
  });

  test("an invalid outcome is rolled back entirely (transactional)", () => {
    const { repo } = setup();
    const { id, config } = createRun(repo);
    const outcome = fakeOutcome(config);
    outcome.executions[1]!.measurements[0]!.elapsedMs = -1; // violates CHECK (elapsed_ms >= 0)
    expect(() => repo.saveOutcome(id, outcome, new Date().toISOString(), 1)).toThrow();
    const run = repo.getRun(id)!;
    expect(run.status).toBe("queued");
    expect(run.executions).toHaveLength(0);
    expect(run.aggregates.every((a) => Object.keys(a.metrics).length === 0)).toBe(true);
  });

  test("delete cascades to all child rows", () => {
    const { db, repo } = setup();
    const { id, config } = createRun(repo);
    repo.saveOutcome(id, fakeOutcome(config), new Date().toISOString(), 1);
    expect(repo.deleteRun(id)).toBe(true);
    for (const table of ["executions", "measurements", "aggregate_results", "run_runtimes", "workload_configs", "run_warnings"]) {
      expect(db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n).toBe(0);
    }
    expect(repo.deleteRun(id)).toBe(false);
  });

  test("recoverInterrupted fails non-terminal runs", () => {
    const { repo } = setup();
    const { id } = createRun(repo);
    repo.updateStatus(id, "running");
    expect(repo.recoverInterrupted()).toBe(1);
    expect(repo.getStatus(id)).toBe("failed");
    expect(repo.getRun(id)!.errorMessage).toContain("server stopped");
  });

  test("idempotency keys are unique", () => {
    const { repo } = setup();
    const config = benchmarkConfigSchema.parse(validCpuBody);
    repo.createRun({ id: crypto.randomUUID(), config, configHash: "h", idempotencyKey: "key-12345", createdAt: new Date().toISOString() });
    expect(repo.findIdByIdempotencyKey("key-12345")).not.toBeNull();
    expect(() => repo.createRun({ id: crypto.randomUUID(), config, configHash: "h", idempotencyKey: "key-12345", createdAt: new Date().toISOString() })).toThrow();
  });
});

describe("listing and filtering", () => {
  test("paginates newest first and filters by type, status, runtime, date and search", () => {
    const { repo } = setup();
    const a = createRun(repo, { label: "alpha 100%" }, "2026-01-01T10:00:00.000Z");
    const b = createRun(repo, { type: "json", params: { records: 100 }, runtimes: ["node"], label: "beta" }, "2026-02-01T10:00:00.000Z");
    createRun(repo, { label: "gamma" }, "2026-03-01T10:00:00.000Z");
    repo.saveOutcome(a.id, fakeOutcome(a.config), "2026-01-01T10:01:00.000Z", 1);

    const page1 = repo.listRuns({ page: 1, pageSize: 2 });
    expect(page1.total).toBe(3);
    expect(page1.totalPages).toBe(2);
    expect(page1.items.map((r) => r.label)).toEqual(["gamma", "beta"]);
    expect(repo.listRuns({ page: 2, pageSize: 2 }).items.map((r) => r.label)).toEqual(["alpha 100%"]);

    expect(repo.listRuns({ page: 1, pageSize: 10, type: "json" }).items.map((r) => r.id)).toEqual([b.id]);
    expect(repo.listRuns({ page: 1, pageSize: 10, status: "completed" }).items.map((r) => r.id)).toEqual([a.id]);
    expect(repo.listRuns({ page: 1, pageSize: 10, runtime: "bun" }).total).toBe(2);
    expect(repo.listRuns({ page: 1, pageSize: 10, from: "2026-02-01", to: "2026-02-01" }).items.map((r) => r.id)).toEqual([b.id]);
    expect(repo.listRuns({ page: 1, pageSize: 10, q: "100%" }).items.map((r) => r.id)).toEqual([a.id]);
    expect(repo.listRuns({ page: 1, pageSize: 10, q: "%" }).items.map((r) => r.id)).toEqual([a.id]);
    expect(repo.listRuns({ page: 1, pageSize: 10, q: b.id.slice(0, 8) }).items.map((r) => r.id)).toEqual([b.id]);
  });

  test("SQL metacharacters in filters are treated as data", () => {
    const { repo } = setup();
    createRun(repo, { label: "safe" });
    expect(repo.listRuns({ page: 1, pageSize: 10, q: "'; DROP TABLE runs; --" }).total).toBe(0);
    expect(repo.countRuns()).toBe(1);
    expect(escapeLike("a_b%c\\")).toBe("a\\_b\\%c\\\\");
  });
});

describe("settings", () => {
  test("defaults, save and reload", () => {
    const { repo } = setup();
    expect(repo.getSettings()).toEqual(DEFAULT_SETTINGS);
    repo.saveSettings({ ...DEFAULT_SETTINGS, defaultIterations: 7 });
    expect(repo.getSettings().defaultIterations).toBe(7);
  });

  test("corrupt stored settings fall back to defaults", () => {
    const { db, repo } = setup();
    db.query("INSERT INTO settings (key, value_json, updated_at) VALUES ('app', '{not json', 'x')").run();
    expect(repo.getSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
