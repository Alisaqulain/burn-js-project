import { describe, expect, test } from "bun:test";
import { benchmarkConfigSchema } from "@bunbench/shared";
import { configHash, describeParams, stableStringify } from "../src/lib/config-hash.ts";
import { escapeCsvCell, toCsv } from "../src/lib/csv.ts";
import { RateLimiter } from "../src/lib/rate-limit.ts";
import { formatSseComment, formatSseEvent } from "../src/lib/sse.ts";
import { validCpuBody } from "./helpers.ts";

describe("CSV", () => {
  test("escapes quotes, commas and newlines per RFC 4180", () => {
    expect(escapeCsvCell("plain")).toBe("plain");
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(1.5)).toBe("1.5");
    expect(escapeCsvCell(Number.NaN)).toBe("");
  });

  test("neutralises spreadsheet formula injection", () => {
    expect(escapeCsvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(escapeCsvCell("+1")).toBe("'+1");
    expect(escapeCsvCell("@cmd")).toBe("'@cmd");
    expect(escapeCsvCell(-5)).toBe("-5");
  });

  test("builds CRLF-terminated documents", () => {
    expect(toCsv(["a", "b"], [[1, "x,y"]])).toBe('a,b\r\n1,"x,y"\r\n');
  });
});

describe("SSE formatting", () => {
  test("formats id, event, retry and JSON data", () => {
    expect(formatSseEvent({ event: "progress", id: 3, data: { a: 1 } })).toBe('id: 3\nevent: progress\ndata: {"a":1}\n\n');
    expect(formatSseEvent({ data: "x", retry: 3000 })).toBe("retry: 3000\ndata: x\n\n");
  });

  test("splits multi-line data and strips newlines from fields", () => {
    expect(formatSseEvent({ event: "a\nb", data: "l1\nl2\r\nl3" })).toBe("event: ab\ndata: l1\ndata: l2\ndata: l3\n\n");
    expect(formatSseComment("hi\nthere")).toBe(": hi there\n\n");
  });
});

describe("rate limiter", () => {
  test("allows up to the limit per window then reports retry-after", () => {
    let now = 0;
    const limiter = new RateLimiter(2, 60_000, () => now);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
    const blocked = limiter.check("a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);
    expect(limiter.check("b").allowed).toBe(true);
    now = 60_001;
    expect(limiter.check("a").allowed).toBe(true);
  });
});

describe("config hash", () => {
  test("ignores label, runtimes and duration but not workload parameters", () => {
    const base = benchmarkConfigSchema.parse(validCpuBody);
    const relabeled = benchmarkConfigSchema.parse({ ...validCpuBody, label: "other", runtimes: ["bun"], maxDurationMs: 20_000 });
    const different = benchmarkConfigSchema.parse({ ...validCpuBody, params: { limit: 20_000 } });
    const reseeded = benchmarkConfigSchema.parse({ ...validCpuBody, seed: 7 });
    expect(configHash(base)).toBe(configHash(relabeled));
    expect(configHash(base)).not.toBe(configHash(different));
    expect(configHash(base)).not.toBe(configHash(reseeded));
    expect(configHash(base)).toMatch(/^[0-9a-f]{16}$/);
  });

  test("stableStringify sorts keys", () => {
    expect(stableStringify({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
  });

  test("describes parameters", () => {
    expect(describeParams(benchmarkConfigSchema.parse(validCpuBody))).toBe("limit=10,000; 5 iterations, 1 warm-ups");
  });
});
