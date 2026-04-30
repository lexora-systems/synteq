import { beforeEach, describe, expect, it, vi } from "vitest";

const incidentFindFirstMock = vi.fn();
const incidentEventFindManyMock = vi.fn();
const findingIncidentLinkFindManyMock = vi.fn();

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    incident: {
      findFirst: incidentFindFirstMock
    },
    incidentEvent: {
      findMany: incidentEventFindManyMock
    },
    findingIncidentLink: {
      findMany: findingIncidentLinkFindManyMock
    }
  }
}));

function baseIncident(overrides: Record<string, unknown> = {}) {
  return {
    id: "inc-1",
    tenant_id: "tenant-A",
    policy_id: "policy-1",
    workflow_id: "wf-1",
    environment: "prod",
    status: "open",
    severity: "high",
    started_at: new Date("2026-04-30T10:00:00.000Z"),
    last_seen_at: new Date("2026-04-30T10:05:00.000Z"),
    resolved_at: null,
    sla_due_at: new Date("2026-04-30T11:00:00.000Z"),
    sla_breached_at: null,
    fingerprint: "fp-1",
    summary: "Workflow failure",
    details_json: {
      source: "generic_workflow_event_detection",
      workflowId: "wf-1",
      api_key: "do-not-return"
    },
    created_at: new Date("2026-04-30T10:00:00.000Z"),
    ...overrides
  };
}

function eventRow(overrides: Record<string, unknown>) {
  return {
    id: 1,
    incident_id: "inc-1",
    event_type: "ACKED",
    payload_json: {},
    at_time: new Date("2026-04-30T10:01:00.000Z"),
    ...overrides
  };
}

async function getTimeline(input = { tenantId: "tenant-A", incidentId: "inc-1" }) {
  const { getIncidentTimeline } = await import("../src/services/incident-timeline-service.js");
  return getIncidentTimeline(input);
}

