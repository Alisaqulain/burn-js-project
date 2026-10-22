import {
  BENCHMARK_TYPE_INFO,
  type LiveProgress,
  RUNTIME_LABELS,
  type RunDetail,
  type RunStreamEvent,
  TERMINAL_RUN_STATUSES,
} from "@bunbench/shared";
import { GitCompareArrows, Loader2, RotateCcw, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { RunResults } from "@/components/results";
import { Callout, RuntimeTag, StatusBadge } from "@/components/status";
import { ErrorState, PageHeader, PageSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { api, describeError } from "@/lib/api";
import { formatDateTime, formatDuration, shortId } from "@/lib/format";
import { overallProgress } from "@/lib/progress";
import { useQuery } from "@/lib/use-api";
import { newIdempotencyKey } from "@/lib/utils";

interface LogEntry {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
}

const POLL_INTERVAL_MS = 1_500;

/** Subscribes to live progress over SSE; falls back to polling if the stream is unavailable. */
function useLiveProgress(id: string, initial: LiveProgress | null, onDone: () => void) {
  const [live, setLive] = useState<LiveProgress | null>(initial);
  const [transport, setTransport] = useState<"sse" | "polling">(typeof EventSource === "undefined" ? "polling" : "sse");
  // Seeded at mount when EventSource is missing; otherwise added by the error handler below.
  const [initialLog] = useState<LogEntry[]>(() => (typeof EventSource === "undefined" ? [{ at: Date.now(), level: "warn", message: "Live stream unsupported: polling for updates." }] : []));
  const [log, setLog] = useState<LogEntry[]>(initialLog);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const push = (level: LogEntry["level"], message: string) => setLog((l) => [...l.slice(-199), { at: Date.now(), level, message }]);

  useEffect(() => {
    if (transport !== "sse") return;
    const source = new EventSource(api.eventsUrl(id));
    const handle = (raw: MessageEvent<string>) => {
      let event: RunStreamEvent;
      try {
        event = JSON.parse(raw.data) as RunStreamEvent;
      } catch {
        return;
      }
      switch (event.type) {
        case "snapshot":
        case "progress":
          setLive(event.live);
          break;
        case "status":
          push("info", `Status: ${event.status}${event.message ? ` (${event.message})` : ""}`);
          break;
        case "execution":
          push(
            event.status === "failed" || event.status === "timeout" ? "error" : event.status === "unavailable" ? "warn" : "info",
            `${RUNTIME_LABELS[event.runtime]} round ${event.round}: ${event.status}${event.message ? ` (${event.message})` : ""}`,
          );
          break;
        case "log":
          push(event.level, event.message);
          break;
        case "done":
          doneRef.current = true;
          source.close();
          push("info", `Finished: ${event.status}`);
          onDoneRef.current();
          break;
      }
    };
    for (const name of ["snapshot", "progress", "status", "execution", "log", "done"]) source.addEventListener(name, handle as EventListener);
    source.onerror = () => {
      if (doneRef.current) return;
      // EventSource retries automatically; switch to polling if the connection never opened.
      if (source.readyState === EventSource.CLOSED) {
        push("warn", "Live stream unavailable: polling for updates.");
        setTransport("polling");
      }
    };
    return () => source.close();
  }, [id, transport]);

  useEffect(() => {
    if (transport !== "polling") return;
    const timer = setInterval(() => {
      api.getRun(id).then(
        (run) => {
          if (run.live) setLive(run.live);
          if (TERMINAL_RUN_STATUSES.includes(run.status) && !doneRef.current) {
            doneRef.current = true;
            clearInterval(timer);
            onDoneRef.current();
          }
        },
        () => undefined,
      );
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [id, transport]);

  return { live, log, transport };
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function LiveView({ run, onDone }: { run: RunDetail; onDone: () => void }) {
  const { live, log, transport } = useLiveProgress(run.id, run.live, onDone);
  const [cancelling, setCancelling] = useState(false);
  const status = live?.status ?? run.status;
  const startedAt = live?.startedAt ?? run.startedAt;
  const now = useNow(true);
  const progress = live ? overallProgress(live, run) : null;

  const cancel = async () => {
    setCancelling(true);
    try {
      await api.cancelRun(run.id);
      toast.message("Cancellation requested", { description: "Stopping runner processes…" });
    } catch (error) {
      const { title, hint } = describeError(error);
      toast.error(title, { description: hint });
      setCancelling(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-3">
              <StatusBadge status={status} className="text-sm" />
              <span className="text-xs font-normal text-subtle">{transport === "sse" ? "Live (server-sent events)" : "Live (polling)"}</span>
            </span>
          }
          actions={
            <Button variant="danger" size="sm" onClick={() => void cancel()} disabled={cancelling}>
              {cancelling ? <Loader2 aria-hidden className="animate-spin" /> : <Square aria-hidden />}
              {cancelling ? "Cancelling…" : "Cancel"}
            </Button>
          }
        />
        <CardBody className="space-y-5">
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-subtle">Elapsed</dt>
              <dd className="tabular mt-1 font-medium text-fg">{startedAt ? formatDuration(now - new Date(startedAt).getTime()) : "Waiting to start"}</dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">Current runtime</dt>
              <dd className="mt-1">{live?.runtime ? <RuntimeTag runtime={live.runtime} className="text-sm" /> : <span className="text-subtle">—</span>}</dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">Round</dt>
              <dd className="tabular mt-1 font-medium text-fg">
                {live?.round ?? "—"} / {run.config.rounds}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-subtle">Processes finished</dt>
              <dd className="tabular mt-1 font-medium text-fg">{live && live.executionsTotal > 0 ? `${live.executionsDone} / ${live.executionsTotal}` : "—"}</dd>
            </div>
          </dl>

          <div>
            <div className="mb-1.5 flex justify-between text-xs text-subtle">
              <span>
                {live?.phase === "warmup"
                  ? `Warm-up ${live.iteration} of ${live.total}`
                  : live?.phase === "measured"
                    ? `Measured iteration ${live.iteration} of ${live.total}`
                    : live?.phase === "server-start"
                      ? "Starting HTTP server"
                      : live?.phase === "verifying"
                        ? "Verifying results"
                        : (live?.message ?? (status === "queued" ? "Waiting for a free slot" : "Preparing"))}
              </span>
              {progress != null ? <span className="tabular">{Math.round(progress * 100)}%</span> : null}
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-surface-2"
              role="progressbar"
              aria-label="Benchmark progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress != null ? Math.round(progress * 100) : undefined}
            >
              {progress != null ? (
                <div className="h-full rounded-full bg-fg transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
              ) : (
                <div className="h-full w-1/3 animate-pulse rounded-full bg-border-strong" />
              )}
            </div>
            <p className="mt-1.5 text-xs text-subtle">Progress counts completed processes and iterations only; iteration durations vary, so this is not a time estimate.</p>
          </div>
          {live?.message ? <p className="text-sm text-muted">{live.message}</p> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Event log" />
        <CardBody>
          {log.length === 0 ? (
            <p className="text-sm text-subtle">Waiting for events…</p>
          ) : (
            <ol className="max-h-64 space-y-1 overflow-y-auto font-mono text-xs" aria-live="polite">
              {log.map((entry, i) => (
                <li key={i} className={entry.level === "error" ? "text-critical-text" : entry.level === "warn" ? "text-fg" : "text-muted"}>
                  <span className="text-subtle">{new Date(entry.at).toLocaleTimeString()}</span> {entry.level === "warn" ? "⚠ " : entry.level === "error" ? "✕ " : ""}
                  {entry.message}
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export function RunPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const query = useQuery(() => api.getRun(id), id);
  const run = query.data;

  const rerun = async () => {
    if (!run) return;
    try {
      const created = await api.createRun(run.config, newIdempotencyKey());
      toast.success("Benchmark queued with the same configuration");
      navigate(`/runs/${created.id}`);
    } catch (error) {
      const { title, hint } = describeError(error);
      toast.error(title, { description: hint });
    }
  };

  const remove = async () => {
    try {
      await api.deleteRun(id);
      toast.success("Run deleted");
      navigate("/history");
    } catch (error) {
      const { title, hint } = describeError(error);
      toast.error(title, { description: hint });
    }
  };

  if (query.error) {
    return (
      <>
        <PageHeader title="Benchmark run" />
        <ErrorState error={query.error} onRetry={() => void query.reload()} />
      </>
    );
  }
  if (!run) {
    return (
      <>
        <PageHeader title="Benchmark run" />
        <PageSkeleton />
      </>
    );
  }

  const active = !TERMINAL_RUN_STATUSES.includes(run.status);
  return (
    <>
      <PageHeader
        title={run.label || `Run ${shortId(run.id)}`}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{BENCHMARK_TYPE_INFO[run.type].label}</span>
            <span className="flex gap-2">
              {run.runtimes.map((r) => (
                <RuntimeTag key={r} runtime={r} />
              ))}
            </span>
            <span>Created {formatDateTime(run.createdAt)}</span>
            {run.durationMs != null ? <span>Took {formatDuration(run.durationMs)}</span> : null}
            {!active ? <StatusBadge status={run.status} /> : null}
          </span>
        }
        actions={
          active ? null : (
            <>
              <Button asChild size="sm">
                <Link to={`/compare?ids=${run.id}`}>
                  <GitCompareArrows aria-hidden /> Compare
                </Link>
              </Button>
              <Button size="sm" onClick={() => void rerun()}>
                <RotateCcw aria-hidden /> Run again
              </Button>
              <ConfirmDialog
                trigger={
                  <Button size="sm" variant="ghost" aria-label="Delete run">
                    <Trash2 aria-hidden /> Delete
                  </Button>
                }
                title="Delete this run?"
                description="Its measurements and results will be permanently removed from the local database."
                confirmLabel="Delete"
                onConfirm={() => void remove()}
              />
            </>
          )
        }
      />
      {run.errorMessage && !active ? (
        <div className="mb-6">
          <Callout tone={run.status === "cancelled" ? "warning" : "error"} title={run.status === "cancelled" ? "Run cancelled" : "Run failed"}>
            {run.errorMessage}
          </Callout>
        </div>
      ) : null}
      {active ? <LiveView key={run.id} run={run} onDone={() => void query.reload()} /> : <RunResults run={run} />}
    </>
  );
}
