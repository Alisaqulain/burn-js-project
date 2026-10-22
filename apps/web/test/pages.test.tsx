import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { DEFAULT_SETTINGS, type OverviewStats, type Paginated, type RunSummary, type RuntimeInfo } from "@bunbench/shared";
import { HistoryPage } from "../src/pages/history";
import { NewBenchmarkPage } from "../src/pages/new-benchmark";
import { OverviewPage } from "../src/pages/overview";
import { RuntimesPage } from "../src/pages/runtimes";
import { mockFetch, never, ok, renderAt } from "./utils";

afterEach(() => cleanup());

const emptyOverview: OverviewStats = {
  totalRuns: 0,
  completedRuns: 0,
  latestRun: null,
  latestComparison: null,
  httpThroughput: null,
  httpTrend: [],
  runtimeComparison: [],
};
const emptyPage: Paginated<RunSummary> = { items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 };
const run: RunSummary = {
  id: "11111111-2222-4333-8444-555555555555",
  label: "nightly",
  type: "cpu",
  status: "completed",
  runtimes: ["bun", "node"],
  createdAt: "2026-10-01T10:00:00.000Z",
  startedAt: null,
  finishedAt: null,
  durationMs: 1000,
  errorMessage: null,
  configHash: "abcdef0123456789",
  headline: { bun: { metric: "elapsed_median_ms", value: 12.5 }, node: { metric: "elapsed_median_ms", value: 15.25 } },
};
const runtimes: RuntimeInfo[] = [
  { name: "bun", available: true, version: "1.4.4", path: "~/.bun/bin/bun", source: "current-process", reason: null, installHint: "install bun", docsUrl: "https://bun.sh/docs" },
  { name: "node", available: false, version: null, path: null, source: "none", reason: "Node.js was not found on PATH", installHint: "Install Node.js 22.18+", docsUrl: "https://nodejs.org" },
];

describe("Overview page", () => {
  test("shows a loading skeleton while data is pending", () => {
    mockFetch({ "/api/stats/overview": never, "/api/benchmarks": never });
    renderAt("/", <OverviewPage />);
    expect(screen.getByLabelText("Loading")).toBeTruthy();
  });

  test("shows the empty state when no benchmark data exists", async () => {
    mockFetch({ "/api/stats/overview": () => ok(emptyOverview), "/api/benchmarks": () => ok(emptyPage) });
    renderAt("/", <OverviewPage />);
    expect(await screen.findByText("No benchmark data yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Run a benchmark" }).getAttribute("href")).toBe("/new");
  });

  test("shows an actionable error when the API is unreachable", async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch;
    renderAt("/", <OverviewPage />);
    expect(await screen.findByText("Cannot reach the BunBench API")).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  test("renders saved runs and stats from the API", async () => {
    mockFetch({
      "/api/stats/overview": () =>
        ok({ ...emptyOverview, totalRuns: 1, completedRuns: 1, latestRun: run, latestComparison: { runId: run.id, type: "cpu", metric: "elapsed_median_ms", leader: "bun", factor: 1.22, createdAt: run.createdAt } }),
      "/api/benchmarks": () => ok({ ...emptyPage, items: [run], total: 1 }),
    });
    renderAt("/", <OverviewPage />);
    expect(await screen.findByText("nightly")).toBeTruthy();
    expect(screen.getByText("12.5 ms")).toBeTruthy();
    expect(screen.getByText(/1\.22× on median time/)).toBeTruthy();
  });
});

describe("History page", () => {
  test("shows the empty state", async () => {
    mockFetch({ "/api/benchmarks": () => ok(emptyPage) });
    renderAt("/history", <HistoryPage />);
    expect(await screen.findByText("No saved runs yet")).toBeTruthy();
  });

  test("lists runs and builds a filtered CSV export link", async () => {
    const calls = mockFetch({ "/api/benchmarks": () => ok({ ...emptyPage, items: [run], total: 1 }) });
    renderAt("/history?type=cpu&runtime=bun", <HistoryPage />);
    expect(await screen.findByText("nightly")).toBeTruthy();
    expect(calls[0]!.url).toContain("type=cpu");
    expect(calls[0]!.url).toContain("runtime=bun");
    const exportLink = screen.getByRole("link", { name: /export csv/i });
    const href = new URL(exportLink.getAttribute("href")!, "http://x");
    expect(href.pathname).toBe("/api/benchmarks/export.csv");
    expect(Object.fromEntries(href.searchParams)).toEqual({ type: "cpu", runtime: "bun" });
    expect(screen.getByRole("button", { name: /compare selected \(0\)/i }).hasAttribute("disabled")).toBe(true);
  });

  test("shows an error state on API failure", async () => {
    mockFetch({ "/api/benchmarks": () => ({ status: 500, body: { ok: false, error: { code: "INTERNAL_ERROR", message: "boom" } } }) });
    renderAt("/history", <HistoryPage />);
    expect(await screen.findByText("boom")).toBeTruthy();
  });
});

describe("New benchmark page", () => {
  test("disables unavailable runtimes and explains why", async () => {
    mockFetch({
      "/api/settings": () => ok({ settings: DEFAULT_SETTINGS, database: {}, runtimeConfig: {}, server: {} }),
      "/api/runtimes": () => ok(runtimes),
    });
    renderAt("/new?type=json", <NewBenchmarkPage />);
    expect(await screen.findByText("Node.js was not found on PATH")).toBeTruthy();
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes[0]!.checked).toBe(true);
    expect(checkboxes[1]!.disabled).toBe(true);
    expect((screen.getByLabelText("Records") as HTMLInputElement).value).toBe("5000");
    expect(screen.getByText(/Only one runtime is selected/)).toBeTruthy();
  });
});

describe("Runtimes page", () => {
  test("shows install guidance for a missing runtime without failing", async () => {
    mockFetch({ "/api/runtimes": () => ok(runtimes) });
    renderAt("/runtimes", <RuntimesPage />);
    await waitFor(() => expect(screen.getByText("Install Node.js 22.18+")).toBeTruthy());
    expect(screen.getByText("v1.4.4")).toBeTruthy();
  });
});
