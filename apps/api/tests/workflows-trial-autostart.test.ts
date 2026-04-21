import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workflowUpsertMock = vi.fn();
const workflowFindManyMock = vi.fn();
const workflowFindUniqueMock = vi.fn();
const workflowCountMock = vi.fn();
const githubIntegrationFindManyMock = vi.fn();
const githubIntegrationCountMock = vi.fn();
const workflowVersionFindFirstMock = vi.fn();
const workflowVersionCreateMock = vi.fn();
const alertPolicyFindFirstMock = vi.fn();
const alertPolicyCreateMock = vi.fn();
const startTrialIfEligibleMock = vi.fn();
const getTenantEntitlementsMock = vi.fn();

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    workflow: {
      upsert: workflowUpsertMock,
      findMany: workflowFindManyMock,
      findUnique: workflowFindUniqueMock,
      count: workflowCountMock
    },
    gitHubIntegration: {
      findMany: githubIntegrationFindManyMock,
      count: githubIntegrationCountMock
    },
    workflowVersion: {
      findFirst: workflowVersionFindFirstMock,
      create: workflowVersionCreateMock
    },
    alertPolicy: {
      findFirst: alertPolicyFindFirstMock,
      create: alertPolicyCreateMock
    }
  }
}));

vi.mock("../src/services/tenant-trial-service.js", () => ({
  startTrialIfEligible: startTrialIfEligibleMock,
  getTenantEntitlements: getTenantEntitlementsMock
}));

describe("workflow register trial auto-start", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    workflowUpsertMock.mockReset();
    workflowFindManyMock.mockReset();
    workflowFindUniqueMock.mockReset();
    workflowCountMock.mockReset();
    githubIntegrationFindManyMock.mockReset();
    githubIntegrationCountMock.mockReset();
    workflowVersionFindFirstMock.mockReset();
    workflowVersionCreateMock.mockReset();
    alertPolicyFindFirstMock.mockReset();
    alertPolicyCreateMock.mockReset();
    startTrialIfEligibleMock.mockReset();
    getTenantEntitlementsMock.mockReset();

    workflowUpsertMock.mockResolvedValue({
      id: "wf-1",
      tenant_id: "tenant-A",
      slug: "payments-daily",
      display_name: "Payments Daily",
      system: "airflow",
      environment: "prod",
      is_active: true,
      created_at: new Date()
    });
    workflowFindUniqueMock.mockResolvedValue(null);
    workflowCountMock.mockResolvedValue(0);
    workflowFindManyMock.mockResolvedValue([]);
    githubIntegrationFindManyMock.mockResolvedValue([]);
    githubIntegrationCountMock.mockResolvedValue(0);
    workflowVersionFindFirstMock.mockResolvedValue(null);
    workflowVersionCreateMock.mockResolvedValue({ id: "ver-1" });
    alertPolicyFindFirstMock.mockResolvedValue(null);
    alertPolicyCreateMock.mockResolvedValue({ id: "policy-1" });
    startTrialIfEligibleMock.mockResolvedValue({ code: "started" });
    getTenantEntitlementsMock.mockResolvedValue({
      tenant_id: "tenant-A",
      current_plan: "free",
      effective_plan: "free",
      trial: {
        status: "none",
        available: true,
        active: false,
        consumed: false,
        started_at: null,
        ends_at: null,
        source: null,
        days_remaining: 0
      }
    });

    app = Fastify();
    app.decorate("requireDashboardAuth", async (request: any) => {
      request.authUser = {
        user_id: "user-1",
        email: "owner@synteq.local",
        full_name: "Owner",
        tenant_id: "tenant-A",
        role: "owner",
        email_verified_at: null
      };
    });
    app.decorate("requireRoles", () => async () => undefined);
    app.decorate("requirePermissions", () => async () => undefined);
    app.setErrorHandler((error: Error, _request: unknown, reply: any) => {
      if (error.name === "ValidationError") {
        return reply.code(400).send({ error: "Bad Request" });
      }
      return reply.code(500).send({ error: "Internal Server Error" });
    });

    const workflowRoutes = (await import("../src/routes/workflows.js")).default;
    await app.register(workflowRoutes, { prefix: "/v1" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("auto-starts trial on workflow registration", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/workflows/register",
      payload: {
        slug: "payments-daily",
        display_name: "Payments Daily",
        system: "airflow",
        environment: "prod"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(startTrialIfEligibleMock).toHaveBeenCalledWith({
      tenantId: "tenant-A",
      source: "auto_workflow_connect"
    });
    expect(alertPolicyCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenant_id: "tenant-A",
          metric: "missing_heartbeat",
          filter_env: "prod",
          filter_workflow_id: "wf-1",
          is_enabled: true
        })
      })
    );
  });

  it("blocks free tenants from registering a second active source", async () => {
    workflowFindUniqueMock.mockResolvedValue(null);
    workflowFindManyMock.mockResolvedValue([
      {
        id: "wf-existing",
        tenant_id: "tenant-A",
        display_name: "Existing Workflow",
        slug: "existing-workflow",
        system: "airflow",
        environment: "prod",
        is_active: true,
        created_at: new Date("2026-03-10T00:00:00.000Z")
      }
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/v1/workflows/register",
      payload: {
        slug: "payments-weekly",
        display_name: "Payments Weekly",
        system: "airflow",
        environment: "prod"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: "UPGRADE_REQUIRED",
      feature: "source_capacity"
    });
    expect(workflowUpsertMock).not.toHaveBeenCalled();
    expect(startTrialIfEligibleMock).not.toHaveBeenCalled();
  });

  it("allows updates for existing sources even when tenant is already above free source limit", async () => {
    workflowFindUniqueMock.mockResolvedValue({
      id: "wf-1"
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/workflows/register",
      payload: {
        slug: "payments-daily",
        display_name: "Payments Daily Updated",
        system: "airflow",
        environment: "prod"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(workflowUpsertMock).toHaveBeenCalledTimes(1);
  });

  it("does not create duplicate missing-heartbeat policy when one already exists", async () => {
    alertPolicyFindFirstMock.mockResolvedValue({
      id: "policy-existing"
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/workflows/register",
      payload: {
        slug: "payments-daily",
        display_name: "Payments Daily",
        system: "airflow",
        environment: "prod"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(alertPolicyCreateMock).not.toHaveBeenCalled();
  });
});
