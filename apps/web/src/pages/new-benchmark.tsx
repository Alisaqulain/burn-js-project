import {
  BENCHMARK_TYPE_INFO,
  BENCHMARK_TYPES,
  type BenchmarkType,
  HARD_LIMITS,
  RUNTIME_LABELS,
  type RuntimeInfo,
  RUNTIMES,
  type Settings,
} from "@bunbench/shared";
import { Loader2, Play } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Callout } from "@/components/status";
import { ErrorState, PageHeader, PageSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Field, Input } from "@/components/ui/primitives";
import { api, describeError } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useQuery } from "@/lib/use-api";
import { cn, newIdempotencyKey } from "@/lib/utils";
import { buildConfig, defaultParams, type FormState, initialForm, PARAM_FIELDS, validateForm } from "@/lib/benchmark-form";

export function NewBenchmarkPage() {
  const [search] = useSearchParams();
  const requested = search.get("type");
  const startType: BenchmarkType = BENCHMARK_TYPES.includes(requested as BenchmarkType) ? (requested as BenchmarkType) : "cpu";
  const data = useQuery(async () => {
    const [settings, runtimes] = await Promise.all([api.settings(), api.runtimes()]);
    return { settings: settings.settings, runtimes };
  }, "new-benchmark");

  return (
    <>
      <PageHeader title="New benchmark" description="Configure a workload. Each runtime runs in its own process with identical inputs." />
      {data.error ? (
        <ErrorState error={data.error} onRetry={() => void data.reload()} />
      ) : !data.data ? (
        <PageSkeleton rows={2} />
      ) : (
        <BenchmarkForm key={startType} startType={startType} settings={data.data.settings} runtimes={data.data.runtimes} />
      )}
    </>
  );
}

