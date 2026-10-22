import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { LiveProgress, RunDetail, RunStreamEvent } from "@bunbench/shared";
import { RunPage } from "../src/pages/run";
import { mockFetch, ok, renderAt } from "./utils";

/** Minimal EventSource stand-in that tests drive manually. */
class FakeEventSource {
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readonly url: string;
  readyState = 1;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((e: MessageEvent<string>) => void)[]>();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, fn: (e: MessageEvent<string>) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  close() {
    this.readyState = 2;
  }
  emit(event: RunStreamEvent) {
    for (const fn of this.listeners.get(event.type) ?? []) fn({ data: JSON.stringify(event) } as MessageEvent<string>);
  }
}

const live: LiveProgress = {
  status: "running",
  runtime: "node",
  round: 1,
  phase: "measured",
  iteration: 4,
  total: 10,
  executionsDone: 1,
  executionsTotal: 2,
  startedAt: new Date().toISOString(),
  message: "Running Node.js (round 1)",
};

const run = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  label: "live test",
  type: "cpu",
  status: "running",
  runtimes: ["bun", "node"],
  createdAt: new Date().toISOString(),
  startedAt: live.startedAt,
  finishedAt: null,
  durationMs: null,
  errorMessage: null,
  configHash: "x",
  headline: {},
  config: { type: "cpu", params: { limit: 1000 }, runtimes: ["bun", "node"], iterations: 10, warmups: 0, rounds: 1, seed: 1, maxDurationMs: 10_000 },
  executionOrder: [],
  executions: [],
  aggregates: [],
  latencyHistogram: [],
  warnings: [],
  reproducibility: { command: "", apiRequest: "", notes: [] },
  live,
} as unknown as RunDetail;

afterEach(() => {
  cleanup();
  FakeEventSource.instances = [];
});

describe("Live run view", () => {
  test("renders streamed progress, cancels, and switches to results when done", async () => {
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    let current: RunDetail = run;
    const calls = mockFetch({
      [`/api/benchmarks/${run.id}/cancel`]: () => ok({ id: run.id, status: "cancelling" }),
      [`/api/benchmarks/${run.id}`]: () => ok(current),
    });
    renderAt(`/runs/${run.id}`, <RunPage />, "/runs/:id");

    expect(await screen.findByText("Measured iteration 4 of 10")).toBeTruthy();
    expect(screen.getByText("Live (server-sent events)")).toBeTruthy();
    // 1 of 2 processes done + 4/10 of the current one = 70%.
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("70");

    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe(`/api/benchmarks/${run.id}/events`);
    act(() => source.emit({ type: "progress", live: { ...live, iteration: 9 } }));
    expect(screen.getByText("Measured iteration 9 of 10")).toBeTruthy();
    act(() => source.emit({ type: "execution", runtime: "node", round: 1, status: "timeout", message: "Exceeded the maximum duration" }));
    expect(screen.getByText(/Node\.js round 1: timeout/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/cancel") && c.init?.method === "POST")).toBe(true));

    current = { ...run, status: "cancelled", errorMessage: "Cancelled by user", live: null };
    act(() => source.emit({ type: "done", status: "cancelled" }));
    expect(await screen.findByText("Run cancelled")).toBeTruthy();
    expect(source.readyState).toBe(FakeEventSource.CLOSED);
  });

  test("falls back to polling when the stream fails", async () => {
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    mockFetch({ [`/api/benchmarks/${run.id}`]: () => ok(run) });
    renderAt(`/runs/${run.id}`, <RunPage />, "/runs/:id");
    await screen.findByText("Measured iteration 4 of 10");
    const source = FakeEventSource.instances[0]!;
    act(() => {
      source.readyState = FakeEventSource.CLOSED;
      source.onerror?.();
    });
    expect(await screen.findByText("Live (polling)")).toBeTruthy();
    expect(screen.getByText(/polling for updates/)).toBeTruthy();
  });
});
