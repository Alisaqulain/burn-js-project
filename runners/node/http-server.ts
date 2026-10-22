/**
 * Dedicated Node.js HTTP server for the HTTP benchmark, built on node:http.
 * Serializes the shared payload with JSON.stringify on every request (same logic as the Bun server).
 */
import http from "node:http";
import { buildHttpPayload, HTTP_PATHS } from "@bunbench/benchmark-core/workloads";
import { EXIT_CODES, serializeEvent } from "@bunbench/benchmark-core/protocol";
import { RunnerError } from "@bunbench/benchmark-core/runner-loop";
import { describeEnvironment } from "../common/environment.ts";
import { parseServerConfig, SERVER_HOST } from "../common/server-config.ts";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<number> {
  if (process.versions.bun || !process.versions.node) {
    console.error("node http-server: this script must be executed by Node.js");
    return EXIT_CODES.wrongRuntime;
  }
  let config;
  try {
    config = parseServerConfig(await readStdin());
  } catch (error) {
    console.error(`node http-server: ${(error as Error).message}`);
    return error instanceof RunnerError ? error.exitCode : EXIT_CODES.invalidConfig;
  }

  const payload = buildHttpPayload(config.payloadItems, config.seed);

  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? "/").split("?")[0];
    if (pathname === HTTP_PATHS.payload) {
      const body = JSON.stringify(payload);
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    if (pathname === HTTP_PATHS.health) {
      res.writeHead(200, { "content-type": "text/plain;charset=utf-8" });
      res.end("ok");
      return;
    }
    if (pathname === HTTP_PATHS.stats) {
      const m = process.memoryUsage();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ rss: m.rss, heapUsed: m.heapUsed }));
      return;
    }
    if (pathname === HTTP_PATHS.shutdown && req.method === "POST") {
      res.writeHead(200, { connection: "close" });
      res.end("bye");
      setTimeout(() => {
        server.closeAllConnections();
        server.close(() => process.exit(0));
      }, 10);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, SERVER_HOST, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  process.stdout.write(
    serializeEvent({
      type: "ready",
      port,
      env: describeEnvironment("node", process.versions.node, "n/a (server)"),
    }),
  );
  return -1;
}

const code = await main();
if (code >= 0) process.exitCode = code;
