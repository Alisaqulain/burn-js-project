import { describe, expect, test } from "bun:test";
import { createPrng } from "../src/prng.ts";
import {
  buildHttpPayload,
  expectedHttpBody,
  generateIntegers,
  generateJsonRecords,
  prepareArray,
  prepareCpu,
  prepareJson,
  prepareMemory,
  prepareWorkload,
  processArray,
  sievePrimes,
} from "../src/workloads/index.ts";

describe("prng", () => {
  test("is deterministic for a seed and differs across seeds", () => {
    const a = createPrng(42);
    const b = createPrng(42);
    const c = createPrng(43);
    const seqA = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(seqA);
    expect(Array.from({ length: 5 }, c)).not.toEqual(seqA);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("matches a pinned reference sequence (engine independence)", () => {
    const next = createPrng(1);
    const first = Array.from({ length: 3 }, () => Math.floor(next() * 1e9));
    // Pinned from both Bun 1.4 and Node 24; must never change or historical inputs differ.
    expect(first).toEqual([627073940, 2735721, 527447039]);
  });
});

describe("cpu workload", () => {
  test("sieve counts primes correctly", () => {
    expect(sievePrimes(10).count).toBe(4);
    expect(sievePrimes(100).count).toBe(25);
    expect(sievePrimes(100_000).count).toBe(9_592);
  });

  test("checksum is stable across runs", () => {
    const w = prepareCpu({ limit: 50_000 });
    expect(w.run()).toBe(w.run());
    expect(w.run()).toMatch(/^5133-[0-9a-f]{8}$/);
    expect(w.opsPerRun).toBe(50_000);
  });
});

describe("json workload", () => {
  test("generates identical datasets for the same seed", () => {
    expect(generateJsonRecords(50, 7)).toEqual(generateJsonRecords(50, 7));
    expect(generateJsonRecords(50, 7)).not.toEqual(generateJsonRecords(50, 8));
  });

  test("round trip preserves data and checksum is deterministic", () => {
    const records = generateJsonRecords(20, 1);
    expect(JSON.parse(JSON.stringify(records))).toEqual(records);
    const a = prepareJson({ records: 500 }, 3);
    const b = prepareJson({ records: 500 }, 3);
    expect(a.inputChecksum).toBe(b.inputChecksum);
    expect(a.run()).toBe(b.run());
    expect(prepareJson({ records: 500 }, 4).inputChecksum).not.toBe(a.inputChecksum);
  });
});

describe("array workload", () => {
  test("same seed yields same input and verified sorted output", () => {
    expect(generateIntegers(100, 5)).toEqual(generateIntegers(100, 5));
    const w = prepareArray({ size: 10_000 }, 5);
    expect(w.run()).toBe(w.run());
    expect(prepareArray({ size: 10_000 }, 5).inputChecksum).toBe(w.inputChecksum);
  });

  test("processArray output is independent of input order (sort verification)", () => {
    const data = generateIntegers(2_000, 9);
    const reversed = data.slice().reverse();
    expect(processArray(reversed)).toBe(processArray(data));
  });
});

describe("memory workload", () => {
  test("is deterministic", () => {
    const w = prepareMemory({ objects: 5_000 }, 2);
    expect(w.run()).toBe(w.run());
    expect(prepareMemory({ objects: 5_000 }, 2).run()).toBe(w.run());
  });
});

describe("http payload", () => {
  test("payload and body are deterministic", () => {
    expect(buildHttpPayload(10, 1)).toEqual(buildHttpPayload(10, 1));
    expect(expectedHttpBody(10, 1)).toBe(JSON.stringify(buildHttpPayload(10, 1)));
    expect(buildHttpPayload(3, 1).items).toHaveLength(3);
  });
});

describe("prepareWorkload dispatch", () => {
  test("dispatches each compute type", () => {
    const base = { protocolVersion: 1 as const, iterations: 1, warmups: 0, seed: 1, deadlineMs: 1_000 };
    expect(prepareWorkload({ ...base, type: "cpu", params: { limit: 1_000 } }).opsUnit).toBe("numbers sieved");
    expect(prepareWorkload({ ...base, type: "json", params: { records: 10 } }).opsUnit).toBe("records");
    expect(prepareWorkload({ ...base, type: "array", params: { size: 100 } }).opsUnit).toBe("elements");
    expect(prepareWorkload({ ...base, type: "memory", params: { objects: 1_000 } }).opsUnit).toBe("objects");
  });
});
