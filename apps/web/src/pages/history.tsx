import { BENCHMARK_TYPE_INFO, BENCHMARK_TYPES, type ListRunsQuery, RUN_STATUSES, RUNTIME_LABELS, RUNTIMES, TERMINAL_RUN_STATUSES } from "@bunbench/shared";
import { ChevronLeft, ChevronRight, Download, GitCompareArrows, History as HistoryIcon, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { RuntimeTag, StatusBadge } from "@/components/status";
import { EmptyState, ErrorState, PageHeader } from "@/components/states";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Card, Input, Label, Select, Skeleton, Table, Td, Th } from "@/components/ui/primitives";
import { api, describeError } from "@/lib/api";
import { formatDateTime, formatHeadline, shortId } from "@/lib/format";
import { useQuery } from "@/lib/use-api";

const FILTER_KEYS = ["q", "runtime", "type", "status", "from", "to"] as const;
const PAGE_SIZE = 20;
const MAX_COMPARE = 6;

export function HistoryPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string[]>([]);
  const [searchDraft, setSearchDraft] = useState(params.get("q") ?? "");

  const query = useMemo(() => {
    const q: Partial<ListRunsQuery> = { page: Number(params.get("page") ?? 1) || 1, pageSize: PAGE_SIZE };
    for (const key of FILTER_KEYS) {
      const v = params.get(key);
      if (v) (q as Record<string, string>)[key] = v;
    }
    return q;
  }, [params]);

  const list = useQuery(() => api.listRuns(query), JSON.stringify(query));

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setParams(next);
  };

  const goPage = (page: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(page));
    setParams(next);
  };

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= MAX_COMPARE ? (toast.warning(`Compare up to ${MAX_COMPARE} runs at a time`), s) : [...s, id]));

  const remove = async (id: string) => {
    try {
      await api.deleteRun(id);
      setSelected((s) => s.filter((x) => x !== id));
      toast.success("Run deleted");
      await list.reload();
    } catch (error) {
      const { title, hint } = describeError(error);
      toast.error(title, { description: hint });
    }
  };

  const filtersActive = FILTER_KEYS.some((k) => params.get(k));
  const data = list.data;

  return (
    <>
      <PageHeader
        title="History"
        description="Every saved benchmark run. Select runs to compare them side by side."
        actions={
          <>
            <Button disabled={selected.length === 0} onClick={() => navigate(`/compare?ids=${selected.join(",")}`)}>
              <GitCompareArrows aria-hidden /> Compare selected ({selected.length})
            </Button>
            <Button asChild variant="secondary">
              <a href={api.exportUrl(query)} download>
                <Download aria-hidden /> Export CSV
              </a>
            </Button>
          </>
        }
      />

      <Card className="mb-4 p-4">
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            setFilter("q", searchDraft.trim());
          }}
          role="search"
        >
          <div className="space-y-1.5 lg:col-span-2">
            <Label htmlFor="q">Search label or run id</Label>
            <div className="flex gap-2">
              <Input id="q" value={searchDraft} maxLength={80} placeholder="e.g. nightly or 3f2a…" onChange={(e) => setSearchDraft(e.target.value)} />
              <Button type="submit" size="icon" aria-label="Search">
                <Search aria-hidden />
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="runtime">Runtime</Label>
            <Select id="runtime" value={params.get("runtime") ?? ""} onChange={(e) => setFilter("runtime", e.target.value)}>
              <option value="">Any</option>
              {RUNTIMES.map((r) => (
                <option key={r} value={r}>
                  {RUNTIME_LABELS[r]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="type">Workload</Label>
            <Select id="type" value={params.get("type") ?? ""} onChange={(e) => setFilter("type", e.target.value)}>
              <option value="">Any</option>
              {BENCHMARK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {BENCHMARK_TYPE_INFO[t].label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="status">Status</Label>
            <Select id="status" value={params.get("status") ?? ""} onChange={(e) => setFilter("status", e.target.value)}>
              <option value="">Any</option>
              {RUN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s[0]!.toUpperCase() + s.slice(1)}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="from">From</Label>
              <Input id="from" type="date" value={params.get("from") ?? ""} onChange={(e) => setFilter("from", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">To</Label>
              <Input id="to" type="date" value={params.get("to") ?? ""} onChange={(e) => setFilter("to", e.target.value)} />
            </div>
          </div>
        </form>
        {filtersActive ? (
          <Button
            className="mt-3"
            size="sm"
            variant="ghost"
            onClick={() => {
              setSearchDraft("");
              setParams(new URLSearchParams());
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </Card>

      {list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.reload()} />
      ) : !data ? (
        <Card className="space-y-2 p-4" aria-busy="true" aria-label="Loading runs">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </Card>
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={<HistoryIcon aria-hidden />}
          title={filtersActive ? "No runs match these filters" : "No saved runs yet"}
          description={filtersActive ? "Adjust or clear the filters." : "Completed, failed and cancelled runs appear here."}
          action={
            filtersActive ? undefined : (
              <Button asChild variant="primary">
                <Link to="/new">Run a benchmark</Link>
              </Button>
            )
          }
        />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th className="w-10">
                  <span className="sr-only">Select</span>
                </Th>
                <Th>Run</Th>
                <Th>Workload</Th>
                <Th>Runtimes</Th>
                <Th>Status</Th>
                <Th className="text-right">Bun</Th>
                <Th className="text-right">Node.js</Th>
                <Th>Created</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((run) => (
                <tr key={run.id} className="hover:bg-surface-2/50">
                  <Td>
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--fg)]"
                      aria-label={`Select ${run.label || shortId(run.id)} for comparison`}
                      checked={selected.includes(run.id)}
                      onChange={() => toggle(run.id)}
                    />
                  </Td>
                  <Td>
                    <Link to={`/runs/${run.id}`} className="font-medium text-fg hover:underline">
                      {run.label || shortId(run.id)}
                    </Link>
                    <span className="block font-mono text-xs text-subtle">{shortId(run.id)}</span>
                  </Td>
                  <Td className="text-muted">{BENCHMARK_TYPE_INFO[run.type].label}</Td>
                  <Td>
                    <span className="flex flex-col gap-1">
                      {run.runtimes.map((r) => (
                        <RuntimeTag key={r} runtime={r} />
                      ))}
                    </span>
                  </Td>
                  <Td>
                    <StatusBadge status={run.status} />
                  </Td>
                  <Td className="tabular text-right whitespace-nowrap">{run.runtimes.includes("bun") ? formatHeadline(run, "bun") : "—"}</Td>
                  <Td className="tabular text-right whitespace-nowrap">{run.runtimes.includes("node") ? formatHeadline(run, "node") : "—"}</Td>
                  <Td className="whitespace-nowrap text-subtle">{formatDateTime(run.createdAt)}</Td>
                  <Td>
                    {TERMINAL_RUN_STATUSES.includes(run.status) ? (
                      <ConfirmDialog
                        trigger={
                          <Button size="icon" variant="ghost" aria-label={`Delete ${run.label || shortId(run.id)}`}>
                            <Trash2 aria-hidden />
                          </Button>
                        }
                        title="Delete this run?"
                        description={`"${run.label || shortId(run.id)}" and all of its measurements will be permanently removed.`}
                        confirmLabel="Delete"
                        onConfirm={() => void remove(run.id)}
                      />
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex items-center justify-between gap-2 px-4 py-3 text-sm text-subtle">
            <span>
              {data.total} run{data.total === 1 ? "" : "s"} · page {data.page} of {data.totalPages}
            </span>
            <div className="flex gap-2">
              <Button size="sm" disabled={data.page <= 1} onClick={() => goPage(data.page - 1)} aria-label="Previous page">
                <ChevronLeft aria-hidden /> Previous
              </Button>
              <Button size="sm" disabled={data.page >= data.totalPages} onClick={() => goPage(data.page + 1)} aria-label="Next page">
                Next <ChevronRight aria-hidden />
              </Button>
            </div>
          </div>
        </Card>
      )}
      <p className="mt-3 text-xs text-subtle">
        Bun / Node.js columns show the median iteration time (compute workloads, lower is better) or successful requests per second (HTTP, higher is better).
      </p>
    </>
  );
}
