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
    const rawEvents = [
      {
        id: 10,
        incident_id: "inc-1",
        event_type: "ALERT_FAILED",
        at_time: new Date("2026-05-01T09:58:00.000Z"),
        payload_json: {
          source: "generic_workflow_event_detection",
          metric: "failure_rate",
          severity: "high",
          webhook_secret: "do-not-return",
          api_key: "do-not-return",
          authorization: "Bearer hidden",
          channel: "ops-email",
          payload: {
            raw: true
          },
          email: "ops@example.com",
          url: "https://hooks.example.test/secret"
        }
      },
      {
        id: 11,
        incident_id: "inc-1",
        event_type: "DETECTED",
        at_time: new Date("2026-05-01T09:57:00.000Z"),
        payload_json: {
          metric: "duplicate_rate",
          workflowId: "wf-1",
          env: "prod"
        }
      }
    ];
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
    listIncidentEventsMock.mockResolvedValue(rawEvents);
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
    const body = response.json();
    expect(body.incident.guidance.incident_type).toBe("duplicate_webhook");
    expect(body.recent_events).toEqual([
      {
        id: "10",
        event_type: "ALERT_FAILED",
        at_time: "2026-05-01T09:58:00.000Z",
        summary: "Alert dispatch failed.",
        metadata: {
          source: "generic_workflow_event_detection",
          metric: "failure_rate",
          severity: "high"
        }
      },
      {
        id: "11",
        event_type: "DETECTED",
        at_time: "2026-05-01T09:57:00.000Z",
        summary: "Detection condition was observed again. Metric: duplicate_rate.",
        metadata: {
          metric: "duplicate_rate",
          workflow: "wf-1",
          environment: "prod"
        }
      }
    ]);
    expect(body.recent_events[0]).not.toHaveProperty("payload_json");
    expect(JSON.stringify(body)).not.toContain("do-not-return");
    expect(JSON.stringify(body)).not.toContain("webhook_secret");
    expect(JSON.stringify(body)).not.toContain("api_key");
    expect(JSON.stringify(body)).not.toContain("authorization");
    expect(JSON.stringify(body)).not.toContain("ops@example.com");
    expect(JSON.stringify(body)).not.toContain("hooks.example");
    expect(getIncidentByIdMock).toHaveBeenCalledWith("tenant-A", "inc-1");
    expect(listIncidentEventsMock).toHaveBeenCalledWith("inc-1", 20);
    expect(generateIncidentGuidanceMock).toHaveBeenCalledWith({
      incident: expect.objectContaining({
        id: "inc-1"
      }),
      recentEvents: rawEvents
    });
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
