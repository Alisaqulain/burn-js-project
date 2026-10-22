import { runnerEventSchema, type RunnerEvent } from "@bunbench/shared";

/** Maximum length of one protocol line; protects the orchestrator from runaway output. */
export const MAX_LINE_LENGTH = 8 * 1024 * 1024;

export const EXIT_CODES = {
  ok: 0,
  workloadError: 1,
  invalidConfig: 2,
  wrongRuntime: 3,
  deadlineExceeded: 124,
} as const;

export function describeExitCode(code: number | null): string {
  switch (code) {
    case null:
      return "process was terminated";
    case EXIT_CODES.ok:
      return "success";
    case EXIT_CODES.workloadError:
      return "workload error";
    case EXIT_CODES.invalidConfig:
      return "runner rejected the configuration";
    case EXIT_CODES.wrongRuntime:
      return "runner started under the wrong runtime";
    case EXIT_CODES.deadlineExceeded:
      return "runner exceeded its deadline";
    default:
      return `exited with code ${code}`;
  }
}

export type ParsedLine = { ok: true; event: RunnerEvent } | { ok: false; error: string; line: string };

/** Parses one stdout line of the runner protocol. Non-JSON lines are reported, not thrown. */
export function parseRunnerLine(line: string): ParsedLine {
  const trimmed = line.trim();
  if (trimmed.length > MAX_LINE_LENGTH) return { ok: false, error: "Line exceeds maximum length", line: trimmed.slice(0, 200) };
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "Line is not valid JSON", line: trimmed.slice(0, 200) };
  }
  const result = runnerEventSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, error: `Invalid runner event: ${result.error.issues[0]?.message ?? "unknown"}`, line: trimmed.slice(0, 200) };
  }
  return { ok: true, event: result.data };
}

/** Splits a byte stream into lines, handling chunks that end mid-line. */
export class LineSplitter {
  private buffer = "";
  private readonly decoder = new TextDecoder();

  push(chunk: Uint8Array | string): string[] {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
    const parts = this.buffer.split(/\r?\n/);
    this.buffer = parts.pop() ?? "";
    if (this.buffer.length > MAX_LINE_LENGTH) {
      this.buffer = "";
      throw new Error("Runner emitted a line longer than the maximum allowed length");
    }
    return parts.filter((p) => p.trim().length > 0);
  }

  flush(): string[] {
    const rest = this.buffer + this.decoder.decode();
    this.buffer = "";
    return rest.trim().length > 0 ? [rest] : [];
  }
}

export function serializeEvent(event: RunnerEvent): string {
  return `${JSON.stringify(event)}\n`;
}
