import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runReliabilityScanMock = vi.fn();
const redisGetJsonMock = vi.fn();
const redisSetJsonMock = vi.fn();

vi.mock("../src/services/reliability-scan-service.js", () => ({
  runReliabilityScan: runReliabilityScanMock
}));

vi.mock("../src/lib/redis.js", () => ({
  redisKey: (...parts: Array<string | number>) => parts.join(":"),
  redisGetJson: redisGetJsonMock,
  redisSetJson: redisSetJsonMock
}));

describe("scan api currency fields", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    runReliabilityScanMock.mockReset();
    redisGetJsonMock.mockReset();
    redisSetJsonMock.mockReset();
    redisGetJsonMock.mockResolvedValue(null);
    redisSetJsonMock.mockResolvedValue(undefined);
    runReliabilityScanMock.mockResolvedValue({
      workflow_id: "wf-1",
      workflow_name: "Payments",
      scan_window: {
        from: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        to: new Date().toISOString()
      },
      reliability_score: 88,
      success_rate: 0.97,
      duplicate_rate: 0.01,
      retry_rate: 0.05,
      latency_health_score: 84,
      anomaly_flags: [],
      estimated_monthly_risk_usd: 4800,
      estimated_monthly_risk: 268800,
      currency: "PHP",
      conversion_rate: 56,
      recommendation: "Stable.",
      enough_data: true,
      generated_by: "scan_rules_v1"
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
    app.decorate("requireRoles", () => async () => undefined);
    app.decorate("requirePermissions", () => async () => undefined);

    const scanRoutes = (await import("../src/routes/scan.js")).default;
    await app.register(scanRoutes, { prefix: "/v1" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns usd and converted risk fields in scan response", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/scan/run",
      payload: {
        workflow_id: "wf-1",
        range: "24h"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      estimated_monthly_risk_usd: 4800,
      estimated_monthly_risk: 268800,
      currency: "PHP",
      conversion_rate: 56
    });
  });
});

