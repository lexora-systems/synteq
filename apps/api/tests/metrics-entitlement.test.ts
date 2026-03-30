import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getOverviewMetricsMock = vi.fn();
const getTenantEntitlementsMock = vi.fn();

vi.mock("../src/services/metrics-service.js", () => ({
  getOverviewMetrics: getOverviewMetricsMock
}));

vi.mock("../src/services/tenant-trial-service.js", () => ({
  getTenantEntitlements: getTenantEntitlementsMock
}));

describe("metrics entitlement history clamp", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    getOverviewMetricsMock.mockReset();
    getTenantEntitlementsMock.mockReset();
    getOverviewMetricsMock.mockResolvedValue({
      summary: null,
      series: [],
      windows: {}
    });

    app = Fastify();
    app.decorate("requireDashboardAuth", async (request: any) => {
      request.authUser = {
        user_id: "user-1",
        email: "viewer@synteq.local",
        full_name: "Viewer",
        tenant_id: "tenant-A",
        role: "viewer",
        email_verified_at: null
      };
    });
    app.decorate("requirePermissions", () => async () => undefined);
    app.decorate("requireRoles", () => async () => undefined);

    const metricsRoutes = (await import("../src/routes/metrics.js")).default;
    await app.register(metricsRoutes, { prefix: "/v1" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("clamps free plan history requests to 24h", async () => {
    getTenantEntitlementsMock.mockResolvedValue({
      tenant_id: "tenant-A",
      current_plan: "free",
      effective_plan: "free",
      trial: {
        status: "none",
        available: false,
        active: false,
        consumed: false,
        started_at: null,
        ends_at: null,
        source: null,
        days_remaining: 0
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/metrics/overview?range=7d"
    });

    expect(response.statusCode).toBe(200);
    expect(getOverviewMetricsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-A",
        range: "24h"
      })
    );
  });

  it("preserves requested history for pro plans", async () => {
    getTenantEntitlementsMock.mockResolvedValue({
      tenant_id: "tenant-A",
      current_plan: "pro",
      effective_plan: "pro",
      trial: {
        status: "none",
        available: false,
        active: false,
        consumed: false,
        started_at: null,
        ends_at: null,
        source: null,
        days_remaining: 0
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/metrics/overview?range=7d"
    });

    expect(response.statusCode).toBe(200);
    expect(getOverviewMetricsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-A",
        range: "7d"
      })
    );
  });
});
