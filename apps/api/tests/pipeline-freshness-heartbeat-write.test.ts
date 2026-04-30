import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertMock = vi.fn();

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    workerLease: {
      upsert: upsertMock
    }
  }
}));

describe("pipeline freshness heartbeat writes", () => {
  beforeEach(() => {
    upsertMock.mockReset();
  });

  it("fails fast when attempt/success heartbeat metadata cannot be persisted", async () => {
    upsertMock.mockRejectedValueOnce(new Error("db unavailable"));
    const { markPipelineStageSuccess } = await import("../src/services/pipeline-freshness-service.js");
    await expect(markPipelineStageSuccess("aggregate")).rejects.toThrow("db unavailable");
  });

  it("keeps failure heartbeat best-effort to preserve original job errors", async () => {
    upsertMock.mockRejectedValueOnce(new Error("db unavailable"));
    const { markPipelineStageFailure } = await import("../src/services/pipeline-freshness-service.js");
    await expect(markPipelineStageFailure("aggregate")).resolves.toBeUndefined();
  });
});
