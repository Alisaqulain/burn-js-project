import type { Subprocess } from "bun";
import { LineSplitter } from "../protocol.ts";

const STDERR_TAIL_BYTES = 16 * 1024;
const KILL_ESCALATION_MS = 2_000;

/** Environment variables passed through to child processes. Everything else is dropped so that
 * inherited settings such as NODE_OPTIONS or BUN_* debug flags cannot skew one runtime. */
const PASSTHROUGH_ENV = [
  "PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "ComSpec", "TEMP", "TMP", "TMPDIR",
  "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "LANG", "LC_ALL", "XDG_RUNTIME_DIR",
];

export function buildChildEnv(base: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PASSTHROUGH_ENV) {
    const value = base[key];
    if (value !== undefined) env[key] = value;
  }
  env.NO_COLOR = "1";
  return env;
}

export interface ProcessSpec {
  /** Executable followed by arguments. Never a shell string. */
  cmd: string[];
  cwd: string;
  env?: Record<string, string>;
  stdin?: string;
  /** Hard wall-clock limit; the process is killed when exceeded. */
  timeoutMs: number;
  signal?: AbortSignal;
  onLine?: (line: string) => void;
}

export interface ProcessOutcome {
  exitCode: number | null;
  signalCode: string | null;
  timedOut: boolean;
  cancelled: boolean;
  stderr: string;
  durationMs: number;
  /** Peak resident set size reported by the OS (bytes), when available. */
  maxRssBytes: number | null;
  /** Error thrown while reading output (e.g. oversized line). */
  streamError: string | null;
}

/** Long-lived child process with line-oriented stdout, used for HTTP servers. */
export class ChildProcess {
  readonly proc: Subprocess<"pipe", "pipe", "pipe">;
  readonly startedAt = performance.now();
  timedOut = false;
  cancelled = false;
  streamError: string | null = null;
  private stderrTail = "";
  private readonly lineListeners = new Set<(line: string) => void>();
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private readonly drained: Promise<void>;
  private readonly abortHandler: () => void;
  private readonly signal: AbortSignal | undefined;

  constructor(spec: ProcessSpec) {
    if (spec.cmd.length === 0) throw new Error("Empty command");
    this.signal = spec.signal;
    this.proc = Bun.spawn({
      cmd: spec.cmd,
      cwd: spec.cwd,
      env: spec.env ?? buildChildEnv(),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
    if (spec.onLine) this.lineListeners.add(spec.onLine);
    this.proc.stdin.write(spec.stdin ?? "");
    void this.proc.stdin.end();

    this.timers.push(
      setTimeout(() => {
        this.timedOut = true;
        this.kill();
      }, spec.timeoutMs),
    );
    this.abortHandler = () => {
      this.cancelled = true;
      this.kill();
    };
    if (spec.signal?.aborted) this.abortHandler();
    else spec.signal?.addEventListener("abort", this.abortHandler, { once: true });

    this.drained = Promise.all([this.readStdout(), this.readStderr()]).then(() => undefined);
  }

  onLine(listener: (line: string) => void): () => void {
    this.lineListeners.add(listener);
    return () => this.lineListeners.delete(listener);
  }

  private async readStdout() {
    const splitter = new LineSplitter();
    try {
      for await (const chunk of this.proc.stdout) {
        for (const line of splitter.push(chunk)) this.dispatch(line);
      }
      for (const line of splitter.flush()) this.dispatch(line);
    } catch (error) {
      this.streamError = error instanceof Error ? error.message : String(error);
      this.kill();
    }
  }

  private dispatch(line: string) {
    for (const listener of this.lineListeners) listener(line);
  }

  private async readStderr() {
    const decoder = new TextDecoder();
    try {
      for await (const chunk of this.proc.stderr) {
        this.stderrTail = (this.stderrTail + decoder.decode(chunk, { stream: true })).slice(-STDERR_TAIL_BYTES);
      }
    } catch {
      // stderr is diagnostic only
    }
  }

  get stderr(): string {
    return this.stderrTail.trim();
  }

  get exited(): boolean {
    return this.proc.exitCode !== null || this.proc.signalCode !== null;
  }

  kill(): void {
    if (this.exited) return;
    try {
      this.proc.kill();
    } catch {
      return;
    }
    this.timers.push(
      setTimeout(() => {
        if (!this.exited) {
          try {
            this.proc.kill("SIGKILL");
          } catch {
            // already gone
          }
        }
      }, KILL_ESCALATION_MS),
    );
  }

  /** Waits for exit, with an optional limit after which the process is killed. */
  async wait(limitMs?: number): Promise<ProcessOutcome> {
    let limitTimer: ReturnType<typeof setTimeout> | undefined;
    if (limitMs !== undefined) limitTimer = setTimeout(() => this.kill(), limitMs);
    await this.proc.exited;
    await this.drained;
    if (limitTimer) clearTimeout(limitTimer);
    for (const t of this.timers) clearTimeout(t);
    this.signal?.removeEventListener("abort", this.abortHandler);
    const maxRssBytes = this.readMaxRss();
    return {
      exitCode: this.proc.exitCode,
      signalCode: this.proc.signalCode === null ? null : String(this.proc.signalCode),
      timedOut: this.timedOut,
      cancelled: this.cancelled,
      stderr: this.stderr,
      durationMs: performance.now() - this.startedAt,
      maxRssBytes,
      streamError: this.streamError,
    };
  }

  /** Peak RSS in bytes from the OS (Bun's resourceUsage), or null when unavailable. */
  private readMaxRss(): number | null {
    try {
      const usage = this.proc.resourceUsage();
      return usage && Number(usage.maxRSS) > 0 ? Number(usage.maxRSS) : null;
    } catch {
      return null;
    }
  }

  /** Resolves with the first line accepted by `match`, or rejects on timeout/exit. */
  waitForLine<T>(match: (line: string) => T | undefined, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out after ${timeoutMs} ms waiting for the process to become ready`));
      }, timeoutMs);
      const off = this.onLine((line) => {
        const value = match(line);
        if (value !== undefined) {
          cleanup();
          resolve(value);
        }
      });
      void this.proc.exited.then((code) => {
        cleanup();
        reject(new Error(`Process exited (code ${code}) before becoming ready${this.stderr ? `: ${this.stderr.slice(-500)}` : ""}`));
      });
      const cleanup = () => {
        clearTimeout(timer);
        off();
      };
    });
  }
}

/** Runs a process to completion, streaming stdout lines to `onLine`. */
export async function runProcess(spec: ProcessSpec): Promise<ProcessOutcome> {
  return new ChildProcess(spec).wait();
}
