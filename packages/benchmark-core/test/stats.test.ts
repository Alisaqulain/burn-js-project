import { describe, expect, test } from "bun:test";
import { compareValues, histogram, mean, median, percentile, sampleStdDev, summarize, tCritical95 } from "../src/stats.ts";

describe("basic statistics", () => {
  test("mean and median", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(Number.isNaN(mean([]))).toBe(true);
  });

  test("sample standard deviation uses n-1", () => {
    // Known value: sample sd of 2,4,4,4,5,5,7,9 is sqrt(32/7)
    expect(sampleStdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 10);
    expect(sampleStdDev([42])).toBe(0);
  });

  test("percentile uses linear interpolation (type 7)", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 0)).toBe(1);
    expect(percentile(sorted, 100)).toBe(10);
    expect(percentile(sorted, 50)).toBe(5.5);
    expect(percentile(sorted, 90)).toBeCloseTo(9.1, 10);
    expect(percentile([7], 95)).toBe(7);
  });

  test("t critical values", () => {
    expect(tCritical95(1)).toBe(12.706);
    expect(tCritical95(10)).toBe(2.228);
    expect(tCritical95(1000)).toBe(1.96);
    expect(Number.isNaN(tCritical95(0))).toBe(true);
  });
});

describe("summarize", () => {
  test("reports all fields and hides percentiles for small samples", () => {
    const s = summarize([10, 12, 11, 13, 9]);
    expect(s.count).toBe(5);
    expect(s.mean).toBe(11);
    expect(s.median).toBe(11);
    expect(s.min).toBe(9);
    expect(s.max).toBe(13);
    expect(s.stddev).toBeCloseTo(Math.sqrt(2.5), 10);
    expect(s.cvPct).toBeCloseTo((Math.sqrt(2.5) / 11) * 100, 10);
    expect(s.ci95).toBeCloseTo((2.776 * Math.sqrt(2.5)) / Math.sqrt(5), 10);
    expect(s.p90).toBeNull();
    expect(s.p95).toBeNull();
  });

  test("reports p90 with >= 10 samples and p95 with >= 20", () => {
    const ten = Array.from({ length: 10 }, (_, i) => i + 1);
    expect(summarize(ten).p90).toBeCloseTo(9.1, 10);
    expect(summarize(ten).p95).toBeNull();
    const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(summarize(twenty).p95).toBeCloseTo(19.05, 10);
  });

  test("single sample has no confidence interval", () => {
    expect(summarize([3]).ci95).toBeNull();
  });

  test("rejects empty and non-finite samples", () => {
    expect(() => summarize([])).toThrow();
    expect(() => summarize([1, Number.NaN])).toThrow();
    expect(() => summarize([1, Infinity])).toThrow();
  });
});

describe("histogram", () => {
  test("counts values into inclusive upper-bound buckets", () => {
    expect(histogram([0.1, 1, 1.5, 3, 100], [1, 2, 4, Infinity])).toEqual([2, 1, 1, 1]);
    expect(histogram([], [1, Infinity])).toEqual([0, 0]);
  });
});

describe("compareValues", () => {
  test("lower-is-better picks the smaller value", () => {
    const r = compareValues({ runtime: "bun", value: 10 }, { runtime: "node", value: 20 }, "lower");
    expect(r.leader).toBe("bun");
    expect(r.factor).toBe(2);
  });

  test("higher-is-better picks the larger value", () => {
    const r = compareValues({ runtime: "bun", value: 100 }, { runtime: "node", value: 400 }, "higher");
    expect(r.leader).toBe("node");
    expect(r.factor).toBe(4);
  });

  test("overlapping confidence intervals are not distinguishable", () => {
    const r = compareValues({ runtime: "bun", value: 10, ci95: 2 }, { runtime: "node", value: 11, ci95: 2 }, "lower");
    expect(r.distinguishable).toBe(false);
    const s = compareValues({ runtime: "bun", value: 10, ci95: 0.5 }, { runtime: "node", value: 20, ci95: 0.5 }, "lower");
    expect(s.distinguishable).toBe(true);
  });

  test("missing values and neutral metrics produce no leader", () => {
    expect(compareValues({ runtime: "bun", value: null }, { runtime: "node", value: 1 }, "lower").leader).toBeNull();
    expect(compareValues({ runtime: "bun", value: 1 }, { runtime: "node", value: 2 }, "neutral").factor).toBeNull();
    expect(compareValues({ runtime: "bun", value: 5 }, { runtime: "node", value: 5 }, "lower")).toEqual({ leader: null, factor: 1, distinguishable: false });
  });
});
