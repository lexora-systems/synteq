import { describe, expect, it } from "vitest";
import {
  compareValue,
  ewma,
  poissonZScore,
  proportionZScore,
  smoothedBaseline,
  robustZScore
} from "../src/utils/anomaly-math.js";

describe("anomaly math", () => {
  it("computes proportion z-score", () => {
    const z = proportionZScore({
      total: 200,
      failures: 40,
      baselineRate: 0.08
    });

    expect(z).toBeGreaterThan(3);
  });

  it("computes robust z-score", () => {
    const z = robustZScore(450, [100, 105, 110, 115, 120, 130]);
    expect(z).toBeGreaterThan(3);
  });

  it("computes poisson z-score", () => {
    const z = poissonZScore(30, 5);
    expect(z).toBeGreaterThan(3);
  });

  it("applies comparator", () => {
    expect(compareValue(10, 5, "gte")).toBe(true);
    expect(compareValue(10, 10, "eq")).toBe(true);
    expect(compareValue(1, 5, "gt")).toBe(false);
  });

  it("computes ewma and smoothed baseline", () => {
    const value = ewma([10, 12, 20, 22], 0.3);
    expect(value).toBeGreaterThan(10);
    expect(value).toBeLessThan(22);

    const baseline = smoothedBaseline(100, 120, 0.25);
    expect(baseline).toBe(105);
  });
});
