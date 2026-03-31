import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const alertChannelFindManyMock = vi.fn();
const alertChannelCreateMock = vi.fn();
const alertChannelFindFirstMock = vi.fn();
const alertChannelUpdateMock = vi.fn();
const alertPolicyFindManyMock = vi.fn();
const alertPolicyFindFirstMock = vi.fn();
const alertPolicyDeleteMock = vi.fn();
const workflowFindFirstMock = vi.fn();
const prismaTransactionMock = vi.fn();

const resolveTenantAccessMock = vi.fn();

vi.mock("../src/config.js", () => ({
  config: {
    SYNTEQ_API_KEY_SALT: "test-salt-value-with-minimum-length-123456789"
  }
}));

vi.mock("../src/services/entitlement-guard-service.js", () => ({
  resolveTenantAccess: resolveTenantAccessMock,
  requireSourceCapacity: () => undefined,
  requireFeature: (access: { features: Record<string, boolean> }, feature: string) => {
    if (!access.features?.[feature]) {
      const error = new Error("Upgrade required");
      (error as Error & { code?: string; feature?: string }).code = "UPGRADE_REQUIRED";
      (error as Error & { code?: string; feature?: string }).feature = feature;
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
      feature: typed.feature ?? "alerts",
      message: typed.message ?? "Upgrade required for alerts",
      request_id: requestId
    });
    return true;
  }
}));

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    alertChannel: {
      findMany: alertChannelFindManyMock,
      create: alertChannelCreateMock,
      findFirst: alertChannelFindFirstMock,
      update: alertChannelUpdateMock
    },
    alertPolicy: {
      findMany: alertPolicyFindManyMock,
      findFirst: alertPolicyFindFirstMock,
      delete: alertPolicyDeleteMock
    },
    workflow: {
      findFirst: workflowFindFirstMock
    },
    $transaction: prismaTransactionMock
  }
}));

