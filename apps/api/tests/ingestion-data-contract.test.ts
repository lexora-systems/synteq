import { describe, expect, it } from "vitest";
import { buildExecutionRecord, buildHeartbeatRecord } from "../src/services/ingestion-service.js";

describe("ingestion data contract defaults", () => {
  it("does not persist raw execution payload strings by default", () => {
    const record = buildExecutionRecord({
      event_ts: new Date("2026-04-07T00:00:00.000Z"),
      tenant_id: "tenant-A",
      workflow_id: "wf-1",
      environment: "prod",
      execution_id: "exec-1",
      status: "success",
      retry_count: 0,
      payload: "raw log dump with stack traces and tokens"
    });

    expect(record.payload).toBeNull();
  });

  it("keeps only minimal signal snapshot fields from execution payload objects", () => {
    const record = buildExecutionRecord({
      event_ts: new Date("2026-04-07T00:00:00.000Z"),
      tenant_id: "tenant-A",
      workflow_id: "wf-1",
      environment: "prod",
      execution_id: "exec-2",
      status: "failed",
      retry_count: 1,
      payload: {
        simulation: true,
        scenario: "retry-storm",
        auth_token: "secret-value",
        logs: "very long logs that should not persist"
      }
    });

    expect(record.payload).not.toBeNull();
    expect(JSON.parse(record.payload ?? "{}")).toEqual({
      simulation: true,
      scenario: "retry-storm"
    });
  });

  it("keeps heartbeat interval and synthetic flags without persisting nested raw payload", () => {
    const record = buildHeartbeatRecord({
      heartbeat_ts: new Date("2026-04-07T00:00:00.000Z"),
      tenant_id: "tenant-A",
      workflow_id: "wf-1",
      environment: "prod",
      expected_interval_sec: 60,
      payload: {
        synthetic: true,
        password: "never-store",
        logs: "never-store"
      }
    });

    expect(record.payload).not.toBeNull();
    expect(JSON.parse(record.payload ?? "{}")).toEqual({
      expected_interval_sec: 60,
      synthetic: true
    });
  });
});
