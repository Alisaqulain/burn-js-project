import {
  BENCHMARK_TYPE_INFO,
  type ExecutionMetadata,
  METRIC_DEFINITIONS,
  type MetricKey,
  MIN_SAMPLES_FOR_CONFIDENCE,
  RUNTIME_LABELS,
  RUNTIMES,
  type RunDetail,
  type RuntimeAggregate,
  type RuntimeName,
} from "@bunbench/shared";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { ChartCard, RuntimeBarChart, RuntimeLineChart } from "./charts";
import { Callout, RuntimeTag, StatusBadge } from "./status";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader, Table, Td, Th } from "./ui/primitives";
import { betterLabel, formatBytes, formatCompact, formatDuration, formatMetric, formatMs, formatNumber } from "@/lib/format";

const COMPUTE_METRICS: MetricKey[] = [
  "sample_count",
  "elapsed_mean_ms",
  "elapsed_median_ms",
  "elapsed_min_ms",
  "elapsed_max_ms",
  "elapsed_stddev_ms",
  "elapsed_ci95_ms",
  "elapsed_cv_pct",
  "elapsed_p90_ms",
  "elapsed_p95_ms",
  "ops_per_sec",
  "peak_rss_bytes",
  "inproc_rss_max_bytes",
  "heap_used_max_bytes",
];
const HTTP_METRICS: MetricKey[] = [
  "sample_count",
  "http_rps",
  "http_requests_ok",
  "http_requests_failed",
  "http_error_rate_pct",
  "http_latency_mean_ms",
  "http_latency_p50_ms",
  "http_latency_p90_ms",
  "http_latency_p95_ms",
  "http_latency_p99_ms",
  "elapsed_median_ms",
  "elapsed_cv_pct",
  "peak_rss_bytes",
  "server_rss_after_bytes",
];

const ENV_ROWS: [string, (m: ExecutionMetadata) => string][] = [
  ["Runtime version", (m) => m.runtimeVersion],
  ["Operating system", (m) => `${m.platform} ${m.osRelease}`],
  ["Architecture", (m) => m.arch],
  ["CPU", (m) => `${m.cpuCount}× ${m.cpuModel}`],
  ["Total memory", (m) => formatBytes(m.totalMemoryBytes)],
  ["Timer", (m) => m.timer],
  ["Load client", (m) => (m.clientRuntime ? `${m.clientRuntime} ${m.clientVersion}` : "n/a")],
];

function measured(run: RunDetail): RuntimeAggregate[] {
  return run.aggregates.filter((a) => a.status === "completed" && Object.keys(a.metrics).length > 0);
}

function value(agg: RuntimeAggregate | undefined, metric: MetricKey): number | null {
  return agg?.metrics[metric]?.value ?? null;
}

