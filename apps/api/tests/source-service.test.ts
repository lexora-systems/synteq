import { beforeEach, describe, expect, it, vi } from "vitest";

const workflowFindManyMock = vi.fn();
const gitHubIntegrationFindManyMock = vi.fn();
const apiKeyFindManyMock = vi.fn();

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    workflow: {
      findMany: workflowFindManyMock
    },
    gitHubIntegration: {
      findMany: gitHubIntegrationFindManyMock
    },
    apiKey: {
      findMany: apiKeyFindManyMock
    }
  }
}));

describe("source service", () => {
  beforeEach(() => {
    workflowFindManyMock.mockReset();
    gitHubIntegrationFindManyMock.mockReset();
    apiKeyFindManyMock.mockReset();
  });

  it("normalizes canonical sources and summarizes by source kind", async () => {
    const now = new Date("2026-04-01T00:00:00.000Z");
    workflowFindManyMock.mockResolvedValue([
      {
        id: "wf-1",
        tenant_id: "tenant-A",
        display_name: "Payments Daily",
        slug: "payments-daily",
        system: "airflow",
        environment: "prod",
        is_active: true,
        created_at: now
      }
    ]);
    gitHubIntegrationFindManyMock.mockResolvedValue([
      {
        id: "gh-1",
        tenant_id: "tenant-A",
        repository_full_name: "acme/payments",
        webhook_id: "hook-1",
        is_active: true,
        last_seen_at: now,
        created_at: now
      },
      {
        id: "gh-2",
        tenant_id: "tenant-A",
        repository_full_name: null,
        webhook_id: "hook-2",
        is_active: false,
        last_seen_at: null,
        created_at: now
      }
    ]);
    apiKeyFindManyMock.mockResolvedValue([
      {
        id: "key-1",
        tenant_id: "tenant-A",
        name: "Primary ingest key",
        created_at: now,
        last_used_at: now,
        revoked_at: null
      }
    ]);

    const { listCanonicalSourcesForTenant, summarizeCanonicalSources } = await import("../src/services/source-service.js");
    const sources = await listCanonicalSourcesForTenant({
      tenantId: "tenant-A",
      includeInactiveWorkflows: true,
      includeCustomIngestion: true
    });
    const summary = summarizeCanonicalSources(sources);

    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "wf-1",
          kind: "workflow",
          status: "active",
          countsTowardCapacity: true
        }),
        expect.objectContaining({
          id: "gh-1",
          kind: "github_integration",
          status: "active",
          countsTowardCapacity: true
        }),
        expect.objectContaining({
          id: "gh-2",
          kind: "github_integration",
          status: "inactive",
          countsTowardCapacity: true
        }),
        expect.objectContaining({
          id: "key-1",
          kind: "custom_ingestion",
          status: "active",
          countsTowardCapacity: false
        })
      ])
    );
    expect(summary).toEqual({
      workflow_sources: 1,
      github_sources: 1,
      ingestion_keys_active: 1
    });
  });

  it("counts entitlement-relevant capacity sources through canonical source rules", async () => {
    const now = new Date("2026-04-01T00:00:00.000Z");
    workflowFindManyMock.mockResolvedValue([
      {
        id: "wf-1",
        tenant_id: "tenant-A",
        display_name: "Payments Daily",
        slug: "payments-daily",
        system: "airflow",
        environment: "prod",
        is_active: true,
        created_at: now
      }
    ]);
    gitHubIntegrationFindManyMock.mockResolvedValue([
      {
        id: "gh-1",
        tenant_id: "tenant-A",
        repository_full_name: "acme/payments",
        webhook_id: "hook-1",
        is_active: true,
        last_seen_at: now,
        created_at: now
      },
      {
        id: "gh-2",
        tenant_id: "tenant-A",
        repository_full_name: null,
        webhook_id: "hook-2",
        is_active: false,
        last_seen_at: null,
        created_at: now
      }
    ]);

    const { countCapacitySourcesForTenant } = await import("../src/services/source-service.js");
    const count = await countCapacitySourcesForTenant({
      tenantId: "tenant-A"
    });

    expect(count).toBe(2);
    expect(apiKeyFindManyMock).not.toHaveBeenCalled();
  });
});
