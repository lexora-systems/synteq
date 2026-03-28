import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workflowUpsertMock = vi.fn();
const workflowVersionFindFirstMock = vi.fn();
const workflowVersionCreateMock = vi.fn();
const startTrialIfEligibleMock = vi.fn();

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    workflow: {
      upsert: workflowUpsertMock,
      findMany: vi.fn()
    },
    workflowVersion: {
      findFirst: workflowVersionFindFirstMock,
      create: workflowVersionCreateMock
    }
  }
}));

vi.mock("../src/services/tenant-trial-service.js", () => ({
  startTrialIfEligible: startTrialIfEligibleMock
}));

describe("workflow register trial auto-start", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    workflowUpsertMock.mockReset();
    workflowVersionFindFirstMock.mockReset();
    workflowVersionCreateMock.mockReset();
    startTrialIfEligibleMock.mockReset();

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
    workflowVersionFindFirstMock.mockResolvedValue(null);
    workflowVersionCreateMock.mockResolvedValue({ id: "ver-1" });
    startTrialIfEligibleMock.mockResolvedValue({ code: "started" });

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
  });
});
