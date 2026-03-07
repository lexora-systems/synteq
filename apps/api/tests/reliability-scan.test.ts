import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const workflowFindFirstMock = vi.fn();
const tenantFindUniqueMock = vi.fn();

vi.mock("../src/config.js", () => ({
  config: {
    BIGQUERY_PROJECT_ID: "project-test",
    BIGQUERY_DATASET: "synteq",
    FX_RATE_USD: 1,
    FX_RATE_PHP: 56,
    FX_RATE_EUR: 0.92,
    FX_RATE_GBP: 0.79,
    FX_RATE_JPY: 150,
    FX_RATE_AUD: 1.53,
    FX_RATE_CAD: 1.36
  }
}));

vi.mock("../src/lib/bigquery.js", () => ({
  getBigQueryClient: () => ({
    query: queryMock
  })
}));

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    workflow: {
      findFirst: workflowFindFirstMock
    },
    tenant: {
      findUnique: tenantFindUniqueMock
    }
  }
}));

describe("reliability scan service", () => {
  beforeEach(() => {
    queryMock.mockReset();
    workflowFindFirstMock.mockReset();
    tenantFindUniqueMock.mockReset();
    tenantFindUniqueMock.mockResolvedValue({ default_currency: "USD" });
    vi.resetModules();
  });

  it("calculates reliability score deterministically", async () => {
    const { calculateReliabilityScore } = await import("../src/services/reliability-scan-service.js");
    expect(
      calculateReliabilityScore({
        successRate: 0.98,
        duplicateRate: 0.01,
        retryRate: 0.05,
        latencyHealthScore: 90
      })
    ).toBe(97);
  });

  it("returns not-enough-data result when telemetry volume is low", async () => {
    queryMock
      .mockResolvedValueOnce([
        [
          {
            count_total: 8,
            count_success: 7,
            duplicate_events_est: 0.1,
            retry_events_est: 1.4,
            p95_duration_ms: 640,
            avg_cost_usd: 0.02
          }
        ]
      ])
      .mockResolvedValueOnce([
        [
          {
            count_total: 5,
            count_success: 5,
            duplicate_events_est: 0,
            retry_events_est: 0.5,
            p95_duration_ms: 520,
            avg_cost_usd: 0.01
          }
        ]
      ])
      .mockResolvedValueOnce([
        [
          {
            baseline_p95_duration_ms: 0,
            baseline_avg_cost_usd: 0
          }
        ]
      ]);
    workflowFindFirstMock.mockResolvedValue({ display_name: "Payments Daily" });

    const { runReliabilityScan } = await import("../src/services/reliability-scan-service.js");
    const result = await runReliabilityScan({
      tenantId: "tenant-A",
      workflowId: "wf-1"
    });

    expect(result.enough_data).toBe(false);
    expect(result.workflow_name).toBe("Payments Daily");
    expect(result.currency).toBe("USD");
    expect(result.conversion_rate).toBe(1);
    expect(result.recommendation).toContain("Not enough live data");
  });

  it("derives anomaly flags from degraded reliability signals", async () => {
    const { deriveScanFlags } = await import("../src/services/reliability-scan-service.js");
    const flags = deriveScanFlags({
      successRate: 0.9,
      duplicateRate: 0.05,
      retryRate: 0.2,
      latencyHealthScore: 50,
      p95DurationMs: 5000,
      baselineP95DurationMs: 2000,
      avgCostUsd: 0.15,
      baselineAvgCostUsd: 0.07
    });

    expect(flags).toEqual(
      expect.arrayContaining(["failure_risk", "duplicate_risk", "retry_storm_risk", "latency_risk", "cost_risk"])
    );
  });
});
