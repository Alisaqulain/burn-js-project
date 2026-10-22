import { DEFAULT_SETTINGS, HARD_LIMITS, type Settings, settingsSchema, WORKLOAD_LIMITS } from "@bunbench/shared";
import { ExternalLink, Save } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Callout } from "@/components/status";
import { ErrorState, PageHeader, PageSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Field, Input, Kbd } from "@/components/ui/primitives";
import { api, describeError } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { useQuery } from "@/lib/use-api";

type Key = keyof Settings;
const FIELDS: { key: Key; label: string; hint: string; scale?: number }[] = [
  { key: "defaultIterations", label: "Default measured iterations", hint: "Pre-filled on the New benchmark page." },
  { key: "defaultWarmups", label: "Default warm-up iterations", hint: "Pre-filled on the New benchmark page." },
  { key: "defaultRounds", label: "Default rounds", hint: `1–${HARD_LIMITS.rounds.max}.` },
  { key: "defaultMaxDurationMs", label: "Default max duration (s)", hint: "Per runtime process.", scale: 1_000 },
  { key: "maxIterations", label: "Maximum iterations", hint: `Hard cap ${HARD_LIMITS.iterations.max}.` },
  { key: "maxWarmups", label: "Maximum warm-ups", hint: `Hard cap ${HARD_LIMITS.warmups.max}.` },
  { key: "maxDurationLimitMs", label: "Maximum duration (s)", hint: `Hard cap ${HARD_LIMITS.maxDurationMs.max / 1_000} s per process.`, scale: 1_000 },
  { key: "maxConcurrentRuns", label: "Concurrent runs", hint: "1 is strongly recommended: parallel benchmarks distort each other." },
  { key: "queueLimit", label: "Queue limit", hint: "Queued + running runs before new submissions are rejected." },
  { key: "httpMaxConcurrency", label: "Max HTTP concurrency", hint: `Hard cap ${WORKLOAD_LIMITS.http.concurrency.max}.` },
];

function SettingsForm({ initial, onSaved }: { initial: Settings; onSaved: () => void }) {
  const [values, setValues] = useState<Record<Key, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, String(initial[f.key] / (f.scale ?? 1))])) as Record<Key, string>,
  );
  const [saving, setSaving] = useState(false);
  const toSettings = (v: Record<Key, string>) =>
    Object.fromEntries(FIELDS.map((f) => [f.key, v[f.key].trim() === "" ? Number.NaN : Number(v[f.key]) * (f.scale ?? 1)])) as Settings;
  const parsed = settingsSchema.safeParse(toSettings(values));
  const errors: Partial<Record<Key, string>> = {};
  if (!parsed.success) for (const issue of parsed.error.issues) errors[issue.path[0] as Key] ??= issue.code === "invalid_type" ? "Enter a whole number" : issue.message;

  const save = async () => {
    if (!parsed.success) return;
    setSaving(true);
    try {
      await api.updateSettings(parsed.data);
      toast.success("Settings saved");
      onSaved();
    } catch (error) {
      const { title, hint } = describeError(error);
      toast.error(title, { description: hint });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Benchmark defaults and limits"
        description="Limits are enforced by the API in addition to the built-in hard caps."
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setValues(Object.fromEntries(FIELDS.map((f) => [f.key, String(DEFAULT_SETTINGS[f.key] / (f.scale ?? 1))])) as Record<Key, string>)}
            >
              Reset to defaults
            </Button>
            <Button size="sm" variant="primary" onClick={() => void save()} disabled={!parsed.success || saving}>
              <Save aria-hidden /> {saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      />
      <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label} htmlFor={`s-${f.key}`} hint={f.hint} error={errors[f.key]}>
            <Input
              id={`s-${f.key}`}
              type="number"
              inputMode="numeric"
              value={values[f.key]}
              aria-invalid={Boolean(errors[f.key])}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          </Field>
        ))}
      </CardBody>
    </Card>
  );
}

