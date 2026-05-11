import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workflowCreateMock = vi.fn();
const workflowFindManyMock = vi.fn();
const workflowFindFirstMock = vi.fn();
const workflowVersionCreateMock = vi.fn();
const apiKeyCreateMock = vi.fn();
const apiKeyFindManyMock = vi.fn();
const gitHubIntegrationFindManyMock = vi.fn();
const gitHubIntegrationFindFirstMock = vi.fn();
const alertChannelCountMock = vi.fn();
const prismaTransactionMock = vi.fn();
const resolveTenantAccessMock = vi.fn();
const startTrialIfEligibleMock = vi.fn();
const ingestOperationalEventsMock = vi.fn();
const handleGenericWorkflowEventDetectionMock = vi.fn();
const dispatchPendingAlertEventsMock = vi.fn();
const enqueueExecutionEventMock = vi.fn();
const enqueueHeartbeatEventMock = vi.fn();

vi.mock("../src/config.js", () => ({
  config: {
    SYNTEQ_API_KEY_SALT: "test-salt-value-with-minimum-length-123456789"
  }
}));

vi.mock("../src/services/entitlement-guard-service.js", () => ({
  resolveTenantAccess: resolveTenantAccessMock,
  requireFeature: () => undefined,
  requireSourceCapacity: (input: { access: { maxSources: number | null }; currentActiveSources: number }) => {
    if (input.access.maxSources !== null && input.currentActiveSources >= input.access.maxSources) {
      const error = new Error("Source limit reached");
      (error as Error & { code?: string; feature?: string }).code = "UPGRADE_REQUIRED";
      (error as Error & { code?: string; feature?: string }).feature = "source_capacity";
      throw error;
    }
  },
  replyIfEntitlementError: (reply: { code: (status: number) => { send: (payload: unknown) => unknown } }, requestId: string, error: unknown) => {
    const typed = error as { code?: string; feature?: string; message?: string };
    if (typed?.code !== "UPGRADE_REQUIRED") {
      return false;
    }
    reply.code(403).send({
      error: "Upgrade required",
      code: "UPGRADE_REQUIRED",
      feature: typed.feature ?? "source_capacity",
      message: typed.message ?? "Upgrade required",
      request_id: requestId
    });
    return true;
  }
}));

vi.mock("../src/services/tenant-trial-service.js", () => ({
  startTrialIfEligible: startTrialIfEligibleMock
}));

vi.mock("../src/services/operational-event-ingestion-service.js", () => ({
  ingestOperationalEvents: ingestOperationalEventsMock
}));

vi.mock("../src/services/generic-workflow-incident-service.js", () => ({
  handleGenericWorkflowEventDetection: handleGenericWorkflowEventDetectionMock
}));

vi.mock("../src/services/alert-service.js", () => ({
  claimPendingAlertEvent: vi.fn(),
  dispatchPendingAlertEvents: dispatchPendingAlertEventsMock
}));

vi.mock("../src/services/ingest-queue-service.js", () => ({
  enqueueExecutionEvent: enqueueExecutionEventMock,
  enqueueHeartbeatEvent: enqueueHeartbeatEventMock
}));

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    workflow: {
      create: workflowCreateMock,
      findMany: workflowFindManyMock,
      findFirst: workflowFindFirstMock
    },
    workflowVersion: {
      create: workflowVersionCreateMock
    },
    apiKey: {
      create: apiKeyCreateMock,
      findMany: apiKeyFindManyMock
    },
    gitHubIntegration: {
      findMany: gitHubIntegrationFindManyMock,
      findFirst: gitHubIntegrationFindFirstMock
    },
    alertChannel: {
      count: alertChannelCountMock
    },
    $transaction: prismaTransactionMock
  }
}));

