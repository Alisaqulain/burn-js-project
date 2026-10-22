import { RUNTIME_LABELS } from "@bunbench/shared";
import { ExternalLink, RefreshCw } from "lucide-react";
import { StatusBadge } from "@/components/status";
import { ErrorState, PageHeader, PageSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Kbd } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/use-api";

const SOURCE_LABEL = {
  env: "Environment variable override",
  "current-process": "The Bun process running the API",
  path: "Found on PATH",
  none: "Not found",
} as const;

export function RuntimesPage() {
  const runtimes = useQuery(() => api.runtimes(), "runtimes");
  return (
    <>
      <PageHeader
        title="Runtimes"
        description="BunBench launches each runtime as a separate process. Missing runtimes are skipped, never simulated."
        actions={
          <Button
            onClick={() => {
              void api.runtimes(true).then(() => runtimes.reload(), () => runtimes.reload());
            }}
            disabled={runtimes.refreshing}
          >
            <RefreshCw aria-hidden className={runtimes.refreshing ? "animate-spin" : undefined} /> Re-detect
          </Button>
        }
      />
      {runtimes.error ? (
        <ErrorState error={runtimes.error} onRetry={() => void runtimes.reload()} />
      ) : !runtimes.data ? (
        <PageSkeleton rows={1} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {runtimes.data.map((r) => (
            <Card key={r.name}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <span aria-hidden className={r.name === "bun" ? "size-2.5 rounded-full bg-bun" : "size-2.5 rounded-full bg-node"} />
                    {RUNTIME_LABELS[r.name]}
                  </span>
                }
                actions={<StatusBadge status={r.available ? "completed" : "unavailable"} />}
              />
              <CardBody>
                <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-subtle">Status</dt>
                  <dd className="text-fg">{r.available ? "Available" : "Unavailable"}</dd>
                  <dt className="text-subtle">Version</dt>
                  <dd className="tabular text-fg">{r.version ? `v${r.version}` : "—"}</dd>
                  <dt className="text-subtle">Executable</dt>
                  <dd className="font-mono text-xs break-all text-fg">{r.path ?? "hidden or unknown"}</dd>
                  <dt className="text-subtle">Detected via</dt>
                  <dd className="text-fg">{SOURCE_LABEL[r.source]}</dd>
                  {r.reason ? (
                    <>
                      <dt className="text-subtle">Reason</dt>
                      <dd className="text-critical-text">{r.reason}</dd>
                    </>
                  ) : null}
                </dl>
                {!r.available ? (
                  <div className="mt-4 rounded-md border border-border bg-surface-2 p-3 text-sm">
                    <p className="font-medium text-fg">How to install</p>
                    <p className="mt-1 text-muted">{r.installHint}</p>
                  </div>
                ) : null}
                <a href={r.docsUrl} target="_blank" rel="noreferrer noopener" className="mt-4 inline-flex items-center gap-1 text-sm text-fg underline-offset-4 hover:underline">
                  Official {RUNTIME_LABELS[r.name]} documentation <ExternalLink aria-hidden className="size-3.5" />
                </a>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      <Card className="mt-6">
        <CardHeader title="Choosing executables" />
        <CardBody className="space-y-2 text-sm text-muted">
          <p>
            By default BunBench benchmarks the Bun that runs the API and the first <Kbd>node</Kbd> on <Kbd>PATH</Kbd>. To pin specific versions, set{" "}
            <Kbd>BUNBENCH_BUN_PATH</Kbd> or <Kbd>BUNBENCH_NODE_PATH</Kbd> to an absolute executable path in <Kbd>.env</Kbd> and restart the API.
          </p>
          <p>For safety, executables can only be configured by the operator through environment variables, never through the web interface or API.</p>
          <p>Node.js 22.18 or newer is required because the Node runner executes TypeScript through Node's built-in type stripping.</p>
        </CardBody>
      </Card>
    </>
  );
}
