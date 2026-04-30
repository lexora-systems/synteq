import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasRequiredPermissions } from "../src/auth/permissions.js";

const listIncidentsMock = vi.fn();
const getIncidentByIdMock = vi.fn();
const listIncidentEventsMock = vi.fn();
const ackIncidentMock = vi.fn();
const resolveIncidentMock = vi.fn();
const generateIncidentGuidanceMock = vi.fn();
const getIncidentTimelineMock = vi.fn();

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

describe("incidents API timeline", () => {
  let app: ReturnType<typeof Fastify>;
  let role: "owner" | "admin" | "engineer" | "viewer";

  beforeEach(async () => {
    role = "viewer";
    listIncidentsMock.mockReset();
    getIncidentByIdMock.mockReset();
    listIncidentEventsMock.mockReset();
    ackIncidentMock.mockReset();
    resolveIncidentMock.mockReset();
    generateIncidentGuidanceMock.mockReset();
    getIncidentTimelineMock.mockReset();

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
    app.decorate("requirePermissions", (required: any[]) => {
      return async (request: any, reply: any) => {
        if (!request.authUser) {
          return reply.code(401).send({ error: "Unauthorized" });
        }
        if (!hasRequiredPermissions(request.authUser.role, required)) {
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

  it("returns a tenant-scoped timeline for an incident", async () => {
    getIncidentTimelineMock.mockResolvedValue({
      incident_id: "inc-1",
      entries: [
        {
          id: "incident:inc-1:created",
          at: "2026-04-30T10:00:00.000Z",
          type: "incident_created",
          title: "Incident opened",
          description: "Workflow failure",
          severity: "high",
          source: "generic_workflow_event_detection",
          workflow: "wf-1",
          environment: "prod",
          metadata: {
            fingerprint: "fp-1"
          }
        }
      ]
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/incidents/inc-1/timeline"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        incident_id: "inc-1",
        timeline: [
          expect.objectContaining({
            type: "incident_created",
            title: "Incident opened"
          })
        ],
        request_id: expect.any(String)
      })
    );
    expect(getIncidentTimelineMock).toHaveBeenCalledWith({
      tenantId: "tenant-A",
      incidentId: "inc-1"
    });
  });

  it("returns 404 when the timeline service cannot find the tenant incident", async () => {
    getIncidentTimelineMock.mockResolvedValue(null);

    const response = await app.inject({
      method: "GET",
      url: "/v1/incidents/inc-missing/timeline"
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("Incident not found");
  });
});
