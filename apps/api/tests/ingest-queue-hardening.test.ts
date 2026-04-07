import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  configMock,
  buildExecutionRecordMock,
  writeExecutionRecordToBigQueryMock,
  getTopicMock,
  runtimeIncrementMock
} = vi.hoisted(() => ({
  configMock: {
    ENFORCE_PUBSUB_ONLY: false,
    PUBSUB_PROJECT_ID: undefined as string | undefined,
    PUBSUB_TOPIC_INGEST: undefined as string | undefined
  },
  buildExecutionRecordMock: vi.fn(),
  writeExecutionRecordToBigQueryMock: vi.fn(),
  getTopicMock: vi.fn(),
  runtimeIncrementMock: vi.fn()
}));

vi.mock("../src/config.js", () => ({
  config: configMock
}));

vi.mock("../src/lib/pubsub.js", () => ({
  getTopic: getTopicMock
}));

vi.mock("../src/lib/runtime-metrics.js", () => ({
  runtimeMetrics: {
    increment: runtimeIncrementMock
  }
}));

vi.mock("../src/services/ingestion-service.js", () => ({
  buildExecutionRecord: buildExecutionRecordMock,
  buildHeartbeatRecord: vi.fn(),
  writeExecutionRecordToBigQuery: writeExecutionRecordToBigQueryMock,
  writeHeartbeatRecordToBigQuery: vi.fn()
}));

import { enqueueExecutionEvent } from "../src/services/ingest-queue-service.js";

describe("ingest queue hardening flags", () => {
  beforeEach(() => {
    configMock.ENFORCE_PUBSUB_ONLY = false;
    configMock.PUBSUB_PROJECT_ID = undefined;
    configMock.PUBSUB_TOPIC_INGEST = undefined;

    buildExecutionRecordMock.mockReset();
    writeExecutionRecordToBigQueryMock.mockReset();
    getTopicMock.mockReset();
    runtimeIncrementMock.mockReset();

    buildExecutionRecordMock.mockReturnValue({
      fingerprint: "fingerprint-1",
      ingest_ts: new Date("2026-03-27T00:00:00.000Z")
    });
  });

  it("keeps direct BigQuery fallback when ENFORCE_PUBSUB_ONLY=false", async () => {
    const result = await enqueueExecutionEvent(
      {
        tenant_id: "tenant-1",
        workflow_id: "workflow-1"
      } as any,
      "req-1"
    );

    expect(result).toEqual({
      queued: false,
      fingerprint: "fingerprint-1"
    });
    expect(writeExecutionRecordToBigQueryMock).toHaveBeenCalledTimes(1);
    expect(getTopicMock).not.toHaveBeenCalled();
  });

  it("fails fast when ENFORCE_PUBSUB_ONLY=true and Pub/Sub config is missing", async () => {
    configMock.ENFORCE_PUBSUB_ONLY = true;

    await expect(
      enqueueExecutionEvent(
        {
          tenant_id: "tenant-1",
          workflow_id: "workflow-1"
        } as any,
        "req-2"
      )
    ).rejects.toThrow(/ENFORCE_PUBSUB_ONLY=true requires PUBSUB_PROJECT_ID and PUBSUB_TOPIC_INGEST/);

    expect(buildExecutionRecordMock).not.toHaveBeenCalled();
    expect(writeExecutionRecordToBigQueryMock).not.toHaveBeenCalled();
  });

  it("publishes to Pub/Sub when ENFORCE_PUBSUB_ONLY=true and config is present", async () => {
    configMock.ENFORCE_PUBSUB_ONLY = true;
    configMock.PUBSUB_PROJECT_ID = "prod-project";
    configMock.PUBSUB_TOPIC_INGEST = "synteq-ingest";
    const publishMessageMock = vi.fn().mockResolvedValue(undefined);
    getTopicMock.mockReturnValue({
      publishMessage: publishMessageMock
    });

    const result = await enqueueExecutionEvent(
      {
        tenant_id: "tenant-1",
        workflow_id: "workflow-1"
      } as any,
      "req-3"
    );

    expect(result).toEqual({
      queued: true,
      fingerprint: "fingerprint-1"
    });
    expect(getTopicMock).toHaveBeenCalledWith("synteq-ingest");
    expect(publishMessageMock).toHaveBeenCalledTimes(1);
    expect(writeExecutionRecordToBigQueryMock).not.toHaveBeenCalled();
  });
});