describe("control plane generic workflow sources", () => {
  let app: ReturnType<typeof Fastify>;
  let authMode: "ok" | "missing_tenant" | "unauthorized";
  let permissionAllowed: boolean;

  beforeEach(async () => {
    workflowCreateMock.mockReset();
    workflowFindManyMock.mockReset();
    workflowFindFirstMock.mockReset();
    workflowVersionCreateMock.mockReset();
    apiKeyCreateMock.mockReset();
    apiKeyFindManyMock.mockReset();
    gitHubIntegrationFindManyMock.mockReset();
    gitHubIntegrationFindFirstMock.mockReset();
    alertChannelCountMock.mockReset();
    prismaTransactionMock.mockReset();
    resolveTenantAccessMock.mockReset();
    startTrialIfEligibleMock.mockReset();
    ingestOperationalEventsMock.mockReset();
    handleGenericWorkflowEventDetectionMock.mockReset();
    dispatchPendingAlertEventsMock.mockReset();
    enqueueExecutionEventMock.mockReset();
    enqueueHeartbeatEventMock.mockReset();

    authMode = "ok";
    permissionAllowed = true;

    resolveTenantAccessMock.mockResolvedValue({
      tenantId: "tenant-A",
      currentPlan: "pro",
      effectivePlan: "pro",
      entitlements: {},
      maxSources: null,
      maxHistoryHours: null,
      features: {
        alerts: true,
        team_members: true,
        premium_intelligence: true,
        trend_analysis: true
      }
    });
    workflowFindManyMock.mockResolvedValue([]);
    gitHubIntegrationFindManyMock.mockResolvedValue([]);
    apiKeyFindManyMock.mockResolvedValue([]);
    alertChannelCountMock.mockResolvedValue(0);
    workflowCreateMock.mockResolvedValue({
      id: "wf-source-1",
      display_name: "Customer Onboarding",
      slug: "n8n-customer-onboarding",
      source_type: "n8n",
      environment: "production",
      created_at: new Date("2026-04-28T10:00:00.000Z")
    });
    workflowVersionCreateMock.mockResolvedValue({
      id: "version-1"
    });
    apiKeyCreateMock.mockResolvedValue({
      id: "api-key-1",
      name: "Customer Onboarding workflow source",
      key_hash: "abcdef0123456789",
      created_at: new Date("2026-04-28T10:00:00.000Z"),
      last_used_at: null,
      revoked_at: null
    });
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: {
        workflow: { create: typeof workflowCreateMock };
        workflowVersion: { create: typeof workflowVersionCreateMock };
        apiKey: { create: typeof apiKeyCreateMock };
      }) => Promise<unknown>) =>
        callback({
          workflow: {
            create: workflowCreateMock
          },
          workflowVersion: {
            create: workflowVersionCreateMock
          },
          apiKey: {
            create: apiKeyCreateMock
          }
        })
    );
    startTrialIfEligibleMock.mockResolvedValue({
      code: "started"
    });
    workflowFindFirstMock.mockResolvedValue({
      id: "wf-source-1",
      tenant_id: "tenant-A",
      display_name: "Customer Onboarding",
      slug: "n8n-customer-onboarding",
      source_type: "n8n",
      environment: "production",
      is_active: true,
      versions: [
        {
          config_json: {
            source: "generic_workflow_source",
            source_type: "n8n",
            source_key: "n8n-customer-onboarding"
          }
        }
      ]
    });
    gitHubIntegrationFindFirstMock.mockResolvedValue(null);
    ingestOperationalEventsMock.mockResolvedValue({
      accepted: 1,
      ingested: 1,
      duplicates: 0,
      skipped: 0,
      failed: 0,
      persisted: 1,
      analysis_handoff: {
        mode: "operational_events_table",
        queued: 1,
        next_stage: "pending_worker"
      }
    });
    handleGenericWorkflowEventDetectionMock.mockResolvedValue({
      action: "skipped"
    });

    app = Fastify();
    app.decorate("requireDashboardAuth", async (request: any, reply: any) => {
      if (authMode === "unauthorized") {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      request.authUser = {
        user_id: "owner-1",
        email: "owner@synteq.local",
        full_name: "Owner",
        tenant_id: authMode === "missing_tenant" ? undefined : "tenant-A",
        role: "owner",
        email_verified_at: null
      };
    });
    app.decorate("requireRoles", () => async () => undefined);
    app.decorate("requireIngestionKey", async () => undefined);
    app.decorate("requireIngestionSignature", async () => undefined);
    app.decorate("requirePermissions", () => {
      return async (_request: any, reply: any) => {
        if (!permissionAllowed) {
          return reply.code(403).send({ error: "Forbidden", code: "FORBIDDEN_PERMISSION" });
        }
      };
    });
    app.setErrorHandler((error: Error, _request: unknown, reply: any) => {
      if (error.name === "ValidationError") {
        return reply.code(400).send({ error: "Bad Request", message: error.message });
      }
      return reply.code(500).send({ error: "Internal Server Error", message: error.message });
    });

    const routes = (await import("../src/routes/control-plane.js")).default;
    await app.register(routes, { prefix: "/v1" });
    await app.ready();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });

  it("creates a generic workflow source with a one-time ingestion key", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/control-plane/workflow-sources",
      headers: {
        host: "api.synteq.local"
      },
      payload: {
        display_name: "Customer Onboarding",
        source_type: "n8n",
        environment: "production"
      }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      workflow_source: {
        id: "wf-source-1",
        display_name: "Customer Onboarding",
        source_type: "n8n",
        source_key: "n8n-customer-onboarding",
        ingest_endpoint_path: "/v1/ingest/workflow-event",
        ingest_endpoint_url: "http://api.synteq.local/v1/ingest/workflow-event"
      },
      source_id: "wf-source-1",
      source_key: "n8n-customer-onboarding"
    });
    expect(body.ingestion_key.startsWith("synteq_")).toBe(true);
    expect(workflowCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenant_id: "tenant-A",
          display_name: "Customer Onboarding",
          slug: "n8n-customer-onboarding",
          source_type: "n8n",
          environment: "production"
        })
      })
    );
    expect(apiKeyCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenant_id: "tenant-A",
          name: "Customer Onboarding workflow source",
          key_hash: expect.any(String)
        })
      })
    );
    expect(startTrialIfEligibleMock).toHaveBeenCalledWith({
      tenantId: "tenant-A",
      source: "auto_workflow_connect"
    });
  });

  it("requires dashboard auth for manual silent checks", async () => {
    authMode = "unauthorized";

    const response = await app.inject({
      method: "POST",
      url: "/v1/control-plane/sources/wf-source-1/silent-check"
    });

    expect(response.statusCode).toBe(401);
    expect(workflowFindFirstMock).not.toHaveBeenCalled();
    expect(ingestOperationalEventsMock).not.toHaveBeenCalled();
  });

  it("requires workflow write permission for manual silent checks", async () => {
    permissionAllowed = false;

    const response = await app.inject({
      method: "POST",
      url: "/v1/control-plane/sources/wf-source-1/silent-check"
    });

    expect(response.statusCode).toBe(403);
    expect(workflowFindFirstMock).not.toHaveBeenCalled();
    expect(ingestOperationalEventsMock).not.toHaveBeenCalled();
  });

  it("runs a read-only manual silent check for a generic workflow source", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-11T08:15:00.000Z"));

    const response = await app.inject({
      method: "POST",
      url: "/v1/control-plane/sources/wf-source-1/silent-check"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sourceId: "wf-source-1",
      status: "ok",
      mode: "silent",
      writesPerformed: false,
      checkedAt: "2026-05-11T08:15:00.000Z",
      checks: expect.arrayContaining([
        expect.objectContaining({
          key: "source_access",
          status: "ok"
        }),
        expect.objectContaining({
          key: "source_compatibility",
          status: "ok"
        })
      ])
    });
    expect(workflowFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "wf-source-1",
          tenant_id: "tenant-A"
        }
      })
    );
    expect(workflowCreateMock).not.toHaveBeenCalled();
    expect(workflowVersionCreateMock).not.toHaveBeenCalled();
    expect(apiKeyCreateMock).not.toHaveBeenCalled();
    expect(prismaTransactionMock).not.toHaveBeenCalled();
    expect(ingestOperationalEventsMock).not.toHaveBeenCalled();
    expect(handleGenericWorkflowEventDetectionMock).not.toHaveBeenCalled();
    expect(dispatchPendingAlertEventsMock).not.toHaveBeenCalled();
    expect(enqueueExecutionEventMock).not.toHaveBeenCalled();
    expect(enqueueHeartbeatEventMock).not.toHaveBeenCalled();
  });

  it.each(["webhook", "make", "zapier"] as const)("supports %s workflow sources for manual silent checks", async (sourceType) => {
    workflowFindFirstMock.mockResolvedValueOnce({
      id: `wf-${sourceType}`,
      tenant_id: "tenant-A",
      display_name: `${sourceType} Source`,
      slug: `${sourceType}-source`,
      source_type: sourceType,
      environment: "production",
      is_active: true,
      versions: [
        {
          config_json: {
            source: "generic_workflow_source",
            source_type: sourceType,
            source_key: `${sourceType}-source`
          }
        }
      ]
    });

    const response = await app.inject({
      method: "POST",
      url: `/v1/control-plane/sources/wf-${sourceType}/silent-check`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sourceId: `wf-${sourceType}`,
      status: "ok",
      mode: "silent",
      writesPerformed: false
    });
    expect(ingestOperationalEventsMock).not.toHaveBeenCalled();
    expect(handleGenericWorkflowEventDetectionMock).not.toHaveBeenCalled();
  });

  it("returns a failed silent readiness state for inactive generic sources without mutating state", async () => {
    workflowFindFirstMock.mockResolvedValueOnce({
      id: "wf-source-1",
      tenant_id: "tenant-A",
      display_name: "Customer Onboarding",
      slug: "n8n-customer-onboarding",
      source_type: "n8n",
      environment: "production",
      is_active: false,
      versions: [
        {
          config_json: {
            source: "generic_workflow_source",
            source_type: "n8n",
            source_key: "n8n-customer-onboarding"
          }
        }
      ]
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/control-plane/sources/wf-source-1/silent-check"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sourceId: "wf-source-1",
      status: "failed",
      mode: "silent",
      writesPerformed: false,
      checks: expect.arrayContaining([
        expect.objectContaining({
          key: "source_activation",
          status: "failed"
        })
      ])
    });
    expect(ingestOperationalEventsMock).not.toHaveBeenCalled();
    expect(handleGenericWorkflowEventDetectionMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported workflow source types for manual silent checks", async () => {
    workflowFindFirstMock.mockResolvedValueOnce({
      id: "wf-github",
      tenant_id: "tenant-A",
      display_name: "GitHub Mirror",
      slug: "github-mirror",
      source_type: "github",
      environment: "production",
      is_active: true,
      versions: []
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/control-plane/sources/wf-github/silent-check"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "Silent checks are only supported for generic workflow sources"
    });
    expect(ingestOperationalEventsMock).not.toHaveBeenCalled();
    expect(dispatchPendingAlertEventsMock).not.toHaveBeenCalled();
  });

  it("rejects GitHub source ids for manual silent checks", async () => {
    workflowFindFirstMock.mockResolvedValueOnce(null);
    gitHubIntegrationFindFirstMock.mockResolvedValueOnce({
      id: "github-1"
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/control-plane/sources/github-1/silent-check"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "GitHub sources cannot use generic workflow silent checks"
    });
    expect(ingestOperationalEventsMock).not.toHaveBeenCalled();
  });

  it("enforces tenant scope for manual silent checks", async () => {
    workflowFindFirstMock.mockResolvedValueOnce(null);
    gitHubIntegrationFindFirstMock.mockResolvedValueOnce(null);

    const response = await app.inject({
      method: "POST",
      url: "/v1/control-plane/sources/wf-other-tenant/silent-check"
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: "Workflow source not found"
    });
    expect(workflowFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "wf-other-tenant",
          tenant_id: "tenant-A"
        }
      })
    );
    expect(ingestOperationalEventsMock).not.toHaveBeenCalled();
  });

  it("keeps manual silent check responses sanitized even when stored setup config has unsafe keys", async () => {
    workflowFindFirstMock.mockResolvedValueOnce({
      id: "wf-source-1",
      tenant_id: "tenant-A",
      display_name: "Customer Onboarding",
      slug: "n8n-customer-onboarding",
      source_type: "n8n",
      environment: "production",
      is_active: true,
      versions: [
        {
          config_json: {
            source: "generic_workflow_source",
            source_type: "n8n",
            source_key: "n8n-customer-onboarding",
            webhook_secret: "super-secret-should-not-render",
            nested: {
              access_token: "token-should-not-render",
              raw_payload: {
                customer: "hidden"
              }
            }
          }
        }
      ]
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/control-plane/sources/wf-source-1/silent-check"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sourceId: "wf-source-1",
      status: "warning",
      mode: "silent",
      writesPerformed: false,
      checks: expect.arrayContaining([
        expect.objectContaining({
          key: "configuration_integrity",
          status: "warning"
        })
      ])
    });
    expect(response.body).not.toContain("super-secret-should-not-render");
    expect(response.body).not.toContain("token-should-not-render");
    expect(response.body).not.toContain("raw_payload");
    expect(response.body).not.toContain("webhook_secret");
    expect(response.body).not.toContain("access_token");
    expect(ingestOperationalEventsMock).not.toHaveBeenCalled();
    expect(handleGenericWorkflowEventDetectionMock).not.toHaveBeenCalled();
  });

  it("sends a valid synthetic workflow test event through operational ingestion", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-28T10:01:20.000Z"));

    const response = await app.inject({
      method: "POST",
      url: "/v1/control-plane/sources/wf-source-1/test-workflow-event",
      payload: {
        status: "succeeded"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      message: "Synthetic succeeded workflow event sent for Customer Onboarding.",
      ingest: {
        accepted: 1,
        ingested: 1,
        normalized_status: "succeeded",
        source_type: "n8n"
      },
      event: {
        source_id: "wf-source-1",
        source_key: "n8n-customer-onboarding",
        workflow_id: "synteq-test-n8n-wfsource1",
        execution_id: "synteq-test-succeeded-202604281001",
        status: "succeeded",
        metadata: {
          synthetic: true,
          test: true,
          platform: "n8n"
        }
      }
    });
    expect(ingestOperationalEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        events: [
          expect.objectContaining({
            source: "n8n",
            event_type: "workflow_execution_succeeded",
            metadata: expect.objectContaining({
              event_kind: "workflow_execution",
              source_id: "wf-source-1",
              source_key: "n8n-customer-onboarding",
              metadata: expect.objectContaining({
                synthetic: true,
                test: true,
                generated_by: "synteq_workflow_source_test"
              })
            })
          })
        ]
      }),
      expect.objectContaining({
        tenantId: "tenant-A",
        apiKeyId: undefined,
        idempotencyHints: [
          expect.objectContaining({
            namespace: "workflow_execution_event",
            upstreamKey: "n8n|n8n-customer-onboarding|synteq-test-n8n-wfsource1|synteq-test-succeeded-202604281001|succeeded|2026-04-28T10:01:00.000Z"
          })
        ]
      })
    );
  });

  it("rejects unsupported source types such as GitHub", async () => {
    workflowFindFirstMock.mockResolvedValueOnce({
      id: "wf-github",
      display_name: "GitHub Mirror",
      slug: "github-mirror",
      source_type: "github",
      environment: "production"
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/control-plane/sources/wf-github/test-workflow-event",
      payload: {
        status: "failed"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "Workflow test events are only supported for generic workflow sources"
    });
    expect(ingestOperationalEventsMock).not.toHaveBeenCalled();
  });

  it("rejects a source outside the current tenant scope", async () => {
    workflowFindFirstMock.mockResolvedValueOnce(null);
    gitHubIntegrationFindFirstMock.mockResolvedValueOnce(null);

    const response = await app.inject({
      method: "POST",
      url: "/v1/control-plane/sources/wf-other-tenant/test-workflow-event",
      payload: {
        status: "timed_out"
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: "Workflow source not found"
    });
    expect(workflowFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "wf-other-tenant",
          tenant_id: "tenant-A"
        })
      })
    );
    expect(ingestOperationalEventsMock).not.toHaveBeenCalled();
  });

  it("handles duplicate synthetic events through stable idempotency hints", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-04-28T10:02:30.000Z"));

    let firstKey: string | null = null;
    ingestOperationalEventsMock.mockImplementationOnce(async (_body: unknown, context: { idempotencyHints?: Array<{ upstreamKey?: string }> }) => {
      firstKey = context.idempotencyHints?.[0]?.upstreamKey ?? null;
      return {
        accepted: 1,
        ingested: 1,
        duplicates: 0,
        skipped: 0,
        failed: 0,
        persisted: 1,
        analysis_handoff: {
          mode: "operational_events_table",
          queued: 1,
          next_stage: "pending_worker"
        }
      };
    });
    ingestOperationalEventsMock.mockImplementationOnce(async (_body: unknown, context: { idempotencyHints?: Array<{ upstreamKey?: string }> }) => {
      expect(context.idempotencyHints?.[0]?.upstreamKey).toBe(firstKey);
      return {
        accepted: 1,
        ingested: 0,
        duplicates: 1,
        skipped: 0,
        failed: 0,
        persisted: 0,
        analysis_handoff: {
          mode: "operational_events_table",
          queued: 0,
          next_stage: "pending_worker"
        }
      };
    });

    const first = await app.inject({
      method: "POST",
      url: "/v1/control-plane/sources/wf-source-1/test-workflow-event",
      payload: {
        status: "failed"
      }
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/control-plane/sources/wf-source-1/test-workflow-event",
      payload: {
        status: "failed"
      }
    });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      ingest: {
        ingested: 1,
        duplicates: 0
      }
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      ingest: {
        ingested: 0,
        duplicates: 1
      }
    });
  });
});
