import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasRequiredPermissions } from "../src/auth/permissions.js";

const listIncidentsMock = vi.fn();
const getIncidentByIdMock = vi.fn();
const listIncidentEventsMock = vi.fn();
const ackIncidentMock = vi.fn();
const resolveIncidentMock = vi.fn();
const generateIncidentGuidanceMock = vi.fn();

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

describe("incidents API guidance", () => {
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
    app.decorate("requireRoles", (allowedRoles: string[]) => {
      return async (request: any, reply: any) => {
        if (!request.authUser) {
          return reply.code(401).send({ error: "Unauthorized" });
        }
        if (!allowedRoles.includes(request.authUser.role)) {
          return reply.code(403).send({ error: "Forbidden" });
        }
      };
    });
    app.decorate("requirePermissions", (required: any[]) => {
      return async (request: any, reply: any) => {
        if (!request.authUser) {
          return reply.code(401).send({ error: "Unauthorized" });
        }
        if (!hasRequiredPermissions(request.authUser.role, required)) {
          return reply.code(403).send({ error: "Forbidden" });
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

  it("includes guidance in list responses and preserves tenant scoping", async () => {
    listIncidentsMock.mockResolvedValue({
      items: [
        {
          id: "inc-1",
          tenant_id: "tenant-A",
          workflow_id: "wf-1",
          environment: "prod",
          policy_id: "policy-1",
          status: "open",
          severity: "high",
          started_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          resolved_at: null,
          summary: "Retry storm",
          details_json: {}
        }
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false
    });
    generateIncidentGuidanceMock.mockResolvedValue({
      incident_type: "retry_storm",
      likely_causes: ["upstream dependency degradation"],
      business_impact: "delayed workflows",
      recommended_actions: ["increase backoff"],
      confidence: "high",
      evidence: ["metric=retry_rate"],
      generated_by: "rules_v1",
      summary_text: "A retry storm was detected."
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/incidents?page=1&page_size=25"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.incidents[0].guidance).toBeDefined();
    expect(body.incidents[0].guidance.incident_type).toBe("retry_storm");
    expect(listIncidentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-A"
      })
    );
  });

  it("returns guidance in incident detail responses", async () => {
    getIncidentByIdMock.mockResolvedValue({
      id: "inc-1",
      tenant_id: "tenant-A",
      workflow_id: "wf-1",
      environment: "prod",
      policy_id: "policy-1",
      status: "open",
      severity: "high",
      started_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      resolved_at: null,
      summary: "Duplicate webhook",
      details_json: {}
    });
    listIncidentEventsMock.mockResolvedValue([]);
    generateIncidentGuidanceMock.mockResolvedValue({
      incident_type: "duplicate_webhook",
      likely_causes: ["missing idempotency"],
      business_impact: "duplicate processing",
      recommended_actions: ["enforce idempotency key"],
      confidence: "high",
      evidence: ["metric=duplicate_rate"],
      generated_by: "rules_v1",
      summary_text: "Duplicate webhook activity was detected."
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/incidents/inc-1"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().incident.guidance.incident_type).toBe("duplicate_webhook");
  });

  it("allows viewers to read incidents because INCIDENTS_READ is granted", async () => {
    listIncidentsMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 25,
      has_next: false
    });
    generateIncidentGuidanceMock.mockResolvedValue({
      incident_type: "unknown",
      likely_causes: ["Unable to determine a dominant cause from current signals."],
      business_impact: "unknown",
      recommended_actions: ["inspect logs"],
      confidence: "low",
      evidence: [],
      generated_by: "rules_v1",
      summary_text: "An incident was detected."
    });

    role = "viewer";
    const response = await app.inject({
      method: "GET",
      url: "/v1/incidents"
    });

    expect(response.statusCode).toBe(200);
  });
});
