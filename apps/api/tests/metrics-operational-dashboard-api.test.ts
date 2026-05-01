import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getOperationalDashboardMock = vi.fn();
const getOverviewMetricsMock = vi.fn();

vi.mock("../src/services/operational-dashboard-service.js", () => ({
  getOperationalDashboard: getOperationalDashboardMock
}));

vi.mock("../src/services/metrics-service.js", () => ({
  getOverviewMetrics: getOverviewMetricsMock
}));

vi.mock("../src/services/tenant-trial-service.js", () => ({
  getTenantEntitlements: vi.fn()
}));

function dashboardPayload() {
  return {
    generatedAt: "2026-05-01T10:00:00.000Z",
    globalState: "healthy",
    activeIncidents: {
      total: 0,
      bySeverity: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        unknown: 0
      }
    },
    recentlyResolved: {
      total: 1,
      windowHours: 24
    },
    sources: {
      total: 1,
      fresh: 1,
      stale: 0,
      unknown: 0,
      items: [
        {
          id: "wf-1",
          name: "Customer Onboarding",
          type: "n8n",
          state: "fresh",
          lastSignalAt: "2026-05-01T09:55:00.000Z"
        }
      ]
    },
    workflows: {
      total: 1,
      healthy: 1,
      degraded: 0,
      failing: 0,
      unknown: 0,
      items: [
        {
          id: "wf-1",
          name: "Customer Onboarding",
          sourceName: "n8n",
          environment: "production",
          state: "healthy",
          lastSignalAt: "2026-05-01T09:55:00.000Z",
          activeIncidentCount: 0
        }
      ]
    },
    pipeline: {
      state: "fresh",
      jobs: [
        {
          name: "aggregate",
          state: "fresh",
          lastSeenAt: "2026-05-01T09:59:00.000Z"
        }
      ]
    },
    events: {
      windowHours: 1,
      succeeded: 2,
      failed: 0,
      timedOut: 0,
      unknown: 0
    }
  };
}

describe("metrics operational dashboard API", () => {
  let app: ReturnType<typeof Fastify>;
  let authMode: "ok" | "missing_tenant" | "unauthorized";
  let permissionAllowed: boolean;

  beforeEach(async () => {
    vi.resetModules();
    getOperationalDashboardMock.mockReset();
    getOverviewMetricsMock.mockReset();
    getOperationalDashboardMock.mockResolvedValue(dashboardPayload());

    authMode = "ok";
    permissionAllowed = true;
    app = Fastify();
    app.decorate("requireDashboardAuth", async (request: any, reply: any) => {
      if (authMode === "unauthorized") {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      request.authUser = {
        user_id: "user-1",
        email: "viewer@synteq.local",
        full_name: "Viewer",
        tenant_id: authMode === "missing_tenant" ? undefined : "tenant-A",
        role: "viewer",
        email_verified_at: null
      };
    });
    app.decorate("requirePermissions", () => {
      return async (_request: any, reply: any) => {
        if (!permissionAllowed) {
          return reply.code(403).send({
            error: "Forbidden",
            code: "FORBIDDEN_PERMISSION"
          });
        }
      };
    });
    app.decorate("requireRoles", () => async () => undefined);

    const metricsRoutes = (await import("../src/routes/metrics.js")).default;
    await app.register(metricsRoutes, { prefix: "/v1" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns a compact tenant-scoped operational dashboard", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/metrics/operational-dashboard"
    });

    expect(response.statusCode).toBe(200);
    expect(getOperationalDashboardMock).toHaveBeenCalledWith({
      tenantId: "tenant-A"
    });
    expect(response.json()).toMatchObject({
      globalState: "healthy",
      activeIncidents: {
        total: 0
      },
      sources: {
        total: 1
      },
      request_id: expect.any(String)
    });
    expect(response.body).not.toContain("secret");
    expect(response.body).not.toContain("api_key");
    expect(response.body).not.toContain("webhook_secret");
  });

  it("requires authenticated dashboard access", async () => {
    authMode = "unauthorized";

    const response = await app.inject({
      method: "GET",
      url: "/v1/metrics/operational-dashboard"
    });

    expect(response.statusCode).toBe(401);
    expect(getOperationalDashboardMock).not.toHaveBeenCalled();
  });

  it("requires dashboard view permission", async () => {
    permissionAllowed = false;

    const response = await app.inject({
      method: "GET",
      url: "/v1/metrics/operational-dashboard"
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: "FORBIDDEN_PERMISSION"
    });
    expect(getOperationalDashboardMock).not.toHaveBeenCalled();
  });

  it("rejects requests without tenant context", async () => {
    authMode = "missing_tenant";

    const response = await app.inject({
      method: "GET",
      url: "/v1/metrics/operational-dashboard"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: "Missing tenant context"
    });
    expect(getOperationalDashboardMock).not.toHaveBeenCalled();
  });
});
