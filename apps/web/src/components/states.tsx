import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { describeError } from "@/lib/api";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/primitives";

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-strong px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-subtle [&_svg]:size-8">{icon}</div> : null}
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-subtle">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { title, hint } = describeError(error);
  return (
    <div role="alert" className="rounded-lg border border-critical/40 bg-critical/5 px-4 py-4">
      <p className="text-sm font-semibold text-fg">{title}</p>
      <p className="mt-1 text-sm text-muted">{hint}</p>
      {onRetry ? (
        <Button className="mt-3" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden /> Retry
        </Button>
      ) : null}
    </div>
  );
}

export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-48" />
      ))}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {description ? <p className="mt-1 text-sm text-subtle">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
