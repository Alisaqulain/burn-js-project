/** Starts the API (watch mode) and the Vite dev server together; Ctrl+C stops both. */
import { join } from "node:path";
import { BUN, ROOT } from "./lib.ts";

const children = [
  Bun.spawn({ cmd: [BUN, "--watch", "apps/api/src/index.ts"], cwd: ROOT, stdout: "inherit", stderr: "inherit", stdin: "ignore" }),
  Bun.spawn({ cmd: [BUN, "x", "vite"], cwd: join(ROOT, "apps", "web"), stdout: "inherit", stderr: "inherit", stdin: "ignore" }),
];

console.log("[dev] API  → http://127.0.0.1:3001/api/health");
console.log("[dev] Web  → http://127.0.0.1:5173");

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const code = await Promise.race(children.map((c) => c.exited));
stop();
await Promise.all(children.map((c) => c.exited));
process.exit(code);
