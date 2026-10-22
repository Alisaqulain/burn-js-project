/**
 * A workload prepared with its inputs. `prepare` work (input generation) is never timed;
 * only `run()` is inside the measured region. `run()` returns an output checksum that must be
 * identical across iterations and across runtimes for the same inputs.
 */
export interface PreparedWorkload {
  opsUnit: string;
  /** Workload units processed by one `run()` call (used for ops/s). */
  opsPerRun: number;
  inputChecksum: string;
  run(): string;
}
