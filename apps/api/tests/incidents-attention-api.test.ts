import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasRequiredPermissions } from "../src/auth/permissions.js";

const getIncidentAttentionGroupsMock = vi.fn();
const dispatchPendingAlertEventsMock = vi.fn();
const listIncidentsMock = vi.fn();
const getIncidentByIdMock = vi.fn();
const listIncidentEventsMock = vi.fn();
const ackIncidentMock = vi.fn();
const resolveIncidentMock = vi.fn();
const generateIncidentGuidanceMock = vi.fn();
const getIncidentTimelineMock = vi.fn();

vi.mock("../src/services/incident-attention-service.js", () => ({
  getIncidentAttentionGroups: getIncidentAttentionGroupsMock
}));

vi.mock("../src/services/alert-service.js", () => ({
  dispatchPendingAlertEvents: dispatchPendingAlertEventsMock
}));

vi.mock("../src/services/incidents-service.js", () => ({
  listIncidents: listIncidentsMock,
  getIncidentById: getIncidentByIdMock,
  listIncidentEvents: listIncidentEventsMock,
  ackIncident: ackIncidentMock,
  resolveIncident: resolveIncidentMock
}));

vi.mock("../src/services/incident-guidance-service.js", () => ({
  generateIncidentGuidance: generateIncidentGuidanceMock
}));

vi.mock("../src/services/incident-timeline-service.js", () => ({
  getIncidentTimeline: getIncidentTimelineMock
}));

function attentionPayload() {
  return {
    generatedAt: "2026-05-01T10:00:00.000Z",
    groups: [
      {
        id: "attn_123",
        label: "Customer Onboarding / production",
        attention: "elevated",
        incidentCount: 2,
        highestSeverity: "medium",
        lastSeenAt: "2026-05-01T09:55:00.000Z",
        alertFailureCount: 0,
        activeStatuses: {
          open: 1,
          acked: 1
        },
        groupKey: {
          workflowId: "wf-1",
          workflowName: "Customer Onboarding",
          environment: "production"
        }
      }
    ]
  };
}

describe("incidents attention groups API", () => {
  let app: ReturnType<typeof Fastify>;
  let authMode: "ok" | "missing_tenant" | "unauthorized";
  let permissionAllowed: boolean;

  beforeEach(async () => {
    vi.resetModules();
    getIncidentAttentionGroupsMock.mockReset();
    dispatchPendingAlertEventsMock.mockReset();
    listIncidentsMock.mockReset();
    getIncidentByIdMock.mockReset();
    listIncidentEventsMock.mockReset();
    ackIncidentMock.mockReset();
    resolveIncidentMock.mockReset();
    generateIncidentGuidanceMock.mockReset();
    getIncidentTimelineMock.mockReset();
    getIncidentAttentionGroupsMock.mockResolvedValue(attentionPayload());

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
    app.decorate("requirePermissions", (required: any[]) => {
      return async (request: any, reply: any) => {
        if (!request.authUser) {
          return reply.code(401).send({ error: "Unauthorized" });
        }
        if (!permissionAllowed || !hasRequiredPermissions(request.authUser.role, required)) {
          return reply.code(403).send({
            error: "Forbidden",
            code: "FORBIDDEN_PERMISSION"
          });
        }
      };
    });

    const incidentsRoutes = (await import("../src/routes/incidents.js")).default;
    await app.register(incidentsRoutes, { prefix: "/v1" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns tenant-scoped attention groups without alert dispatch side effects", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/incidents/attention-groups"
    });

    expect(response.statusCode).toBe(200);
    expect(getIncidentAttentionGroupsMock).toHaveBeenCalledWith({
      tenantId: "tenant-A"
    });
    expect(dispatchPendingAlertEventsMock).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      generatedAt: "2026-05-01T10:00:00.000Z",
      groups: [
        expect.objectContaining({
          id: "attn_123",
          attention: "elevated",
          incidentCount: 2
        })
      ],
      request_id: expect.any(String)
    });
    expect(response.body).not.toContain("secret");
    expect(response.body).not.toContain("api_key");
    expect(response.body).not.toContain("webhook");
    expect(response.body).not.toContain("email");
  });

  it("requires authenticated dashboard access", async () => {
    authMode = "unauthorized";

    const response = await app.inject({
      method: "GET",
      url: "/v1/incidents/attention-groups"
    });

    expect(response.statusCode).toBe(401);
    expect(getIncidentAttentionGroupsMock).not.toHaveBeenCalled();
  });

  it("requires incident read permission", async () => {
    permissionAllowed = false;

    const response = await app.inject({
      method: "GET",
      url: "/v1/incidents/attention-groups"
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: "FORBIDDEN_PERMISSION"
    });
    expect(getIncidentAttentionGroupsMock).not.toHaveBeenCalled();
  });

  it("rejects requests without tenant context", async () => {
    authMode = "missing_tenant";

    const response = await app.inject({
      method: "GET",
      url: "/v1/incidents/attention-groups"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: "Missing tenant context"
    });
    expect(getIncidentAttentionGroupsMock).not.toHaveBeenCalled();
  });
});