function BenchmarkForm({ startType, settings, runtimes }: { startType: BenchmarkType; settings: Settings; runtimes: RuntimeInfo[] }) {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(() => initialForm(startType, settings, runtimes));
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const errors = useMemo(() => validateForm(form, settings), [form, settings]);
  const shownErrors = touched ? errors : {};
  const anyAvailable = runtimes.some((r) => r.available);

  const update = (patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    setIdempotencyKey(newIdempotencyKey()); // a changed form is a new submission
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length > 0 || submitting) return;
    setSubmitting(true);
    try {
      const run = await api.createRun(buildConfig(form), idempotencyKey);
      toast.success("Benchmark queued", { description: `${BENCHMARK_TYPE_INFO[run.type].label} · ${run.runtimes.map((r) => RUNTIME_LABELS[r]).join(" + ")}` });
      navigate(`/runs/${run.id}`);
    } catch (error) {
      const { title, hint } = describeError(error);
      toast.error(title, { description: hint });
      setSubmitting(false);
    }
  };

  const numberField = (key: keyof FormState & string, label: string, min: number, max: number, hint: string, step = 1) => (
    <Field label={label} htmlFor={key} hint={hint} error={shownErrors[key]}>
      <Input
        id={key}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={form[key] as string}
        aria-invalid={Boolean(shownErrors[key])}
        aria-describedby={shownErrors[key] ? `${key}-error` : undefined}
        onChange={(e) => update({ [key]: e.target.value } as Partial<FormState>)}
      />
    </Field>
  );

  return (
    <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        <Card>
          <CardHeader title="Workload" description="All workloads are deterministic: the same seed produces identical inputs on both runtimes." />
          <CardBody>
            <fieldset>
              <legend className="sr-only">Benchmark type</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {BENCHMARK_TYPES.map((type) => (
                  <label
                    key={type}
                    className={cn(
                      "cursor-pointer rounded-md border p-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                      form.type === type ? "border-fg bg-surface-2" : "border-border hover:border-border-strong",
                    )}
                  >
                    <input
                      type="radio"
                      name="type"
                      value={type}
                      checked={form.type === type}
                      onChange={() => update({ type, params: defaultParams(type) })}
                      className="sr-only"
                    />
                    <span className="block text-sm font-medium text-fg">{BENCHMARK_TYPE_INFO[type].label}</span>
                    <span className="mt-1 block text-xs text-subtle">{BENCHMARK_TYPE_INFO[type].description}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {PARAM_FIELDS[form.type].map((f) => (
                <Field key={f.key} label={f.label} htmlFor={`param-${f.key}`} hint={`${f.hint} Range ${formatNumber(f.min, 0)}–${formatNumber(f.max, 0)}.`} error={shownErrors[`params.${f.key}`]}>
                  <Input
                    id={`param-${f.key}`}
                    type="number"
                    inputMode="numeric"
                    min={f.min}
                    max={f.max}
                    value={form.params[f.key] ?? ""}
                    aria-invalid={Boolean(shownErrors[`params.${f.key}`])}
                    onChange={(e) => update({ params: { ...form.params, [f.key]: e.target.value } })}
                  />
                </Field>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Measurement" description="Warm-up iterations are executed but never measured. Rounds repeat everything in a new process, alternating runtime order." />
          <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {numberField("iterations", "Measured iterations", 1, settings.maxIterations, `1–${settings.maxIterations}. Use ≥ 10 for P90, ≥ 20 for P95.`)}
            {form.type === "http" ? (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted">Warm-up</p>
                <p className="text-xs text-subtle">HTTP warm-up uses the “Warm-up requests” workload setting, sent before the first measured iteration.</p>
              </div>
            ) : (
              numberField("warmups", "Warm-up iterations", 0, settings.maxWarmups, `0–${settings.maxWarmups}. Lets the JIT optimise before measuring.`)
            )}
            {numberField("rounds", "Rounds", HARD_LIMITS.rounds.min, HARD_LIMITS.rounds.max, "Fresh processes per runtime; order alternates (A B, B A).")}
            {numberField("maxDurationSec", "Max duration per process (s)", 1, settings.maxDurationLimitMs / 1_000, `Processes exceeding this are terminated. Limit ${settings.maxDurationLimitMs / 1_000} s.`)}
            {numberField("seed", "Seed", 0, HARD_LIMITS.seed.max, "Input generator seed. Same seed = same inputs.")}
            <Field label="Label (optional)" htmlFor="label" hint="Shown in history and exports." error={shownErrors.label}>
              <Input id="label" maxLength={HARD_LIMITS.labelMaxLength} value={form.label} placeholder="e.g. laptop on battery" onChange={(e) => update({ label: e.target.value })} />
            </Field>
          </CardBody>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Runtimes"
            actions={
              <Button asChild size="sm" variant="ghost">
                <Link to="/runtimes">Details</Link>
              </Button>
            }
          />
          <CardBody>
            <fieldset className="space-y-2" aria-describedby={shownErrors.runtimes ? "runtimes-error" : undefined}>
              <legend className="sr-only">Runtimes</legend>
              {RUNTIMES.map((name) => {
                const info = runtimes.find((r) => r.name === name);
                const available = Boolean(info?.available);
                return (
                  <label key={name} className={cn("flex items-start gap-3 rounded-md border border-border p-3", available ? "cursor-pointer hover:border-border-strong" : "opacity-60")}>
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-[var(--fg)]"
                      disabled={!available}
                      checked={form.runtimes.includes(name)}
                      onChange={(e) =>
                        update({ runtimes: e.target.checked ? RUNTIMES.filter((r) => r === name || form.runtimes.includes(r)) : form.runtimes.filter((r) => r !== name) })
                      }
                    />
                    <span>
                      <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
                        <span aria-hidden className={cn("size-2 rounded-full", name === "bun" ? "bg-bun" : "bg-node")} />
                        {RUNTIME_LABELS[name]}
                        {info?.version ? <span className="font-normal text-subtle">v{info.version}</span> : null}
                      </span>
                      {!available ? <span className="mt-0.5 block text-xs text-subtle">{info?.reason ?? "Unavailable"}</span> : null}
                    </span>
                  </label>
                );
              })}
            </fieldset>
            {shownErrors.runtimes ? (
              <p id="runtimes-error" role="alert" className="mt-2 text-xs text-critical-text">
                {shownErrors.runtimes}
              </p>
            ) : null}
          </CardBody>
        </Card>

        {!anyAvailable ? (
          <Callout tone="error" title="No runtime available">
            Install Bun or Node.js, then refresh the <Link to="/runtimes" className="underline">Runtimes</Link> page.
          </Callout>
        ) : form.runtimes.length === 1 ? (
          <Callout tone="info">Only one runtime is selected. The result will not be a comparison.</Callout>
        ) : null}
        {form.type === "http" ? (
          <Callout tone="info">
            Each server runs on the runtime under test. Load is generated by a separate Bun client process, the same for both servers, so client overhead is constant but included.
          </Callout>
        ) : null}
        {shownErrors.limits ? <Callout tone="error" title="Exceeds configured limits">{shownErrors.limits}</Callout> : null}
        {touched && Object.keys(errors).length > 0 && !shownErrors.limits ? (
          <Callout tone="error">Fix the highlighted fields before starting.</Callout>
        ) : null}

        <Button type="submit" variant="primary" className="w-full" disabled={submitting || !anyAvailable}>
          {submitting ? <Loader2 aria-hidden className="animate-spin" /> : <Play aria-hidden />}
          {submitting ? "Queuing…" : "Start benchmark"}
        </Button>
        <p className="text-xs text-subtle">
          Close other heavy applications while benchmarking. Results apply to this machine and these runtime versions only.
        </p>
      </div>
    </form>
  );
}
