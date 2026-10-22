import { httpServerConfigSchema, type HttpServerConfig } from "@bunbench/shared";
import { EXIT_CODES } from "@bunbench/benchmark-core/protocol";
import { RunnerError } from "@bunbench/benchmark-core/runner-loop";

export function parseServerConfig(raw: string): HttpServerConfig {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new RunnerError("Server configuration on stdin is not valid JSON", EXIT_CODES.invalidConfig);
  }
  const parsed = httpServerConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new RunnerError(`Invalid server configuration: ${parsed.error.issues[0]?.message ?? "unknown"}`, EXIT_CODES.invalidConfig);
  }
  return parsed.data;
}

/** Only loopback is ever bound; the port is assigned by the OS and reported in the ready event. */
export const SERVER_HOST = "127.0.0.1";
