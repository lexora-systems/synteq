import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getReliabilityWindowsMock = vi.fn();
const getOperationalDashboardMock = vi.fn();
const getOverviewMetricsMock = vi.fn();

vi.mock("../src/services/reliability-windows-service.js", () => ({
  getReliabilityWindows: getReliabilityWindowsMock
}));

vi.mock("../src/services/operational-dashboard-service.js", () => ({
  getOperationalDashboard: getOperationalDashboardMock
}));

vi.mock("../src/services/metrics-service.js", () => ({
  getOverviewMetrics: getOverviewMetricsMock
}));

vi.mock("../src/services/tenant-trial-service.js", () => ({
  getTenantEntitlements: vi.fn()
}));

function reliabilityPayload() {
  return {
    generatedAt: "2026-05-01T10:00:00.000Z",
    scope: {
      tenantId: "tenant-A",
      workflowId: "wf-1",
      sourceId: "src-1",
      sourceKey: "payments-daily"
    },
    windows: [
      {
        label: "1h",
        startAt: "2026-05-01T09:00:00.000Z",
        endAt: "2026-05-01T10:00:00.000Z",
        total: 10,
        succeeded: 9,
        failed: 1,
        timedOut: 0,
        unknown: 0,
        successRate: 0.9,
        failureRate: 0.1,
        timeoutRate: 0,
        lastSignalAt: "2026-05-01T09:58:00.000Z",
        state: "degraded"
      },
      {
        label: "24h",
        startAt: "2026-04-30T10:00:00.000Z",
        endAt: "2026-05-01T10:00:00.000Z",
        total: 12,
        succeeded: 11,
        failed: 1,
        timedOut: 0,
        unknown: 0,
        successRate: 0.9167,
        failureRate: 0.0833,
        timeoutRate: 0,
        lastSignalAt: "2026-05-01T09:58:00.000Z",
        state: "degraded"
      },
      {
        label: "7d",
        startAt: "2026-04-24T10:00:00.000Z",
        endAt: "2026-05-01T10:00:00.000Z",
        total: 12,
        succeeded: 11,
        failed: 1,
        timedOut: 0,
        unknown: 0,
        successRate: 0.9167,
        failureRate: 0.0833,
        timeoutRate: 0,
        lastSignalAt: "2026-05-01T09:58:00.000Z",
        state: "degraded"
      }
    ]
  };
}

describe("metrics reliability windows API", () => {
  let app: ReturnType<typeof Fastify>;
  let authMode: "ok" | "missing_tenant" | "unauthorized";
  let permissionAllowed: boolean;

  beforeEach(async () => {
    vi.resetModules();
    getReliabilityWindowsMock.mockReset();
    getOperationalDashboardMock.mockReset();
    getOverviewMetricsMock.mockReset();
    getReliabilityWindowsMock.mockResolvedValue(reliabilityPayload());

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

  it("returns compact tenant-scoped reliability windows", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/metrics/reliability-windows?workflowId=wf-1&sourceId=src-1&sourceKey=payments-daily"
    });

    expect(response.statusCode).toBe(200);
    expect(getReliabilityWindowsMock).toHaveBeenCalledWith({
      tenantId: "tenant-A",
      workflowId: "wf-1",
      sourceId: "src-1",
      sourceKey: "payments-daily"
    });
    const body = response.json();
    expect(body).toMatchObject({
      generatedAt: "2026-05-01T10:00:00.000Z",
      scope: {
        workflowId: "wf-1",
        sourceId: "src-1",
        sourceKey: "payments-daily"
      },
      request_id: expect.any(String)
    });
    expect(body.windows[0]).toMatchObject({
      label: "1h",
      successRate: 0.9,
      state: "degraded"
    });
    expect(response.body).not.toContain("payload_json");
    expect(response.body).not.toContain("secret");
    expect(response.body).not.toContain("api_key");
    expect(response.body).not.toContain("webhook");
  });

  it("also accepts existing snake_case query aliases", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/metrics/reliability-windows?workflow_id=wf-1&source_id=src-1&source_key=payments-daily"
    });

    expect(response.statusCode).toBe(200);
    expect(getReliabilityWindowsMock).toHaveBeenCalledWith({
      tenantId: "tenant-A",
      workflowId: "wf-1",
      sourceId: "src-1",
      sourceKey: "payments-daily"
    });
  });

  it("requires authenticated dashboard access", async () => {
    authMode = "unauthorized";

    const response = await app.inject({
      method: "GET",
      url: "/v1/metrics/reliability-windows"
    });

    expect(response.statusCode).toBe(401);
    expect(getReliabilityWindowsMock).not.toHaveBeenCalled();
  });

  it("requires dashboard view permission", async () => {
    permissionAllowed = false;

    const response = await app.inject({
      method: "GET",
      url: "/v1/metrics/reliability-windows"
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: "FORBIDDEN_PERMISSION"
    });
    expect(getReliabilityWindowsMock).not.toHaveBeenCalled();
  });

  it("rejects requests without tenant context", async () => {
    authMode = "missing_tenant";

    const response = await app.inject({
      method: "GET",
      url: "/v1/metrics/reliability-windows"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: "Missing tenant context"
    });
    expect(getReliabilityWindowsMock).not.toHaveBeenCalled();
  });
});
