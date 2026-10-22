/**
 * Dedicated Bun HTTP server for the HTTP benchmark, built on Bun.serve.
 * Serializes the shared payload with JSON.stringify on every request (same logic as the Node server).
 */
import { buildHttpPayload, HTTP_PATHS } from "@bunbench/benchmark-core/workloads";
import { EXIT_CODES, serializeEvent } from "@bunbench/benchmark-core/protocol";
import { RunnerError } from "@bunbench/benchmark-core/runner-loop";
import { describeEnvironment } from "../common/environment.ts";
import { parseServerConfig, SERVER_HOST } from "../common/server-config.ts";

async function main(): Promise<number> {
  if (typeof Bun === "undefined" || !process.versions.bun) {
    console.error("bun http-server: this script must be executed by Bun");
    return EXIT_CODES.wrongRuntime;
  }
  let config;
  try {
    config = parseServerConfig(await Bun.stdin.text());
  } catch (error) {
    console.error(`bun http-server: ${(error as Error).message}`);
    return error instanceof RunnerError ? error.exitCode : EXIT_CODES.invalidConfig;
  }

  const payload = buildHttpPayload(config.payloadItems, config.seed);
  const jsonHeaders = { "content-type": "application/json" };

  const server = Bun.serve({
    hostname: SERVER_HOST,
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === HTTP_PATHS.payload) {
        return new Response(JSON.stringify(payload), { headers: jsonHeaders });
      }
      if (pathname === HTTP_PATHS.health) return new Response("ok");
      if (pathname === HTTP_PATHS.stats) {
        const m = process.memoryUsage();
        return new Response(JSON.stringify({ rss: m.rss, heapUsed: m.heapUsed }), { headers: jsonHeaders });
      }
      if (pathname === HTTP_PATHS.shutdown && req.method === "POST") {
        setTimeout(() => {
          void server.stop(true).then(() => process.exit(0));
        }, 10);
        return new Response("bye");
      }
      return new Response("not found", { status: 404 });
    },
  });

  process.stdout.write(
    serializeEvent({
      type: "ready",
      port: server.port ?? 0,
      env: describeEnvironment("bun", Bun.version, "n/a (server)"),
    }),
  );
  return -1;
}

const code = await main();
if (code >= 0) process.exitCode = code;
