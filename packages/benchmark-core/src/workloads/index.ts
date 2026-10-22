import type { ComputeRunnerConfig } from "@bunbench/shared";
import { prepareArray } from "./array.ts";
import { prepareCpu } from "./cpu.ts";
import { prepareJson } from "./json.ts";
import { prepareMemory } from "./memory.ts";
import type { PreparedWorkload } from "./types.ts";

export type { PreparedWorkload } from "./types.ts";
export { sievePrimes, prepareCpu } from "./cpu.ts";
export { generateJsonRecords, prepareJson } from "./json.ts";
export { generateIntegers, processArray, prepareArray } from "./array.ts";
export { allocateAndProcess, prepareMemory } from "./memory.ts";
export { buildHttpPayload, expectedHttpBody, httpPayloadChecksum, HTTP_PATHS } from "./http-payload.ts";

/** Builds the prepared workload for a compute runner config. Input generation happens here. */
export function prepareWorkload(config: ComputeRunnerConfig): PreparedWorkload {
  switch (config.type) {
    case "cpu":
      return prepareCpu(config.params);
    case "json":
      return prepareJson(config.params, config.seed);
    case "array":
      return prepareArray(config.params, config.seed);
    case "memory":
      return prepareMemory(config.params, config.seed);
  }
}
