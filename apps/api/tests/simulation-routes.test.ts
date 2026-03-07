import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workflowFindFirstMock = vi.fn();
const alertPolicyFindFirstMock = vi.fn();
const alertPolicyCreateMock = vi.fn();
const enqueueExecutionEventMock = vi.fn();

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    workflow: {
      findFirst: workflowFindFirstMock
    },
    alertPolicy: {
      findFirst: alertPolicyFindFirstMock,
      create: alertPolicyCreateMock
    }
  }
}));

vi.mock("../src/services/ingest-queue-service.js", () => ({
  enqueueExecutionEvent: enqueueExecutionEventMock
}));

describe("simulation routes", () => {
  let app: ReturnType<typeof Fastify>;
  let role: "owner" | "admin" | "engineer" | "viewer";

  beforeEach(async () => {
    role = "engineer";
    workflowFindFirstMock.mockReset();
    alertPolicyFindFirstMock.mockReset();
    alertPolicyCreateMock.mockReset();
    enqueueExecutionEventMock.mockReset();

    workflowFindFirstMock.mockResolvedValue({
      id: "wf-1",
      slug: "payments-daily",
      environment: "prod"
    });
    alertPolicyFindFirstMock.mockResolvedValue({ id: "policy-1" });
    alertPolicyCreateMock.mockResolvedValue({ id: "policy-created" });
    enqueueExecutionEventMock.mockResolvedValue({
      queued: false,
      fingerprint: "fp"
    });

    app = Fastify();
    app.decorate("requireDashboardAuth", async (request: any) => {
      request.authUser = {
        user_id: "user-1",
        email: "eng@synteq.local",
        full_name: "Engineer",
        tenant_id: "tenant-A",
        role,
        email_verified_at: null
      };
    });
    app.decorate("requireRoles", () => async () => undefined);
    app.decorate("requirePermissions", () => async () => undefined);
    app.decorate("requireIngestionKey", async () => undefined);
    app.decorate("requireIngestionSignature", async () => undefined);
    app.setErrorHandler((error: Error, _request: unknown, reply: { code: (value: number) => { send: (payload: unknown) => unknown } }) => {
      if ((error as Error).name === "ValidationError") {
        return reply.code(400).send({ error: "Bad Request" });
      }
      return reply.code(500).send({ error: "Internal Server Error" });
    });

    const simulateRoutes = (await import("../src/routes/simulate.js")).default;
    await app.register(simulateRoutes, { prefix: "/v1" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("validates request body for each simulation endpoint", async () => {
    const endpoints = ["webhook-failure", "retry-storm", "latency-spike", "duplicate-webhook"];
    for (const endpoint of endpoints) {
      const response = await app.inject({
        method: "POST",
        url: `/v1/simulate/${endpoint}`,
        payload: {}
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it("requires workflow write/settings-manage permissions", async () => {
    role = "viewer";
    const response = await app.inject({
      method: "POST",
      url: "/v1/simulate/retry-storm",
      payload: {
        workflow_id: "wf-1"
      }
    });

    expect(response.statusCode).toBe(403);
  });

  it("tags synthetic payload metadata through the simulation pipeline", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/simulate/duplicate-webhook",
      payload: {
        workflow_id: "wf-1"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(enqueueExecutionEventMock).toHaveBeenCalled();

    const [firstInput, firstRequestId, firstOptions] = enqueueExecutionEventMock.mock.calls[0] as [
      { payload: Record<string, unknown> },
      string,
      { fingerprintOverride?: string }
    ];
    expect(firstRequestId).toContain("-");
    expect(firstInput.payload).toMatchObject({
      simulation: true,
      scenario: "duplicate-webhook"
    });
    expect(firstOptions.fingerprintOverride).toBeTruthy();
  });
});
