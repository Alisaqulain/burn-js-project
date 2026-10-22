import { RUNTIME_LABELS, type RuntimeName } from "@bunbench/shared";
import { Table2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  type TooltipValueType,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Card, Table, Td, Th } from "./ui/primitives";

const SERIES_COLOR: Record<RuntimeName, string> = { bun: "var(--series-bun)", node: "var(--series-node)" };
const AXIS = { stroke: "var(--axis)" };

export function Legend({ runtimes }: { runtimes: RuntimeName[] }) {
  if (runtimes.length < 2) return null;
  return (
    <ul className="flex flex-wrap items-center gap-4 text-xs text-muted" aria-label="Legend">
      {runtimes.map((r) => (
        <li key={r} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2.5 rounded-sm", r === "bun" ? "bg-bun" : "bg-node")} />
          {RUNTIME_LABELS[r]}
        </li>
      ))}
    </ul>
  );
}

export interface TableColumn {
  key: string;
  label: string;
  format?: (v: unknown) => string;
}

/**
 * Chart card with title, direction hint, legend and a table view toggle (so no value is only
 * readable through a tooltip or color).
 */
export function ChartCard({
  title,
  hint,
  runtimes,
  height = 240,
  table,
  children,
  className,
}: {
  title: string;
  hint?: ReactNode;
  runtimes: RuntimeName[];
  height?: number;
  table: { columns: TableColumn[]; rows: Record<string, unknown>[] };
  children: ReactNode;
  className?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="flex items-start justify-between gap-2 px-4 pt-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          {hint ? <p className="mt-0.5 text-xs text-subtle">{hint}</p> : null}
        </div>
        <Button size="sm" variant="ghost" className="shrink-0" aria-pressed={showTable} onClick={() => setShowTable((v) => !v)}>
          <Table2 aria-hidden /> {showTable ? "Chart" : "Table"}
        </Button>
      </div>
      <div className="px-4 pt-2">
        <Legend runtimes={runtimes} />
      </div>
      <div className="px-2 pt-2 pb-3">
        {showTable ? (
          <div className="px-2" style={{ minHeight: height }}>
            <Table>
              <thead>
                <tr>
                  {table.columns.map((c) => (
                    <Th key={c.key}>{c.label}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i}>
                    {table.columns.map((c) => (
                      <Td key={c.key} className="tabular">
                        {c.format ? c.format(row[c.key]) : String(row[c.key] ?? "—")}
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : (
          <div style={{ height }} role="img" aria-label={`${title} chart. Use the Table button for exact values.`}>
            {children}
          </div>
        )}
      </div>
    </Card>
  );
}

function TooltipBox({ title, items }: { title: ReactNode; items: { color: string; label: string; value: string }[] }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-fg">{title}</p>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.label} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-muted">
              <span aria-hidden className="size-2 rounded-sm" style={{ background: item.color }} />
              {item.label}
            </span>
            <span className="tabular font-medium text-fg">{item.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function makeTooltip(format: (v: number) => string, labelFormat?: (label: unknown) => ReactNode) {
  return function ChartTooltip({ active, payload, label }: TooltipContentProps<TooltipValueType, string | number>) {
    if (!active || !payload?.length) return null;
    return (
      <TooltipBox
        title={labelFormat ? labelFormat(label) : String(label)}
        items={payload
          .filter((p) => typeof p.value === "number")
          .map((p) => ({ color: String(p.color ?? "var(--muted)"), label: String(p.name), value: format(p.value as number) }))}
      />
    );
  };
}

/** Grouped vertical bars: one group per category, one bar per runtime. Single y-axis, one unit. */
export function RuntimeBarChart({
  data,
  runtimes,
  format,
  categoryKey = "category",
}: {
  data: Record<string, unknown>[];
  runtimes: RuntimeName[];
  format: (v: number) => string;
  categoryKey?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }} barGap={2} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey={categoryKey} tickLine={false} axisLine={AXIS} interval={0} />
        <YAxis tickLine={false} axisLine={false} width={72} tickFormatter={(v: number) => format(v)} />
        <Tooltip content={makeTooltip(format)} cursor={{ fill: "var(--surface-2)" }} />
        {runtimes.map((r) => (
          <Bar key={r} dataKey={r} name={RUNTIME_LABELS[r]} fill={SERIES_COLOR[r]} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Lines over an ordered x (time or iteration). 2px strokes, >= 8px markers. */
export function RuntimeLineChart({
  data,
  runtimes,
  format,
  xKey,
  xFormat,
  xLabel,
}: {
  data: Record<string, unknown>[];
  runtimes: RuntimeName[];
  format: (v: number) => string;
  xKey: string;
  xFormat?: (v: unknown) => string;
  xLabel?: (v: unknown) => ReactNode;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey={xKey} tickLine={false} axisLine={AXIS} tickFormatter={xFormat} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} width={72} tickFormatter={(v: number) => format(v)} />
        <Tooltip content={makeTooltip(format, xLabel)} cursor={{ stroke: "var(--axis)", strokeWidth: 1 }} />
        {runtimes.map((r) => (
          <Line
            key={r}
            type="linear"
            dataKey={r}
            name={RUNTIME_LABELS[r]}
            stroke={SERIES_COLOR[r]}
            strokeWidth={2}
            dot={data.length <= 24 ? { r: 4, strokeWidth: 2, stroke: "var(--surface)", fill: SERIES_COLOR[r] } : false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--surface)" }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Horizontal paired bars rendered in HTML: direct-labelled, used for small multiples. */
export function PairedBars({ rows }: { rows: { runtime: RuntimeName; value: number | null; label: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value ?? 0), 0);
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.runtime} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2 text-xs">
          <span className="text-muted">{RUNTIME_LABELS[r.runtime]}</span>
          <span className="h-2.5 overflow-hidden rounded-r bg-surface-2">
            {r.value != null && max > 0 ? (
              <span className={cn("block h-full rounded-r", r.runtime === "bun" ? "bg-bun" : "bg-node")} style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
            ) : null}
          </span>
          <span className="tabular text-right font-medium text-fg">{r.label}</span>
        </li>
      ))}
    </ul>
  );
}
