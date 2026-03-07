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

describe("scan api", () => {
  let app: ReturnType<typeof Fastify>;
  let role: "owner" | "admin" | "engineer" | "viewer";

  const sampleScan = {
    workflow_id: "wf-1",
    workflow_name: "Payments",
    scan_window: {
      from: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      to: new Date().toISOString()
    },
    reliability_score: 82,
    success_rate: 0.95,
    duplicate_rate: 0.03,
    retry_rate: 0.08,
    latency_health_score: 76,
    anomaly_flags: ["duplicate_risk", "failure_risk"],
    estimated_monthly_risk_usd: 5400,
    recommendation: "Investigate duplicate risk and failure contributors.",
    enough_data: true,
    generated_by: "scan_rules_v1" as const
  };

  beforeEach(async () => {
    role = "viewer";
    runReliabilityScanMock.mockReset();
    redisGetJsonMock.mockReset();
    redisSetJsonMock.mockReset();
    runReliabilityScanMock.mockResolvedValue(sampleScan);
    redisSetJsonMock.mockResolvedValue(undefined);
    redisGetJsonMock.mockResolvedValue(null);

    app = Fastify();
    app.decorate("requireDashboardAuth", async (request: any) => {
      request.authUser = {
        user_id: "user-1",
        email: "viewer@synteq.local",
        full_name: "Viewer",
        tenant_id: "tenant-A",
        role,
        email_verified_at: null
      };
    });
    app.decorate("requireRoles", () => async () => undefined);
    app.decorate("requirePermissions", () => async () => undefined);
    app.decorate("requireIngestionKey", async () => undefined);
    app.decorate("requireIngestionSignature", async () => undefined);

    const scanRoutes = (await import("../src/routes/scan.js")).default;
    await app.register(scanRoutes, { prefix: "/v1" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns deterministic scan response fields with top risks and next steps", async () => {
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
      workflow_id: "wf-1",
      reliability_score: 82,
      top_risks: expect.any(Array),
      next_steps: expect.any(Array)
    });
    expect(body.top_risks.length).toBeGreaterThan(0);
    expect(body.next_steps.length).toBeGreaterThan(0);
  });

  it("enforces tenant scoping by passing tenant context into scan service", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/scan/run",
      payload: {
        workflow_id: "wf-1"
      }
    });

    expect(runReliabilityScanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-A",
        workflowId: "wf-1"
      })
    );
  });

  it("serves cached latest scan when available", async () => {
    redisGetJsonMock.mockResolvedValue(sampleScan);
    const response = await app.inject({
      method: "GET",
      url: "/v1/scan/wf-1/latest?range=24h"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      cached: true,
      workflow_id: "wf-1"
    });
    expect(runReliabilityScanMock).not.toHaveBeenCalled();
  });
});

