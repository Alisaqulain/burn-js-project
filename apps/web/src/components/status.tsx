import { type ExecutionStatus, RUNTIME_LABELS, type RunStatus, type RuntimeName } from "@bunbench/shared";
import { AlertTriangle, Ban, CheckCircle2, CircleDashed, Clock, Loader2, PlugZap, Timer, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const STATUS: Record<RunStatus | ExecutionStatus, { label: string; icon: ReactNode; className: string }> = {
  queued: { label: "Queued", icon: <Clock aria-hidden />, className: "text-muted" },
  pending: { label: "Pending", icon: <Clock aria-hidden />, className: "text-muted" },
  preparing: { label: "Preparing", icon: <Loader2 aria-hidden className="animate-spin" />, className: "text-fg" },
  running: { label: "Running", icon: <Loader2 aria-hidden className="animate-spin" />, className: "text-fg" },
  completed: { label: "Completed", icon: <CheckCircle2 aria-hidden />, className: "text-good-text" },
  failed: { label: "Failed", icon: <XCircle aria-hidden />, className: "text-critical-text" },
  timeout: { label: "Timed out", icon: <Timer aria-hidden />, className: "text-critical-text" },
  cancelled: { label: "Cancelled", icon: <Ban aria-hidden />, className: "text-subtle" },
  unavailable: { label: "Unavailable", icon: <PlugZap aria-hidden />, className: "text-subtle" },
};

/** Status is always icon + label, never color alone. */
export function StatusBadge({ status, className }: { status: RunStatus | ExecutionStatus; className?: string }) {
  const s = STATUS[status] ?? { label: status, icon: <CircleDashed aria-hidden />, className: "text-muted" };
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium [&_svg]:size-3.5", s.className, className)}>
      {s.icon}
      {s.label}
    </span>
  );
}

export function RuntimeTag({ runtime, className }: { runtime: RuntimeName; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-fg", className)}>
      <span aria-hidden className={cn("size-2 rounded-full", runtime === "bun" ? "bg-bun" : "bg-node")} />
      {RUNTIME_LABELS[runtime]}
    </span>
  );
}

export function Callout({ tone = "info", title, children }: { tone?: "info" | "warning" | "error"; title?: ReactNode; children: ReactNode }) {
  const icon = tone === "info" ? null : tone === "warning" ? <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" /> : <XCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-critical" />;
  return (
    <div
      role={tone === "error" ? "alert" : "note"}
      className={cn(
        "flex gap-2.5 rounded-md border px-3 py-2.5 text-sm",
        tone === "error" ? "border-critical/40 bg-critical/5" : tone === "warning" ? "border-warning/40 bg-warning/5" : "border-border bg-surface-2",
      )}
    >
      {icon}
      <div className="min-w-0 text-muted">
        {title ? <p className="font-medium text-fg">{title}</p> : null}
        <div className={title ? "mt-0.5" : undefined}>{children}</div>
      </div>
    </div>
  );
}
