import type { ReactNode } from "react";
import { PageHeader } from "@/components/states";
import { Card, CardBody, CardHeader, Kbd } from "@/components/ui/primitives";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody className="space-y-2 text-sm leading-relaxed text-muted [&_strong]:text-fg">{children}</CardBody>
    </Card>
  );
}

export function MethodologyPage() {
  return (
    <>
      <PageHeader title="Methodology" description="How BunBench measures, and what its numbers can and cannot tell you." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Separate processes, identical code">
          <p>
            Every measurement runs in a dedicated child process of the runtime being measured: <Kbd>bun runners/bun/runner.ts</Kbd> or{" "}
            <Kbd>node runners/node/runner.ts</Kbd>. The API never executes benchmark code itself.
          </p>
          <p>
            Both runners import the same workload source from <Kbd>packages/benchmark-core</Kbd>. Node.js runs it through built-in type stripping, so the JavaScript
            executed is byte-for-byte the same on both runtimes. Only the timer and stdin/stdout plumbing differ.
          </p>
        </Section>
        <Section title="Warm-up and measured iterations">
          <p>
            Each process generates its inputs from a seed (untimed), runs the configured warm-up iterations (executed but never recorded), then the measured
            iterations. Only the workload call is inside the timed region. Cold-start time is never mixed with warmed-up measurements.
          </p>
          <p>
            Timers are monotonic and high-resolution: <Kbd>Bun.nanoseconds()</Kbd> and <Kbd>process.hrtime.bigint()</Kbd>; the HTTP client uses <Kbd>performance.now()</Kbd>.
          </p>
        </Section>
        <Section title="Ordering and rounds">
          <p>
            The order of runtimes is randomized for round 1. Later rounds alternate it (A B, B A, A B …) so that neither runtime systematically benefits from
            running first or second (cache state, CPU frequency, thermal throttling). Each round starts fresh processes.
          </p>
        </Section>
        <Section title="Verification">
          <p>
            Each workload returns a checksum of its output. A runner fails if any iteration produces a different checksum (non-determinism), and a run fails if the
            two runtimes produce different outputs for the same inputs. HTTP responses are checked byte-for-byte against the expected body.
          </p>
        </Section>
        <Section title="Statistics">
          <p>
            BunBench stores every measured iteration and reports mean, median, minimum, maximum, sample standard deviation (n−1), coefficient of variation and the
            95% confidence interval of the mean (Student t). Percentiles use linear interpolation; P90 is shown only with ≥ 10 samples and P95 with ≥ 20.
          </p>
          <p>
            With fewer than 5 samples per runtime a warning is shown. A difference whose confidence intervals overlap may be noise. Only runs with identical
            configuration hashes are aggregated or trended together.
          </p>
        </Section>
        <Section title="HTTP benchmarks">
          <p>
            A dedicated server (<Kbd>Bun.serve</Kbd> or <Kbd>node:http</Kbd>) on the runtime under test binds to 127.0.0.1 on an OS-assigned port and serializes the
            same JSON payload on every request. Load comes from a separate Bun client process, identical for both servers, so client overhead is constant but
            included in latency and throughput.
          </p>
          <p>
            Throughput counts only responses with status 200 and the exact expected body. Errors, timeouts and wrong bodies are reported as failures and excluded.
            Client and server share the same machine and CPU, which caps the throughput you can observe.
          </p>
        </Section>
        <Section title="Memory">
          <p>
            <strong>Peak RSS (OS)</strong> is reported by the operating system for the whole runner (or server) process after it exits, collected identically for both
            runtimes. It includes the runtime's own baseline footprint.
          </p>
          <p>
            <strong>In-process RSS / heap</strong> come from <Kbd>process.memoryUsage()</Kbd> after each iteration. V8 and JavaScriptCore account heap differently,
            and garbage collection timing differs, so heap figures are not directly comparable across runtimes.
          </p>
        </Section>
        <Section title="Limitations">
          <ul className="list-disc space-y-1 pl-5">
            <li>Results vary with hardware, OS, power plan, thermal state, background load and runtime versions.</li>
            <li>Micro-benchmarks measure narrow workloads. They do not predict the performance of a full application.</li>
            <li>No CPU pinning or process isolation is applied. Close other applications for steadier numbers.</li>
            <li>Bun is not universally faster than Node.js, nor the other way round: results depend on the workload.</li>
            <li>Missing or failed runtimes are marked as such; BunBench never substitutes or estimates results.</li>
          </ul>
        </Section>
      </div>
    </>
  );
}