describe("incident timeline service", () => {
  beforeEach(() => {
    vi.resetModules();
    incidentFindFirstMock.mockReset();
    incidentEventFindManyMock.mockReset();
    findingIncidentLinkFindManyMock.mockReset();
    incidentFindFirstMock.mockResolvedValue(baseIncident());
    incidentEventFindManyMock.mockResolvedValue([]);
    findingIncidentLinkFindManyMock.mockResolvedValue([]);
  });

  it("loads incidents with tenant scoping and returns null for missing incidents", async () => {
    incidentFindFirstMock.mockResolvedValueOnce(null);

    const result = await getTimeline({
      tenantId: "tenant-B",
      incidentId: "inc-1"
    });

    expect(result).toBeNull();
    expect(incidentFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "inc-1",
        tenant_id: "tenant-B"
      }
    });
    expect(incidentEventFindManyMock).not.toHaveBeenCalled();
  });

  it("orders entries chronologically using payload timestamps before event fallback time", async () => {
    incidentEventFindManyMock.mockResolvedValue([
      eventRow({
        id: 2,
        event_type: "ACKED",
        payload_json: {},
        at_time: new Date("2026-04-30T10:03:00.000Z")
      }),
      eventRow({
        id: 3,
        event_type: "ALERT_PENDING",
        payload_json: {
          at: "2026-04-30T10:01:00.000Z"
        },
        at_time: new Date("2026-04-30T10:04:00.000Z")
      }),
      eventRow({
        id: 4,
        event_type: "ALERT_SENT",
        payload_json: {
          eventTime: "2026-04-30T10:02:00.000Z"
        },
        at_time: new Date("2026-04-30T10:05:00.000Z")
      })
    ]);

    const result = await getTimeline();

    expect(result?.entries.map((entry) => entry.type)).toEqual([
      "incident_created",
      "alert_pending",
      "alert_sent",
      "incident_acknowledged"
    ]);
    expect(result?.entries.map((entry) => entry.at)).toEqual([
      "2026-04-30T10:00:00.000Z",
      "2026-04-30T10:01:00.000Z",
      "2026-04-30T10:02:00.000Z",
      "2026-04-30T10:03:00.000Z"
    ]);
  });

  it("maps acknowledge, resolve, and alert lifecycle events", async () => {
    incidentEventFindManyMock.mockResolvedValue([
      eventRow({
        id: 10,
        event_type: "ACKED",
        payload_json: {
          previous_status: "open",
          updated_status: "acked"
        }
      }),
      eventRow({
        id: 11,
        event_type: "RESOLVED_MANUAL",
        payload_json: {
          previous_status: "acked",
          updated_status: "resolved"
        },
        at_time: new Date("2026-04-30T10:02:00.000Z")
      }),
      eventRow({
        id: 12,
        event_type: "ALERT_PENDING",
        payload_json: {},
        at_time: new Date("2026-04-30T10:03:00.000Z")
      }),
      eventRow({
        id: 13,
        event_type: "ALERT_SENT",
        payload_json: {},
        at_time: new Date("2026-04-30T10:04:00.000Z")
      }),
      eventRow({
        id: 14,
        event_type: "ALERT_FAILED",
        payload_json: {},
        at_time: new Date("2026-04-30T10:05:00.000Z")
      })
    ]);

    const result = await getTimeline();

    expect(result?.entries.map((entry) => entry.type)).toEqual([
      "incident_created",
      "incident_acknowledged",
      "incident_resolved",
      "alert_pending",
      "alert_sent",
      "alert_failed"
    ]);
  });

  it("handles unknown event types safely and strips sensitive metadata", async () => {
    incidentEventFindManyMock.mockResolvedValue([
      eventRow({
        id: 20,
        event_type: "CUSTOM_PROVIDER_EVENT",
        payload_json: {
          source: "webhook",
          visible: "keep-me",
          webhook_secret: "super-secret",
          nested: {
            api_key: "nested-secret",
            safe: "nested-visible"
          }
        }
      })
    ]);

    const result = await getTimeline();
    const unknown = result?.entries.find((entry) => entry.id === "incident_event:20");

    expect(unknown?.type).toBe("unknown_event");
    expect(unknown?.title).toBe("Timeline event");
    expect(unknown?.metadata?.visible).toBe("keep-me");

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("nested-secret");
    expect(serialized).not.toContain("do-not-return");
  });

  it("adds compact finding link evidence when a linked finding exists", async () => {
    findingIncidentLinkFindManyMock.mockResolvedValue([
      {
        id: 1,
        tenant_id: "tenant-A",
        finding_id: "finding-1",
        incident_id: "inc-1",
        bridge_key: "bridge-1",
        last_bridged_at: new Date("2026-04-30T10:02:00.000Z"),
        created_at: new Date("2026-04-30T10:02:00.000Z"),
        updated_at: new Date("2026-04-30T10:02:00.000Z"),
        finding: {
          id: "finding-1",
          tenant_id: "tenant-A",
          source: "github_actions",
          rule_key: "github.workflow_failed",
          severity: "high",
          status: "open",
          system: "repo/.github/workflows/deploy.yml",
          correlation_key: "run-1",
          fingerprint: "finding-fp",
          summary: "GitHub workflow failures repeatedly occurred",
          evidence_json: {
            observed: 3,
            secret_token: "finding-secret"
          },
          first_seen_at: new Date("2026-04-30T09:59:00.000Z"),
          last_seen_at: new Date("2026-04-30T10:01:00.000Z"),
          resolved_at: null,
          event_count: 3,
          created_at: new Date("2026-04-30T09:59:00.000Z"),
          updated_at: new Date("2026-04-30T10:01:00.000Z")
        }
      }
    ]);

    const result = await getTimeline();
    const finding = result?.entries.find((entry) => entry.type === "finding_linked");

    expect(finding?.title).toBe("Operational finding linked");
    expect(finding?.source).toBe("github_actions");
    expect(finding?.metadata?.rule_key).toBe("github.workflow_failed");
    expect(JSON.stringify(result)).not.toContain("finding-secret");
  });
});
