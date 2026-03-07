import { describe, expect, it } from "vitest";
import { classifyIncidentType } from "../src/services/incident-classifier.js";

describe("incident classifier", () => {
  it("classifies duplicate webhook incidents", () => {
    expect(
      classifyIncidentType({
        policyMetric: "duplicate_rate",
        details: {}
      })
    ).toBe("duplicate_webhook");
  });

  it("classifies retry storm incidents", () => {
    expect(
      classifyIncidentType({
        policyMetric: "retry_rate",
        details: {}
      })
    ).toBe("retry_storm");
  });

  it("classifies latency incidents", () => {
    expect(
      classifyIncidentType({
        policyMetric: "latency_p95",
        details: {}
      })
    ).toBe("latency_spike");
  });

  it("classifies failure-rate incidents", () => {
    expect(
      classifyIncidentType({
        policyMetric: "failure_rate",
        details: {}
      })
    ).toBe("failure_rate_spike");
  });

  it("classifies missing-heartbeat incidents", () => {
    expect(
      classifyIncidentType({
        policyMetric: "missing_heartbeat",
        details: {}
      })
    ).toBe("missing_heartbeat");
  });

  it("classifies cost spike incidents", () => {
    expect(
      classifyIncidentType({
        policyMetric: "cost_spike",
        details: {}
      })
    ).toBe("cost_spike");
  });

  it("falls back to unknown when no strong signal exists", () => {
    expect(
      classifyIncidentType({
        policyMetric: "unmapped_metric",
        details: {},
        summary: "unexpected incident"
      })
    ).toBe("unknown");
  });
});
