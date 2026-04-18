import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.fn();
const createMock = vi.fn();
const findFirstMock = vi.fn();
const updateMock = vi.fn();
const countMock = vi.fn();
const alertChannelCountMock = vi.fn();
const workflowCountMock = vi.fn();
const workflowFindManyMock = vi.fn();
const apiKeyFindManyMock = vi.fn();
const resolveTenantAccessMock = vi.fn();

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

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    gitHubIntegration: {
      findMany: findManyMock,
      create: createMock,
      findFirst: findFirstMock,
      update: updateMock,
      count: countMock
    },
    alertChannel: {
      count: alertChannelCountMock
    },
    workflow: {
      findMany: workflowFindManyMock,
      count: workflowCountMock
    },
    apiKey: {
      findMany: apiKeyFindManyMock
    }
  }
}));

describe("control plane github integrations routes", () => {
  let app: ReturnType<typeof Fastify>;
  let role: "owner" | "admin" | "engineer" | "viewer";

  beforeEach(async () => {
    role = "owner";
    findManyMock.mockReset();
    createMock.mockReset();
    findFirstMock.mockReset();
    updateMock.mockReset();
    countMock.mockReset();
    alertChannelCountMock.mockReset();
    workflowCountMock.mockReset();
    workflowFindManyMock.mockReset();
    apiKeyFindManyMock.mockReset();
    resolveTenantAccessMock.mockReset();

    findManyMock.mockResolvedValue([
      {
        id: "gh-1",
        webhook_id: "hook-1",
        repository_full_name: "acme/payments",
        is_active: true,
        last_delivery_id: null,
        last_seen_at: null,
        created_at: new Date("2026-03-31T02:00:00.000Z"),
        updated_at: new Date("2026-03-31T02:00:00.000Z")
      }
    ]);
    createMock.mockResolvedValue({
      id: "gh-2",
      webhook_id: "hook-2",
      repository_full_name: "acme/checkout",
      is_active: true,
      last_delivery_id: null,
      last_seen_at: null,
      created_at: new Date("2026-03-31T03:00:00.000Z"),
      updated_at: new Date("2026-03-31T03:00:00.000Z")
    });
    findFirstMock.mockResolvedValue({
      id: "gh-1"
    });
    countMock.mockResolvedValue(0);
    alertChannelCountMock.mockResolvedValue(0);
    workflowCountMock.mockResolvedValue(0);
    workflowFindManyMock.mockResolvedValue([]);
    apiKeyFindManyMock.mockResolvedValue([]);
    updateMock.mockResolvedValue({
      id: "gh-1",
      webhook_id: "hook-1",
      repository_full_name: "acme/payments",
      is_active: false,
      last_delivery_id: null,
      last_seen_at: null,
      created_at: new Date("2026-03-31T02:00:00.000Z"),
      updated_at: new Date("2026-03-31T04:00:00.000Z")
    });
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

    app = Fastify();
    app.decorate("requireDashboardAuth", async (request: any) => {
      request.authUser = {
        user_id: "owner-1",
        email: "owner@synteq.local",
        full_name: "Owner",
        tenant_id: "tenant-A",
        role,
        email_verified_at: null
      };
    });
    app.decorate("requireRoles", () => async () => undefined);
    app.decorate("requireIngestionKey", async () => undefined);
    app.decorate("requireIngestionSignature", async () => undefined);
    app.decorate("requirePermissions", (permissions: string[]) => {
      return async (request: any, reply: any) => {
        if (!request.authUser) {
          return reply.code(401).send({ error: "Unauthorized" });
        }
        if (permissions.includes("SETTINGS_MANAGE") && !["owner", "admin"].includes(request.authUser.role)) {
          return reply.code(403).send({ error: "Forbidden", code: "FORBIDDEN_PERMISSION" });
        }
      };
    });

    const routes = (await import("../src/routes/control-plane.js")).default;
    await app.register(routes, { prefix: "/v1" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("lists tenant github integrations", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/control-plane/github-integrations",
      headers: {
        host: "api.synteq.local"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      integrations: [{ id: "gh-1", webhook_id: "hook-1" }],
      webhook_url: "http://api.synteq.local/v1/integrations/github/webhook"
    });
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: "tenant-A"
        })
      })
    );
  });

  it("creates integration and returns one-time webhook secret", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/control-plane/github-integrations",
      payload: {
        repository_full_name: "acme/checkout"
      },
      headers: {
        host: "api.synteq.local"
      }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.integration).toMatchObject({
      id: "gh-2",
      repository_full_name: "acme/checkout"
    });
    expect(typeof body.webhook_secret).toBe("string");
    expect(body.webhook_secret.length).toBeGreaterThan(10);
  });

  it("rotates integration secret and returns new one-time webhook secret", async () => {
    updateMock.mockResolvedValueOnce({
      id: "gh-1",
      webhook_id: "hook-1",
      repository_full_name: "acme/payments",
      is_active: true,
      last_delivery_id: null,
      last_seen_at: null,
      created_at: new Date("2026-03-31T02:00:00.000Z"),
      updated_at: new Date("2026-03-31T05:00:00.000Z")
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/control-plane/github-integrations/gh-1/rotate-secret",
      headers: {
        host: "api.synteq.local"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      integration: {
        id: "gh-1",
        webhook_id: "hook-1"
      },
      webhook_url: "http://api.synteq.local/v1/integrations/github/webhook"
    });
    expect(typeof body.webhook_secret).toBe("string");
    expect(body.webhook_secret.length).toBeGreaterThan(10);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "gh-1"
        },
        data: expect.objectContaining({
          webhook_secret: expect.any(String)
        })
      })
    );
  });

  it("prevents viewer from mutating integrations", async () => {
    role = "viewer";
    const response = await app.inject({
      method: "POST",
      url: "/v1/control-plane/github-integrations",
      payload: {
        repository_full_name: "acme/blocked"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("enforces tenant scoping on deactivate", async () => {
    findFirstMock.mockResolvedValueOnce(null);
    const response = await app.inject({
      method: "POST",
      url: "/v1/control-plane/github-integrations/gh-other/deactivate"
    });

    expect(response.statusCode).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns upgrade-required when free source capacity is exhausted", async () => {
    resolveTenantAccessMock.mockResolvedValueOnce({
      tenantId: "tenant-A",
      currentPlan: "free",
      effectivePlan: "free",
      entitlements: {},
      maxSources: 1,
      maxHistoryHours: 24,
      features: {
        alerts: false,
        team_members: false,
        premium_intelligence: false,
        trend_analysis: false
      }
    });
    workflowFindManyMock.mockResolvedValueOnce([
      {
        id: "wf-1",
        tenant_id: "tenant-A",
        display_name: "Payments Daily",
        slug: "payments-daily",
        system: "airflow",
        environment: "prod",
        is_active: true,
        created_at: new Date("2026-03-30T00:00:00.000Z")
      }
    ]);
    findManyMock.mockResolvedValueOnce([]);

    const response = await app.inject({
      method: "POST",
      url: "/v1/control-plane/github-integrations",
      payload: {
        repository_full_name: "acme/blocked"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: "UPGRADE_REQUIRED",
      feature: "source_capacity"
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("exposes control-plane data contract on sources response", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/control-plane/sources"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data_contract: {
        purpose: "Operational risk intelligence from event-level signals",
        doesNotCollectByDefault: expect.arrayContaining(["source code contents", "full execution logs"])
      }
    });
  });
});
