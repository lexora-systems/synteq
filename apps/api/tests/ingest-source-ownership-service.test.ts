import { beforeEach, describe, expect, it, vi } from "vitest";

const workflowFindFirstMock = vi.fn();
const gitHubIntegrationCountMock = vi.fn();

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    workflow: {
      findFirst: workflowFindFirstMock
    },
    gitHubIntegration: {
      count: gitHubIntegrationCountMock
    }
  }
}));

describe("ingest source ownership service", () => {
  beforeEach(() => {
    workflowFindFirstMock.mockReset();
    gitHubIntegrationCountMock.mockReset();
  });

  it("accepts execution/heartbeat ingestion for active workflow sources owned by tenant", async () => {
    workflowFindFirstMock.mockResolvedValue({
      id: "wf-1"
    });
    const { assertWorkflowSourceOwnership } = await import("../src/services/ingest-source-ownership-service.js");

    await expect(
      assertWorkflowSourceOwnership({
        tenantId: "tenant-A",
        workflowId: "wf-1"
      })
    ).resolves.toBeUndefined();
  });

  it("rejects execution/heartbeat ingestion for unregistered workflow sources", async () => {
    workflowFindFirstMock.mockResolvedValue(null);
    const { assertWorkflowSourceOwnership } = await import("../src/services/ingest-source-ownership-service.js");

    await expect(
      assertWorkflowSourceOwnership({
        tenantId: "tenant-A",
        workflowId: "wf-missing"
      })
    ).rejects.toMatchObject({
      code: "INGEST_SOURCE_UNREGISTERED"
    });
  });

  it("rejects github_actions operational events from api key owner without active github source", async () => {
    gitHubIntegrationCountMock.mockResolvedValue(0);
    const { assertOperationalSourceOwnership } = await import("../src/services/ingest-source-ownership-service.js");

    await expect(
      assertOperationalSourceOwnership({
        tenantId: "tenant-A",
        sourceValues: ["github_actions"],
        owner: {
          kind: "api_key",
          apiKeyId: "key-1"
        }
      })
    ).rejects.toMatchObject({
      code: "INGEST_SOURCE_UNREGISTERED"
    });
  });

  it("accepts github_actions operational events from github integration owner only", async () => {
    const { assertOperationalSourceOwnership } = await import("../src/services/ingest-source-ownership-service.js");

    await expect(
      assertOperationalSourceOwnership({
        tenantId: "tenant-A",
        sourceValues: ["github_actions"],
        owner: {
          kind: "github_integration",
          integrationId: "gh-1"
        }
      })
    ).resolves.toBeUndefined();

    await expect(
      assertOperationalSourceOwnership({
        tenantId: "tenant-A",
        sourceValues: ["webhook"],
        owner: {
          kind: "github_integration",
          integrationId: "gh-1"
        }
      })
    ).rejects.toMatchObject({
      code: "INGEST_SOURCE_OWNER_MISMATCH"
    });
  });
});