export function SettingsPage() {
  const settings = useQuery(() => api.settings(), "settings");
  const health = useQuery(() => api.health(), "health");

  return (
    <>
      <PageHeader title="Settings" description="Defaults, resource limits, storage and runtime configuration." />
      {settings.error ? (
        <ErrorState error={settings.error} onRetry={() => void settings.reload()} />
      ) : !settings.data ? (
        <PageSkeleton rows={2} />
      ) : (
        <div className="space-y-6">
          <SettingsForm key={JSON.stringify(settings.data.settings)} initial={settings.data.settings} onSaved={() => void settings.reload()} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader title="Database" />
              <CardBody>
                <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
                  <dt className="text-subtle">Status</dt>
                  <dd className="text-fg">{health.data ? (health.data.database.ok ? "Connected" : "Error") : "…"}</dd>
                  <dt className="text-subtle">File</dt>
                  <dd className="font-mono text-xs break-all text-fg">{settings.data.database.path}</dd>
                  <dt className="text-subtle">Schema</dt>
                  <dd className="text-fg">v{settings.data.database.schemaVersion}</dd>
                  <dt className="text-subtle">Size</dt>
                  <dd className="text-fg">{formatBytes(settings.data.database.sizeBytes)}</dd>
                  <dt className="text-subtle">Runs stored</dt>
                  <dd className="text-fg">{settings.data.database.runCount}</dd>
                </dl>
                <p className="mt-3 text-xs text-subtle">
                  Back up with <Kbd>bun run db:backup</Kbd>; reset with <Kbd>bun run db:reset</Kbd> (API stopped).
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Runtime configuration" />
              <CardBody>
                <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
                  <dt className="text-subtle">Bun path override</dt>
                  <dd className="text-fg">{settings.data.runtimeConfig.bunPathOverride ? "Set (BUNBENCH_BUN_PATH)" : "Not set"}</dd>
                  <dt className="text-subtle">Node path override</dt>
                  <dd className="text-fg">{settings.data.runtimeConfig.nodePathOverride ? "Set (BUNBENCH_NODE_PATH)" : "Not set"}</dd>
                  <dt className="text-subtle">Show paths</dt>
                  <dd className="text-fg">{settings.data.runtimeConfig.exposePaths ? "Yes (home redacted)" : "No"}</dd>
                </dl>
                <p className="mt-3 text-xs text-subtle">
                  Executables are configured only through environment variables. <Link to="/runtimes" className="underline">View runtimes</Link>
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Server" />
              <CardBody>
                <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
                  <dt className="text-subtle">Bind address</dt>
                  <dd className="font-mono text-xs text-fg">
                    {settings.data.server.host}:{settings.data.server.port}
                  </dd>
                  <dt className="text-subtle">CORS origins</dt>
                  <dd className="font-mono text-xs break-all text-fg">{settings.data.server.corsOrigins.join(", ") || "—"}</dd>
                  <dt className="text-subtle">Rate limit</dt>
                  <dd className="text-fg">{settings.data.server.rateLimitPerMinute} submissions/min</dd>
                  <dt className="text-subtle">Queue</dt>
                  <dd className="text-fg">{health.data ? `${health.data.queue.running} running, ${health.data.queue.queued} queued` : "…"}</dd>
                </dl>
              </CardBody>
            </Card>
          </div>

          <Callout tone="warning" title="Measurement limitations">
            Results depend on hardware, operating system, power settings, thermal state, background activity and runtime versions. A single run on one machine is
            not a general statement about either runtime. See <Link to="/methodology" className="underline">Methodology</Link>.
          </Callout>

          <Card>
            <CardHeader title="Official documentation" />
            <CardBody className="flex flex-wrap gap-4 text-sm">
              {[
                ["Bun documentation", "https://bun.sh/docs"],
                ["Bun runtime APIs", "https://bun.sh/docs/runtime/bun-apis"],
                ["Node.js API reference", "https://nodejs.org/docs/latest/api/"],
                ["Node.js TypeScript support", "https://nodejs.org/api/typescript.html"],
              ].map(([label, href]) => (
                <a key={href} href={href} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-fg underline-offset-4 hover:underline">
                  {label} <ExternalLink aria-hidden className="size-3.5" />
                </a>
              ))}
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
