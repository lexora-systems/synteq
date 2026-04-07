import { describe, expect, it } from "vitest";
import { isMetricSupportedAtDetectionLevel } from "../src/services/anomaly-service.js";

describe("anomaly entitlement depth", () => {
  it("keeps core detection metrics available on basic detection", () => {
    expect(isMetricSupportedAtDetectionLevel("failure_rate", "basic")).toBe(true);
    expect(isMetricSupportedAtDetectionLevel("retry_rate", "basic")).toBe(true);
    expect(isMetricSupportedAtDetectionLevel("duplicate_rate", "basic")).toBe(true);
    expect(isMetricSupportedAtDetectionLevel("latency_p95", "basic")).toBe(true);
    expect(isMetricSupportedAtDetectionLevel("missing_heartbeat", "basic")).toBe(true);
  });

  it("reserves deeper metrics for full detection", () => {
    expect(isMetricSupportedAtDetectionLevel("latency_drift_ewma", "basic")).toBe(false);
    expect(isMetricSupportedAtDetectionLevel("cost_spike", "basic")).toBe(false);
    expect(isMetricSupportedAtDetectionLevel("cost_spike", "full")).toBe(true);
  });
});