/** Plain-language comparison of the headline metric, with a noise check from confidence intervals. */
function ComparisonSummary({ run }: { run: RunDetail }) {
  const aggs = measured(run);
  const bun = aggs.find((a) => a.runtime === "bun");
  const node = aggs.find((a) => a.runtime === "node");
  if (!bun || !node) return null;
  const metric: MetricKey = run.type === "http" ? "http_rps" : "elapsed_mean_ms";
  const b = value(bun, metric);
  const n = value(node, metric);
  if (b == null || n == null || b <= 0 || n <= 0) return null;
  const better = METRIC_DEFINITIONS[metric].better;
  const bunWins = better === "lower" ? b < n : b > n;
  const leader: RuntimeName = bunWins ? "bun" : "node";
  const factor = better === "lower" ? Math.max(b, n) / Math.min(b, n) : Math.max(b, n) / Math.min(b, n);
  let noise: string | null = null;
  if (run.type !== "http") {
    const bc = value(bun, "elapsed_ci95_ms");
    const nc = value(node, "elapsed_ci95_ms");
    if (bc != null && nc != null) {
      const overlap = !(b + bc < n - nc || n + nc < b - bc);
      noise = overlap
        ? "The 95% confidence intervals overlap, so this difference may be measurement noise."
        : "The 95% confidence intervals do not overlap.";
    }
  }
  const samples = Math.min(value(bun, "sample_count") ?? 0, value(node, "sample_count") ?? 0);
  return (
    <Callout tone="info" title="Result on this machine">
      <span>
        {RUNTIME_LABELS[leader]}'s {METRIC_DEFINITIONS[metric].label.toLowerCase()} was {formatNumber(factor, 2)}× {better === "lower" ? "lower" : "higher"} than{" "}
        {RUNTIME_LABELS[leader === "bun" ? "node" : "bun"]} (Bun {formatMetric(metric, b)}, Node.js {formatMetric(metric, n)}; {betterLabel(metric)}).{" "}
        {noise}
        {samples < MIN_SAMPLES_FOR_CONFIDENCE ? ` Only ${samples} samples per runtime: treat as indicative.` : ""} This is one workload on one machine, not a general verdict.
      </span>
    </Callout>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1_500);
          },
          () => setCopied(false),
        );
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function RunResults({ run }: { run: RunDetail }) {
  const aggs = measured(run);
  const runtimes = aggs.map((a) => a.runtime);
  const byRt = (r: RuntimeName) => aggs.find((a) => a.runtime === r);
  const isHttp = run.type === "http";
  const metrics = isHttp ? HTTP_METRICS : COMPUTE_METRICS;

  const row = (category: string, metric: MetricKey) => ({ category, ...Object.fromEntries(runtimes.map((r) => [r, value(byRt(r), metric)])) });
  const timeRows = [
    row("Mean", "elapsed_mean_ms"),
    row("Median", "elapsed_median_ms"),
    row("Min", "elapsed_min_ms"),
    row("Max", "elapsed_max_ms"),
    ...(aggs.some((a) => a.metrics.elapsed_p95_ms) ? [row("P95", "elapsed_p95_ms")] : aggs.some((a) => a.metrics.elapsed_p90_ms) ? [row("P90", "elapsed_p90_ms")] : []),
  ];
  const throughputRows = [row(isHttp ? "Successful req/s" : `${BENCHMARK_TYPE_INFO[run.type].opsUnit}`, isHttp ? "http_rps" : "ops_per_sec")];
  const latencyRows = isHttp
    ? [row("P50", "http_latency_p50_ms"), row("P90", "http_latency_p90_ms"), row("P95", "http_latency_p95_ms"), row("P99", "http_latency_p99_ms")]
    : [];
  const memoryRows = isHttp
    ? [row("Server peak RSS (OS)", "peak_rss_bytes"), row("Server RSS after load", "server_rss_after_bytes")]
    : [row("Peak RSS (OS)", "peak_rss_bytes"), row("Max RSS (in-process)", "inproc_rss_max_bytes")];

  // Histogram as share of each runtime's requests, so different request counts stay comparable.
  const buckets = [...new Set(run.latencyHistogram.map((b) => b.upperMs))].sort((a, b) => (a < 0 ? 1 : b < 0 ? -1 : a - b));
  const totals = Object.fromEntries(runtimes.map((r) => [r, run.latencyHistogram.filter((b) => b.runtime === r).reduce((n, b) => n + b.count, 0)]));
  const histRows = buckets.map((upper, i) => {
    const label = upper < 0 ? `> ${formatNumber(buckets[i - 1] ?? 0)} ms` : `≤ ${formatNumber(upper)} ms`;
    return {
      category: label,
      ...Object.fromEntries(
        runtimes.map((r) => {
          const count = run.latencyHistogram.find((b) => b.runtime === r && b.upperMs === upper)?.count ?? 0;
          return [r, totals[r] ? (count / totals[r]!) * 100 : 0];
        }),
      ),
    };
  });
  const firstNonEmpty = histRows.findIndex((h) => runtimes.some((r) => ((h as Record<string, unknown>)[r] as number) > 0));
  const lastNonEmpty = histRows.length - 1 - [...histRows].reverse().findIndex((h) => runtimes.some((r) => ((h as Record<string, unknown>)[r] as number) > 0));
  const histTrimmed = firstNonEmpty >= 0 ? histRows.slice(firstNonEmpty, lastNonEmpty + 1) : [];

  // Individual iterations in execution order (round, iteration) for each runtime.
  const sequences = Object.fromEntries(
    runtimes.map((r) => [
      r,
      run.executions
        .filter((e) => e.runtime === r && e.status === "completed")
        .sort((a, b) => a.round - b.round)
        .flatMap((e) => e.measurements.map((m) => ({ round: e.round, iteration: m.iteration, elapsed: m.elapsedMs }))),
    ]),
  ) as Record<RuntimeName, { round: number; iteration: number; elapsed: number }[]>;
  const maxLen = Math.max(0, ...runtimes.map((r) => sequences[r]?.length ?? 0));
  const iterRows = Array.from({ length: maxLen }, (_, i) => ({
    sample: i + 1,
    ...Object.fromEntries(runtimes.map((r) => [r, sequences[r]?.[i]?.elapsed ?? null])),
    ...Object.fromEntries(runtimes.map((r) => [`${r}Label`, sequences[r]?.[i] ? `round ${sequences[r]![i]!.round}, iteration ${sequences[r]![i]!.iteration}` : ""])),
  }));

  const runtimeColumns = (fmt: (v: number) => string) =>
    [{ key: "category", label: "Measure" }, ...runtimes.map((r) => ({ key: r, label: RUNTIME_LABELS[r], format: (v: unknown) => (typeof v === "number" ? fmt(v) : "—") }))];

  const envRuntimes = RUNTIMES.filter((r) => run.executions.some((e) => e.runtime === r && e.metadata));

  return (
    <div className="space-y-6">
      {run.status === "completed" ? <ComparisonSummary run={run} /> : null}

      {run.warnings.length > 0 ? (
        <div className="space-y-2">
          {run.warnings.map((w, i) => (
            <Callout key={`${w.code}-${i}`} tone={w.code === "http_client_overhead" || w.code === "single_runtime" ? "info" : "warning"}>
              {w.message}
            </Callout>
          ))}
        </div>
      ) : null}

      {aggs.length === 0 ? (
        <Callout tone="error" title="No measurements">
          No runtime produced measurements for this run. See the executions table below for the reason.
        </Callout>
      ) : (
        <>
          <Card>
            <CardHeader title="Summary statistics" description="Pooled over all measured iterations and rounds. Warm-up iterations are excluded." />
            <Table>
              <thead>
                <tr>
                  <Th>Metric</Th>
                  {runtimes.map((r) => (
                    <Th key={r} className="text-right">
                      <RuntimeTag runtime={r} />
                    </Th>
                  ))}
                  <Th>Direction</Th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) =>
                  aggs.some((a) => a.metrics[m]) ? (
                    <tr key={m}>
                      <Td>
                        <span className="text-fg">{METRIC_DEFINITIONS[m].label}</span>
                        <span className="block text-xs text-subtle">{METRIC_DEFINITIONS[m].description}</span>
                      </Td>
                      {runtimes.map((r) => (
                        <Td key={r} className="tabular text-right whitespace-nowrap">
                          {formatMetric(m, value(byRt(r), m))}
                        </Td>
                      ))}
                      <Td className="text-xs whitespace-nowrap text-subtle">{betterLabel(m)}</Td>
                    </tr>
                  ) : null,
                )}
              </tbody>
            </Table>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ChartCard title={isHttp ? "Time per measured batch" : "Execution time by runtime"} hint={`Milliseconds per ${isHttp ? `batch of ${"requests" in run.config.params ? formatNumber(run.config.params.requests, 0) : ""} requests` : "iteration"} · lower is better`} runtimes={runtimes} table={{ columns: runtimeColumns(formatMs), rows: timeRows }}>
              <RuntimeBarChart data={timeRows} runtimes={runtimes} format={formatMs} />
            </ChartCard>
            <ChartCard title="Throughput comparison" hint={`${isHttp ? "Successful requests per second" : `${BENCHMARK_TYPE_INFO[run.type].opsUnit}`} · higher is better`} runtimes={runtimes} table={{ columns: runtimeColumns((v) => formatNumber(v, 0)), rows: throughputRows }}>
              <RuntimeBarChart data={throughputRows} runtimes={runtimes} format={formatCompact} />
            </ChartCard>
            {isHttp ? (
              <>
                <ChartCard title="Latency percentiles" hint="Per-request latency measured by the load client · lower is better" runtimes={runtimes} table={{ columns: runtimeColumns(formatMs), rows: latencyRows }}>
                  <RuntimeBarChart data={latencyRows} runtimes={runtimes} format={formatMs} />
                </ChartCard>
                <ChartCard
                  title="Latency distribution"
                  hint="Share of successful requests per latency bucket (% of each runtime's requests)"
                  runtimes={runtimes}
                  table={{ columns: runtimeColumns((v) => `${formatNumber(v, 2)}%`), rows: histTrimmed }}
                >
                  <RuntimeBarChart data={histTrimmed} runtimes={runtimes} format={(v) => `${formatNumber(v, 1)}%`} />
                </ChartCard>
              </>
            ) : null}
            <ChartCard
              title="Memory usage"
              hint={isHttp ? "Server process memory · lower is better. Peak RSS is OS-reported after exit." : "Lower is better. Peak RSS is OS-reported after exit; in-process RSS is sampled after each iteration."}
              runtimes={runtimes}
              table={{ columns: runtimeColumns(formatBytes), rows: memoryRows }}
            >
              <RuntimeBarChart data={memoryRows} runtimes={runtimes} format={formatBytes} />
            </ChartCard>
            <ChartCard
              title="Individual iteration results"
              hint={`Every measured ${isHttp ? "batch" : "iteration"} in execution order (rounds concatenated) · lower is better`}
              runtimes={runtimes}
              table={{
                columns: [
                  { key: "sample", label: "#" },
                  ...runtimes.flatMap((r) => [
                    { key: r, label: `${RUNTIME_LABELS[r]} (ms)`, format: (v: unknown) => (typeof v === "number" ? formatMs(v) : "—") },
                    { key: `${r}Label`, label: `${RUNTIME_LABELS[r]} position` },
                  ]),
                ],
                rows: iterRows,
              }}
            >
              <RuntimeLineChart data={iterRows} runtimes={runtimes} xKey="sample" xLabel={(v) => `Sample #${String(v)}`} format={formatMs} />
            </ChartCard>
          </div>
        </>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Environment" description="Reported by each runner process. Only non-sensitive hardware details are stored." />
          {envRuntimes.length === 0 ? (
            <CardBody className="text-sm text-subtle">No runner reported its environment.</CardBody>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Property</Th>
                  {envRuntimes.map((r) => (
                    <Th key={r}>
                      <RuntimeTag runtime={r} />
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ENV_ROWS.map(([label, get]) => (
                  <tr key={label}>
                    <Td className="text-subtle">{label}</Td>
                    {envRuntimes.map((r) => {
                      const meta = run.executions.find((e) => e.runtime === r && e.metadata)!.metadata!;
                      return (
                        <Td key={r} className="break-words">
                          {get(meta)}
                        </Td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Workload configuration" description={`Configuration hash ${run.configHash}: only runs with the same hash are directly comparable.`} />
          <Table>
            <tbody>
              <tr>
                <Td className="text-subtle">Workload</Td>
                <Td>{BENCHMARK_TYPE_INFO[run.type].label}</Td>
              </tr>
              {Object.entries(run.config.params).map(([k, v]) => (
                <tr key={k}>
                  <Td className="text-subtle">{k}</Td>
                  <Td className="tabular">{formatNumber(v as number, 0)}</Td>
                </tr>
              ))}
              <tr>
                <Td className="text-subtle">Warm-up / measured iterations</Td>
                <Td className="tabular">
                  {run.config.warmups} / {run.config.iterations} per process
                </Td>
              </tr>
              <tr>
                <Td className="text-subtle">Rounds</Td>
                <Td className="tabular">{run.config.rounds}</Td>
              </tr>
              <tr>
                <Td className="text-subtle">Seed</Td>
                <Td className="tabular">{run.config.seed}</Td>
              </tr>
              <tr>
                <Td className="text-subtle">Max duration per process</Td>
                <Td className="tabular">{formatDuration(run.config.maxDurationMs)}</Td>
              </tr>
              <tr>
                <Td className="text-subtle">Execution order</Td>
                <Td>{run.executionOrder.length ? run.executionOrder.map((r) => r.map((x) => RUNTIME_LABELS[x]).join(" → ")).join("  |  ") : "—"}</Td>
              </tr>
            </tbody>
          </Table>
        </Card>
      </div>

      <Card>
        <CardHeader title="Executions" description="One row per runner process. Failures are recorded separately and never mixed into statistics." />
        <Table>
          <thead>
            <tr>
              <Th>#</Th>
              <Th>Runtime</Th>
              <Th>Round</Th>
              <Th>Status</Th>
              <Th>Exit</Th>
              <Th className="text-right">Duration</Th>
              <Th className="text-right">Peak RSS</Th>
              <Th>Output checksum</Th>
              <Th>Error</Th>
            </tr>
          </thead>
          <tbody>
            {run.executions.map((e) => (
              <tr key={e.id}>
                <Td className="tabular text-subtle">{e.orderIndex >= 0 ? e.orderIndex + 1 : "—"}</Td>
                <Td>
                  <RuntimeTag runtime={e.runtime} />
                </Td>
                <Td className="tabular">{e.round}</Td>
                <Td>
                  <StatusBadge status={e.status} />
                </Td>
                <Td className="tabular">{e.exitCode ?? "—"}</Td>
                <Td className="tabular text-right">{formatDuration(e.durationMs)}</Td>
                <Td className="tabular text-right">{formatBytes(e.peakRssBytes)}</Td>
                <Td className="font-mono text-xs">{e.outputChecksum ?? "—"}</Td>
                <Td className="max-w-md text-xs break-words text-critical-text">{e.errorMessage ?? ""}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader title="Reproducibility" description="Re-run the identical workload against a BunBench API on any machine." actions={<CopyButton text={run.reproducibility.command} />} />
        <CardBody className="space-y-3">
          <pre className="overflow-x-auto rounded-md border border-border bg-bg p-3 font-mono text-xs text-fg">{run.reproducibility.command}</pre>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            {run.reproducibility.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
            <li>
              Memory: peak RSS comes from the OS for the whole process (the runtime itself included). In-process RSS and heap figures are sampled at different points and heap accounting differs between V8 and JavaScriptCore, so heap values are not directly comparable across runtimes.
            </li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
