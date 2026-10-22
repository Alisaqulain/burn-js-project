import { BENCHMARK_TYPE_INFO, METRIC_DEFINITIONS, RUNTIME_LABELS, type RuntimeName } from "@bunbench/shared";
import { GitCompareArrows } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChartCard, RuntimeBarChart } from "@/components/charts";
import { Callout, RuntimeTag, StatusBadge } from "@/components/status";
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Table, Td, Th } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { betterLabel, formatDateTime, formatMetric, formatNumber, shortId } from "@/lib/format";
import { useQuery } from "@/lib/use-api";

const RUNTIME_PAIR: RuntimeName[] = ["bun", "node"];

function RunPicker({ initial }: { initial: string[] }) {
  const [, setParams] = useSearchParams();
  const [selected, setSelected] = useState<string[]>(initial);
  const runs = useQuery(() => api.listRuns({ page: 1, pageSize: 30, status: "completed" }), "picker");
  if (runs.error) return <ErrorState error={runs.error} onRetry={() => void runs.reload()} />;
  if (!runs.data) return <PageSkeleton rows={1} />;
  if (runs.data.items.length === 0) {
    return (
      <EmptyState
        icon={<GitCompareArrows aria-hidden />}
        title="Nothing to compare yet"
        description="Comparisons use saved, completed runs. Run a benchmark first."
        action={
          <Button asChild variant="primary">
            <Link to="/new">Run a benchmark</Link>
          </Button>
        }
      />
    );
  }
  return (
    <Card>
      <CardHeader
        title="Choose runs to compare"
        description="Pick up to 6 completed runs. Runs with identical configuration are grouped together."
        actions={
          <Button variant="primary" size="sm" disabled={selected.length === 0} onClick={() => setParams({ ids: selected.join(",") })}>
            Compare ({selected.length})
          </Button>
        }
      />
      <Table>
        <thead>
          <tr>
            <Th className="w-10">
              <span className="sr-only">Select</span>
            </Th>
            <Th>Run</Th>
            <Th>Workload</Th>
            <Th>Config</Th>
            <Th>Created</Th>
          </tr>
        </thead>
        <tbody>
          {runs.data.items.map((r) => (
            <tr key={r.id}>
              <Td>
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--fg)]"
                  aria-label={`Select ${r.label || shortId(r.id)}`}
                  checked={selected.includes(r.id)}
                  disabled={!selected.includes(r.id) && selected.length >= 6}
                  onChange={() => setSelected((s) => (s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id]))}
                />
              </Td>
              <Td className="font-medium">{r.label || shortId(r.id)}</Td>
              <Td className="text-muted">{BENCHMARK_TYPE_INFO[r.type].label}</Td>
              <Td className="font-mono text-xs text-subtle">{r.configHash.slice(0, 8)}</Td>
              <Td className="text-subtle">{formatDateTime(r.createdAt)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

export function ComparePage() {
  const [params, setParams] = useSearchParams();
  const ids = (params.get("ids") ?? "").split(",").filter(Boolean).slice(0, 6);
  const comparison = useQuery(() => (ids.length ? api.compare(ids) : Promise.resolve(null)), ids.join(","));

  if (ids.length === 0) {
    return (
      <>
        <PageHeader title="Compare" description="Compare saved runs using their stored measurements." />
        <RunPicker initial={[]} />
      </>
    );
  }

  const data = comparison.data;
  return (
    <>
      <PageHeader
        title="Compare"
        description="All values come from saved measurements. Only runs in the same configuration group are directly comparable."
        actions={<Button onClick={() => setParams({})}>Choose different runs</Button>}
      />
      {comparison.error ? (
        <ErrorState error={comparison.error} onRetry={() => void comparison.reload()} />
      ) : !data ? (
        <PageSkeleton rows={2} />
      ) : (
        <div className="space-y-6">
          {data.warnings.map((w, i) => (
            <Callout key={i} tone="warning">
              {w.message}
            </Callout>
          ))}

          <Card>
            <CardHeader title="Runtime ratio per run" description="Headline metric: median iteration time (compute) or successful req/s (HTTP)." />
            <Table>
              <thead>
                <tr>
                  <Th>Run</Th>
                  <Th>Status</Th>
                  <Th>Metric</Th>
                  <Th className="text-right">
                    <RuntimeTag runtime="bun" />
                  </Th>
                  <Th className="text-right">
                    <RuntimeTag runtime="node" />
                  </Th>
                  <Th>Result</Th>
                </tr>
              </thead>
              <tbody>
                {data.ratios.map((ratio) => {
                  const run = data.runs.find((r) => r.id === ratio.runId)!;
                  return (
                    <tr key={ratio.runId}>
                      <Td>
                        <Link to={`/runs/${run.id}`} className="font-medium hover:underline">
                          {run.label || shortId(run.id)}
                        </Link>
                        <span className="block text-xs text-subtle">
                          {BENCHMARK_TYPE_INFO[run.type].label} · config {run.configHash.slice(0, 8)}
                        </span>
                      </Td>
                      <Td>
                        <StatusBadge status={run.status} />
                      </Td>
                      <Td className="text-xs text-muted">
                        {METRIC_DEFINITIONS[ratio.metric].label}
                        <span className="block text-subtle">{betterLabel(ratio.metric)}</span>
                      </Td>
                      <Td className="tabular text-right">{formatMetric(ratio.metric, ratio.bun)}</Td>
                      <Td className="tabular text-right">{formatMetric(ratio.metric, ratio.node)}</Td>
                      <Td className="text-sm">
                        {ratio.leader ? (
                          <>
                            <RuntimeTag runtime={ratio.leader} /> <span className="text-muted">by {formatNumber(ratio.factor, 2)}×</span>
                          </>
                        ) : (
                          <span className="text-subtle">{ratio.bun == null || ratio.node == null ? "Incomplete: not both runtimes" : "No difference"}</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>

          {data.groups.map((group) => {
            const runs = data.runs.filter((r) => group.runIds.includes(r.id));
            const metric = data.ratios.find((r) => r.runId === runs[0]!.id)!.metric;
            const rows = runs.map((r) => {
              const ratio = data.ratios.find((x) => x.runId === r.id)!;
              return { category: r.label || shortId(r.id), bun: ratio.bun, node: ratio.node };
            });
            return (
              <ChartCard
                key={group.configHash}
                title={`${BENCHMARK_TYPE_INFO[group.type].label} · configuration ${group.configHash.slice(0, 8)}`}
                hint={`${METRIC_DEFINITIONS[metric].label} (${METRIC_DEFINITIONS[metric].unit}) · ${betterLabel(metric)} · ${runs.length} run(s) with identical settings`}
                runtimes={RUNTIME_PAIR}
                height={260}
                table={{
                  columns: [
                    { key: "category", label: "Run" },
                    ...RUNTIME_PAIR.map((r) => ({ key: r, label: RUNTIME_LABELS[r], format: (v: unknown) => formatMetric(metric, v as number | null) })),
                  ],
                  rows,
                }}
              >
                <RuntimeBarChart data={rows} runtimes={RUNTIME_PAIR} format={(v) => formatMetric(metric, v)} />
              </ChartCard>
            );
          })}
        </div>
      )}
    </>
  );
}
