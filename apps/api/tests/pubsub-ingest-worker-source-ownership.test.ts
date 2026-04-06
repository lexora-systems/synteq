import { beforeEach, describe, expect, it, vi } from "vitest";

const redisSetNxMock = vi.fn();
const redisDeleteMock = vi.fn();
const buildExecutionRecordMock = vi.fn();
const buildHeartbeatRecordMock = vi.fn();
const writeExecutionRecordToBigQueryMock = vi.fn();
const writeHeartbeatRecordToBigQueryMock = vi.fn();
const assertWorkflowSourceOwnershipMock = vi.fn();

vi.mock("../src/config.js", () => ({
  config: {
    INGEST_DEDUPE_TTL_SEC: 900
  }
}));

vi.mock("../src/lib/redis.js", () => ({
  redisKey: (...parts: Array<string | number>) => parts.join(":"),
  redisSetNx: redisSetNxMock,
  redisDelete: redisDeleteMock
}));

vi.mock("../src/services/ingestion-service.js", () => ({
  buildExecutionRecord: buildExecutionRecordMock,
  buildHeartbeatRecord: buildHeartbeatRecordMock,
  writeExecutionRecordToBigQuery: writeExecutionRecordToBigQueryMock,
  writeHeartbeatRecordToBigQuery: writeHeartbeatRecordToBigQueryMock
}));

vi.mock("../src/lib/runtime-metrics.js", () => ({
  runtimeMetrics: {
    increment: vi.fn()
  }
}));

vi.mock("../src/services/ingest-source-ownership-service.js", () => ({
  assertWorkflowSourceOwnership: assertWorkflowSourceOwnershipMock,
  isIngestSourceOwnershipError: (error: unknown) =>
    Boolean(error && typeof error === "object" && (error as { name?: string }).name === "IngestSourceOwnershipError")
}));

describe("pubsub ingest worker source ownership", () => {
  beforeEach(() => {
    redisSetNxMock.mockReset();
    redisDeleteMock.mockReset();
    buildExecutionRecordMock.mockReset();
    buildHeartbeatRecordMock.mockReset();
    writeExecutionRecordToBigQueryMock.mockReset();
    writeHeartbeatRecordToBigQueryMock.mockReset();
    assertWorkflowSourceOwnershipMock.mockReset();

    redisSetNxMock.mockResolvedValue(true);
    assertWorkflowSourceOwnershipMock.mockResolvedValue(undefined);
    buildExecutionRecordMock.mockReturnValue({});
    buildHeartbeatRecordMock.mockReturnValue({});
    writeExecutionRecordToBigQueryMock.mockResolvedValue(undefined);
    writeHeartbeatRecordToBigQueryMock.mockResolvedValue(undefined);
  });

  it("skips execution messages for unregistered workflow source", async () => {
    const ownershipError = Object.assign(new Error("Workflow source is not registered for this tenant"), {
      name: "IngestSourceOwnershipError",
      code: "INGEST_SOURCE_UNREGISTERED"
    });
    assertWorkflowSourceOwnershipMock.mockRejectedValueOnce(ownershipError);
    const { processQueueMessage } = await import("../src/services/pubsub-ingest-worker-service.js");

    const result = await processQueueMessage({
      type: "execution",
      fingerprint: "f".repeat(64),
      request_id: "req-1",
      ingest_ts: "2026-04-06T12:00:00.000Z",
      payload: {
        event_ts: "2026-04-06T12:00:00.000Z",
        tenant_id: "tenant-A",
        workflow_id: "wf-missing",
        execution_id: "exec-1",
        status: "success",
        retry_count: 0
      } as any
    });

    expect(result).toMatchObject({
      skipped: true,
      reason: "unregistered workflow source"
    });
    expect(writeExecutionRecordToBigQueryMock).not.toHaveBeenCalled();
  });

  it("writes heartbeat messages for recognized workflow source", async () => {
    const { processQueueMessage } = await import("../src/services/pubsub-ingest-worker-service.js");

    const result = await processQueueMessage({
      type: "heartbeat",
      fingerprint: "f".repeat(64),
      request_id: "req-2",
      ingest_ts: "2026-04-06T12:00:00.000Z",
      payload: {
        heartbeat_ts: "2026-04-06T12:00:00.000Z",
        tenant_id: "tenant-A",
        workflow_id: "wf-1",
        expected_interval_sec: 60
      } as any
    });

    expect(result).toMatchObject({
      skipped: false
    });
    expect(assertWorkflowSourceOwnershipMock).toHaveBeenCalledWith({
      tenantId: "tenant-A",
      workflowId: "wf-1"
    });
    expect(writeHeartbeatRecordToBigQueryMock).toHaveBeenCalledTimes(1);
  });
});
