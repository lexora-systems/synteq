import { describe, expect, it } from "vitest";
import {
  evaluatePipelineStageFreshness,
  getPipelineStageThresholdMinutes
} from "../src/services/pipeline-freshness-service.js";

describe("pipeline freshness service", () => {
  it("marks stage stale when no snapshot exists", () => {
    const result = evaluatePipelineStageFreshness({
      stage: "aggregate",
      maxDelayMinutes: 5,
      now: new Date("2026-03-19T11:00:00.000Z")
    });

    expect(result.status).toBe("stale");
    expect(result.message).toContain("no execution metadata");
  });

  it("marks stage stale when no successful completion is recorded", () => {
    const result = evaluatePipelineStageFreshness({
      stage: "anomaly",
      maxDelayMinutes: 7,
      now: new Date("2026-03-19T11:00:00.000Z"),
      snapshot: {
        worker_name: "job:anomaly",
        last_heartbeat_at: new Date("2026-03-19T10:59:00.000Z"),
        last_completed_at: null
      }
    });

    expect(result.status).toBe("stale");
    expect(result.message).toContain("no successful completion");
  });

  it("marks stage stale when completion exceeds threshold", () => {
    const result = evaluatePipelineStageFreshness({
      stage: "alerts",
      maxDelayMinutes: 7,
      now: new Date("2026-03-19T11:00:00.000Z"),
      snapshot: {
        worker_name: "job:alerts",
        last_heartbeat_at: new Date("2026-03-19T10:50:00.000Z"),
        last_completed_at: new Date("2026-03-19T10:50:00.000Z")
      }
    });

    expect(result.status).toBe("stale");
    expect(result.minutesSinceLastSuccess).toBeGreaterThan(7);
  });

  it("marks stage healthy when completion is inside threshold", () => {
    const result = evaluatePipelineStageFreshness({
      stage: "aggregate",
      maxDelayMinutes: 5,
      now: new Date("2026-03-19T11:00:00.000Z"),
      snapshot: {
        worker_name: "job:aggregate",
        last_heartbeat_at: new Date("2026-03-19T10:58:00.000Z"),
        last_completed_at: new Date("2026-03-19T10:58:00.000Z")
      }
    });

    expect(result.status).toBe("healthy");
    expect(result.minutesSinceLastSuccess).toBeLessThanOrEqual(5);
  });

  it("uses fallback threshold when env var is invalid", () => {
    const previous = process.env.SYNTEQ_PIPELINE_MAX_DELAY_AGGREGATE_MIN;
    process.env.SYNTEQ_PIPELINE_MAX_DELAY_AGGREGATE_MIN = "not-a-number";
    expect(getPipelineStageThresholdMinutes("aggregate")).toBe(5);
    process.env.SYNTEQ_PIPELINE_MAX_DELAY_AGGREGATE_MIN = previous;
  });
});
