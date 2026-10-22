import { METRIC_DEFINITIONS, type MetricKey, type RunSummary, type RuntimeName } from "@bunbench/shared";

const nf = (digits: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return nf(digits).format(value);
}

/** Milliseconds with precision that adapts to magnitude. */
export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1) return `${nf(3).format(ms)} ms`;
  if (ms < 100) return `${nf(2).format(ms)} ms`;
  if (ms < 10_000) return `${nf(1).format(ms)} ms`;
  return `${nf(2).format(ms / 1_000)} s`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${nf(i === 0 ? 0 : 1).format(v)} ${units[i]}`;
}

export function formatCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.floor(ms / 1_000);
  if (s < 60) return `${(ms / 1_000).toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const diff = now - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return "—";
  const s = Math.round(diff / 1_000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

/** Formats a metric value using its unit from METRIC_DEFINITIONS. */
export function formatMetric(metric: MetricKey, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const { unit } = METRIC_DEFINITIONS[metric];
  switch (unit) {
    case "ms":
      return formatMs(value);
    case "bytes":
      return formatBytes(value);
    case "%":
      return `${formatNumber(value, 2)}%`;
    case "count":
      return formatNumber(value, 0);
    case "ops/s":
    case "req/s":
      return `${formatCompact(value)} ${unit}`;
    default:
      return formatNumber(value);
  }
}

export function betterLabel(metric: MetricKey): string {
  const b = METRIC_DEFINITIONS[metric].better;
  return b === "lower" ? "lower is better" : b === "higher" ? "higher is better" : "informational";
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Headline metric (median time or HTTP req/s) of a run for one runtime. */
export function formatHeadline(run: RunSummary, runtime: RuntimeName): string {
  const h = run.headline[runtime];
  return h ? formatMetric(h.metric, h.value) : "—";
}
