import { beforeEach, describe, expect, it, vi } from "vitest";
import { estimateMonthlyRiskUsd } from "../src/services/risk-estimator.js";

vi.mock("../src/config.js", () => ({
  config: {
    FX_RATE_USD: 1,
    FX_RATE_PHP: 56,
    FX_RATE_EUR: 0.92,
    FX_RATE_GBP: 0.79,
    FX_RATE_JPY: 150,
    FX_RATE_AUD: 1.53,
    FX_RATE_CAD: 1.36
  }
}));

describe("risk estimator", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns stable deterministic estimates for known input", () => {
    const result = estimateMonthlyRiskUsd({
      monthlyEventVolume: 12_000,
      successRate: 0.93,
      duplicateRate: 0.015,
      retryRate: 0.08,
      avgOrderValueUsd: 95
    });

    expect(result).toBe(33516);
  });

  it("uses fallback values when avg order value is not configured", () => {
    const result = estimateMonthlyRiskUsd({
      monthlyEventVolume: 1_000,
      successRate: 0.999,
      duplicateRate: 0,
      retryRate: 0
    });

    expect(result).toBeGreaterThan(0);
  });
});
