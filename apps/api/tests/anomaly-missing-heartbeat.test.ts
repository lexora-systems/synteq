import { describe, expect, it } from "vitest";
import { evaluateMissingHeartbeatWindow } from "../src/services/anomaly-service.js";

describe("missing heartbeat evaluation", () => {
  it("does not trigger when there is no heartbeat baseline yet", () => {
    const result = evaluateMissingHeartbeatWindow({
      observedGapSec: null,
      heartbeatCount: 0,
      policyWindowSec: 300,
      inferredExpectedIntervalSec: null
    });

    expect(result.triggered).toBe(false);
    expect(result.skipReason).toBe("no_baseline");
    expect(result.expectedSource).toBe("policy_window");
  });

  it("uses heartbeat payload expected interval when available", () => {
    const result = evaluateMissingHeartbeatWindow({
      observedGapSec: 500,
      heartbeatCount: 12,
      policyWindowSec: 300,
      inferredExpectedIntervalSec: 90
    });

    expect(result.expectedSource).toBe("heartbeat_payload");
    expect(result.expectedIntervalSec).toBe(90);
    expect(result.thresholdGapSec).toBe(270);
    expect(result.triggered).toBe(true);
  });

  it("falls back to policy window and minimum expected interval floor", () => {
    const result = evaluateMissingHeartbeatWindow({
      observedGapSec: 170,
      heartbeatCount: 6,
      policyWindowSec: 30,
      inferredExpectedIntervalSec: null
    });

    expect(result.expectedSource).toBe("policy_window");
    expect(result.expectedIntervalSec).toBe(60);
    expect(result.thresholdGapSec).toBe(180);
    expect(result.triggered).toBe(false);
  });
});

