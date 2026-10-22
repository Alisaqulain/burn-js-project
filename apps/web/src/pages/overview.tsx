import { BENCHMARK_TYPE_INFO, BENCHMARK_TYPES, METRIC_DEFINITIONS, RUNTIME_LABELS, type RunSummary, type RuntimeName } from "@bunbench/shared";
import { ArrowRight, FlaskConical, Gauge } from "lucide-react";
import { Link } from "react-router-dom";
import { ChartCard, PairedBars, RuntimeLineChart } from "@/components/charts";
import { RuntimeTag, StatusBadge } from "@/components/status";
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Table, Td, Th } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { betterLabel, formatCompact, formatHeadline, formatDateTime, formatMetric, formatMs, formatNumber, formatRelative, shortId } from "@/lib/format";
import { useQuery } from "@/lib/use-api";

function StatTile({ label, value, sub, to }: { label: string; value: React.ReactNode; sub?: React.ReactNode; to?: string }) {
  const inner = (
    <>
      <p className="text-xs font-medium text-subtle">{label}</p>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-fg">{value}</div>
      {sub ? <div className="mt-1 text-xs text-subtle">{sub}</div> : null}
    </>
  );
  return (
    <Card className="p-4">
      {to ? (
        <Link to={to} className="block rounded focus-visible:outline-2">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </Card>
  );
}

export function RecentRunsTable({ runs }: { runs: RunSummary[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Run</Th>
          <Th>Workload</Th>
          <Th>Status</Th>
          <Th className="text-right">Bun</Th>
          <Th className="text-right">Node.js</Th>
          <Th>Created</Th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.id} className="hover:bg-surface-2/50">
            <Td>
              <Link to={`/runs/${run.id}`} className="font-medium text-fg hover:underline">
                {run.label || shortId(run.id)}
              </Link>
            </Td>
            <Td className="text-muted">{BENCHMARK_TYPE_INFO[run.type].label}</Td>
            <Td>
              <StatusBadge status={run.status} />
            </Td>
            <Td className="tabular text-right">{run.runtimes.includes("bun") ? formatHeadline(run, "bun") : <span className="text-subtle">not run</span>}</Td>
            <Td className="tabular text-right">{run.runtimes.includes("node") ? formatHeadline(run, "node") : <span className="text-subtle">not run</span>}</Td>
            <Td className="whitespace-nowrap text-subtle" title={formatDateTime(run.createdAt)}>
              {formatRelative(run.createdAt)}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function OverviewPage() {
  const overview = useQuery(() => api.overview(), "overview");
  const recent = useQuery(() => api.listRuns({ page: 1, pageSize: 6 }), "recent");

  const actions = (
    <Button asChild variant="primary">
      <Link to="/new">
        <FlaskConical aria-hidden /> New benchmark
      </Link>
    </Button>
  );

  if (overview.error) {
    return (
      <>
        <PageHeader title="Overview" actions={actions} />
        <ErrorState error={overview.error} onRetry={() => void overview.reload()} />
      </>
    );
  }
  if (overview.loading || !overview.data) {
    return (
      <>
        <PageHeader title="Overview" actions={actions} />
        <PageSkeleton />
      </>
    );
  }

  const o = overview.data;
  if (o.totalRuns === 0) {
    return (
      <>
        <PageHeader title="Overview" description="Measured, repeatable Bun vs Node.js benchmarks on this machine." actions={actions} />
        <EmptyState
          icon={<Gauge aria-hidden />}
          title="No benchmark data yet"
          description="Every number on this dashboard comes from a real run on this machine. Run your first benchmark to populate it."
          action={
            <Button asChild variant="primary">
              <Link to="/new">Run a benchmark</Link>
            </Button>
          }
        />
        <QuickActions />
      </>
    );
  }

  const trendRuntimes: RuntimeName[] = ["bun", "node"];
  const rpsData = o.httpTrend.map((t, i) => ({ idx: i + 1, at: t.createdAt, bun: t.bunRps, node: t.nodeRps }));
  const p95Data = o.httpTrend.map((t, i) => ({ idx: i + 1, at: t.createdAt, bun: t.bunP95, node: t.nodeP95 }));
  const lc = o.latestComparison;

  return (
    <>
      <PageHeader title="Overview" description="Measured, repeatable Bun vs Node.js benchmarks on this machine." actions={actions} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Benchmark runs" value={formatNumber(o.totalRuns, 0)} sub={`${formatNumber(o.completedRuns, 0)} completed`} to="/history" />
        <StatTile
          label="Latest execution"
          value={o.latestRun ? <StatusBadge status={o.latestRun.status} className="text-base [&_svg]:size-5" /> : "—"}
          sub={o.latestRun ? `${BENCHMARK_TYPE_INFO[o.latestRun.type].label} · ${formatRelative(o.latestRun.createdAt)}` : undefined}
          to={o.latestRun ? `/runs/${o.latestRun.id}` : undefined}
        />
        <StatTile
          label="Faster in latest comparison"
          value={lc?.leader ? <RuntimeTag runtime={lc.leader} className="text-2xl font-semibold [&>span]:size-3" /> : "—"}
          sub={
            lc
              ? lc.leader
                ? `${formatNumber(lc.factor, 2)}× on ${METRIC_DEFINITIONS[lc.metric].label.toLowerCase()} · ${BENCHMARK_TYPE_INFO[lc.type].label} · one run, this machine`
                : "No measurable difference"
              : "Run a benchmark with both runtimes"
          }
          to={lc ? `/runs/${lc.runId}` : undefined}
        />
        <StatTile
          label="Avg HTTP throughput"
          value={
            o.httpThroughput ? (
              <span className="flex flex-wrap gap-x-4 gap-y-1 text-lg">
                {(["bun", "node"] as const).map((r) =>
                  o.httpThroughput!.byRuntime[r] != null ? (
                    <span key={r} className="inline-flex items-baseline gap-1.5">
                      <span aria-hidden className={r === "bun" ? "size-2 self-center rounded-full bg-bun" : "size-2 self-center rounded-full bg-node"} />
                      <span className="sr-only">{RUNTIME_LABELS[r]}</span>
                      {formatCompact(o.httpThroughput!.byRuntime[r])}
                      <span className="text-xs font-normal text-subtle">req/s</span>
                    </span>
                  ) : null,
                )}
              </span>
            ) : (
              "—"
            )
          }
          sub={o.httpThroughput ? <span className="line-clamp-2" title={o.httpThroughput.params}>{`Mean of ${o.httpThroughput.runCount} run(s) with identical config: ${o.httpThroughput.params}`}</span> : "No completed HTTP runs"}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {o.httpTrend.length > 0 ? (
          <>
            <ChartCard
              title="HTTP throughput trend"
              hint={`Successful req/s, higher is better · same configuration only (${o.httpThroughput?.params ?? ""})`}
              runtimes={trendRuntimes}
              table={{
                columns: [
                  { key: "idx", label: "#" },
                  { key: "at", label: "Run time", format: (v) => formatDateTime(v as string) },
                  { key: "bun", label: "Bun req/s", format: (v) => formatNumber(v as number, 0) },
                  { key: "node", label: "Node.js req/s", format: (v) => formatNumber(v as number, 0) },
                ],
                rows: rpsData,
              }}
            >
              <RuntimeLineChart data={rpsData} runtimes={trendRuntimes} xKey="idx" xLabel={(v) => `Run #${String(v)}`} format={(v) => formatCompact(v)} />
            </ChartCard>
            <ChartCard
              title="HTTP P95 latency trend"
              hint="95th percentile request latency, lower is better · same configuration only"
              runtimes={trendRuntimes}
              table={{
                columns: [
                  { key: "idx", label: "#" },
                  { key: "at", label: "Run time", format: (v) => formatDateTime(v as string) },
                  { key: "bun", label: "Bun P95", format: (v) => formatMs(v as number) },
                  { key: "node", label: "Node.js P95", format: (v) => formatMs(v as number) },
                ],
                rows: p95Data,
              }}
            >
              <RuntimeLineChart data={p95Data} runtimes={trendRuntimes} xKey="idx" xLabel={(v) => `Run #${String(v)}`} format={(v) => formatMs(v)} />
            </ChartCard>
          </>
        ) : (
          <Card className="xl:col-span-2">
            <CardBody>
              <EmptyState
                title="No HTTP trend yet"
                description="Throughput and latency trends appear after completed HTTP benchmarks. Only runs with identical configuration are plotted together."
                action={
                  <Button asChild>
                    <Link to="/new?type=http">Run an HTTP benchmark</Link>
                  </Button>
                }
              />
            </CardBody>
          </Card>
        )}
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Runtime comparison by workload"
          description="Latest completed run with both runtimes for each workload. Each panel has its own unit; values are not comparable across panels."
        />
        <CardBody>
          {o.runtimeComparison.length === 0 ? (
            <p className="text-sm text-subtle">No run has measured both runtimes yet. Select Bun and Node.js on the New benchmark page.</p>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {o.runtimeComparison.map((c) => (
                <Link key={c.type} to={`/runs/${c.runId}`} className="block rounded-md p-1 hover:bg-surface-2/40">
                  <p className="text-sm font-medium text-fg">{BENCHMARK_TYPE_INFO[c.type].label}</p>
                  <p className="mb-2 text-xs text-subtle">
                    {METRIC_DEFINITIONS[c.metric].label} · {betterLabel(c.metric)}
                  </p>
                  <PairedBars
                    rows={(["bun", "node"] as const).map((r) => ({ runtime: r, value: c[r], label: formatMetric(c.metric, c[r]) }))}
                  />
                </Link>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Recent runs"
          description="Median iteration time (compute) or successful req/s (HTTP)"
          actions={
            <Button asChild size="sm" variant="ghost">
              <Link to="/history">
                View all <ArrowRight aria-hidden />
              </Link>
            </Button>
          }
        />
        {recent.error ? (
          <CardBody>
            <ErrorState error={recent.error} onRetry={() => void recent.reload()} />
          </CardBody>
        ) : recent.data ? (
          <RecentRunsTable runs={recent.data.items} />
        ) : (
          <CardBody>
            <PageSkeleton rows={0} />
          </CardBody>
        )}
      </Card>

      <QuickActions />
    </>
  );
}

function QuickActions() {
  return (
    <section className="mt-6" aria-labelledby="quick-actions">
      <h2 id="quick-actions" className="mb-3 text-sm font-semibold text-fg">
        Quick start
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {BENCHMARK_TYPES.map((type) => (
          <Link key={type} to={`/new?type=${type}`} className="rounded-lg border border-border bg-surface p-3 transition-colors hover:border-border-strong hover:bg-surface-2/50">
            <p className="text-sm font-medium text-fg">{BENCHMARK_TYPE_INFO[type].label}</p>
            <p className="mt-1 line-clamp-2 text-xs text-subtle">{BENCHMARK_TYPE_INFO[type].description}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