describe("control plane alerts routes", () => {
  let app: ReturnType<typeof Fastify>;
  let role: "owner" | "admin" | "engineer" | "viewer";
  let alertsEntitled: boolean;

  beforeEach(async () => {
    role = "owner";
    alertsEntitled = true;

    alertChannelFindManyMock.mockReset();
    alertChannelCreateMock.mockReset();
    alertChannelFindFirstMock.mockReset();
    alertChannelUpdateMock.mockReset();
    alertPolicyFindManyMock.mockReset();
    alertPolicyFindFirstMock.mockReset();
    alertPolicyDeleteMock.mockReset();
    workflowFindFirstMock.mockReset();
    prismaTransactionMock.mockReset();
    resolveTenantAccessMock.mockReset();

    resolveTenantAccessMock.mockImplementation(async () => ({
      tenantId: "tenant-A",
      currentPlan: alertsEntitled ? "pro" : "free",
      effectivePlan: alertsEntitled ? "pro" : "free",
      entitlements: {},
      maxSources: alertsEntitled ? null : 1,
      maxHistoryHours: alertsEntitled ? null : 24,
      features: {
        alerts: alertsEntitled,
        team_members: alertsEntitled,
        premium_intelligence: alertsEntitled,
        trend_analysis: alertsEntitled
      }
    }));

    alertChannelFindManyMock.mockResolvedValue([
      {
        id: "ch-1",
        name: "Ops Slack",
        type: "slack",
        config_json: {
          webhook_url: "https://hooks.slack.com/services/a/b/c"
        },
        is_enabled: true,
        created_at: new Date("2026-03-31T01:00:00.000Z")
      }
    ]);
    alertChannelCreateMock.mockResolvedValue({
      id: "ch-2",
      name: "Ops Slack 2",
      type: "slack",
      config_json: {
        webhook_url: "https://hooks.slack.com/services/d/e/f"
      },
      is_enabled: true,
      created_at: new Date("2026-03-31T02:00:00.000Z")
    });
    workflowFindFirstMock.mockResolvedValue({
      id: "wf-1"
    });

    prismaTransactionMock.mockImplementation(
      async (
        callback: (tx: {
          alertPolicy: {
            create: (args: unknown) => Promise<{ id: string }>;
            findUniqueOrThrow: (args: unknown) => Promise<{
              id: string;
              name: string;
              metric: string;
              window_sec: number;
              threshold: number;
              comparator: string;
              min_events: number;
              severity: string;
              is_enabled: boolean;
              filter_workflow_id: string | null;
              filter_env: string | null;
              created_at: Date;
              channels: Array<{
                channel: { id: string; name: string; type: string; is_enabled: boolean };
              }>;
            }>;
          };
          alertPolicyChannel: {
            createMany: (args: unknown) => Promise<unknown>;
          };
        }) => Promise<unknown>
      ) =>
        callback({
          alertPolicy: {
            create: async () => ({ id: "pol-1" }),
            findUniqueOrThrow: async () => ({
              id: "pol-1",
              name: "Failure Spike",
              metric: "failure_rate",
              window_sec: 300,
              threshold: 0.2,
              comparator: "gte",
              min_events: 20,
              severity: "high",
              is_enabled: true,
              filter_workflow_id: "wf-1",
              filter_env: "prod",
              created_at: new Date("2026-03-31T03:00:00.000Z"),
              channels: [
                {
                  channel: {
                    id: "ch-1",
                    name: "Ops Slack",
                    type: "slack",
                    is_enabled: true
                  }
                }
              ]
            })
          },
          alertPolicyChannel: {
            createMany: async () => ({ count: 1 })
          }
        })
    );

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

  it("blocks alert channel creation when alerts entitlement is unavailable", async () => {
    alertsEntitled = false;
    const response = await app.inject({
      method: "POST",
      url: "/v1/control-plane/alert-channels",
      payload: {
        type: "slack",
        name: "Ops Slack",
        config: {
          webhook_url: "https://hooks.slack.com/services/a/b/c"
        }
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: "UPGRADE_REQUIRED",
      feature: "alerts"
    });
  });

  it("allows entitled owner to create alert channel and policy", async () => {
    alertChannelFindManyMock.mockResolvedValueOnce([
      {
        id: "ch-1"
      }
    ]);

    const channelResponse = await app.inject({
      method: "POST",
      url: "/v1/control-plane/alert-channels",
      payload: {
        type: "slack",
        name: "Ops Slack 2",
        config: {
          webhook_url: "https://hooks.slack.com/services/d/e/f"
        }
      }
    });
    expect(channelResponse.statusCode).toBe(201);

    const policyResponse = await app.inject({
      method: "POST",
      url: "/v1/control-plane/alert-policies",
      payload: {
        name: "Failure Spike",
        metric: "failure_rate",
        window_sec: 300,
        threshold: 0.2,
        comparator: "gte",
        min_events: 20,
        severity: "high",
        is_enabled: true,
        filter_workflow_id: "wf-1",
        filter_env: "prod",
        channel_ids: ["ch-1"]
      }
    });

    expect(policyResponse.statusCode).toBe(201);
    expect(policyResponse.json()).toMatchObject({
      policy: {
        id: "pol-1",
        metric: "failure_rate",
        channels: [{ id: "ch-1" }]
      }
    });
  });

  it("allows viewer read-only channels access but blocks mutation", async () => {
    role = "viewer";
    const readResponse = await app.inject({
      method: "GET",
      url: "/v1/control-plane/alert-channels"
    });
    expect(readResponse.statusCode).toBe(200);

    const writeResponse = await app.inject({
      method: "POST",
      url: "/v1/control-plane/alert-channels",
      payload: {
        type: "email",
        name: "Ops Mail",
        config: {
          email: "ops@synteq.local"
        }
      }
    });
    expect(writeResponse.statusCode).toBe(403);
  });

  it("enforces tenant scoping for channel ids on policy create", async () => {
    alertChannelFindManyMock.mockResolvedValueOnce([]);

    const response = await app.inject({
      method: "POST",
      url: "/v1/control-plane/alert-policies",
      payload: {
        name: "Failure Spike",
        metric: "failure_rate",
        window_sec: 300,
        threshold: 0.2,
        comparator: "gte",
        min_events: 20,
        severity: "high",
        channel_ids: ["ch-other"]
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: "One or more channels were not found for this tenant"
    });
  });
});
