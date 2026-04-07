import { beforeEach, describe, expect, it, vi } from "vitest";

const incidentFindFirstMock = vi.fn();
const incidentCreateMock = vi.fn();
const incidentUpdateMock = vi.fn();
const incidentEventCreateMock = vi.fn();
const incidentEventCreateManyMock = vi.fn();

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    incident: {
      findFirst: incidentFindFirstMock,
      create: incidentCreateMock,
      update: incidentUpdateMock
    },
    incidentEvent: {
      create: incidentEventCreateMock,
      createMany: incidentEventCreateManyMock
    }
  }
}));

describe("incidents service bridge alert handoff", () => {
  beforeEach(() => {
    vi.resetModules();
    incidentFindFirstMock.mockReset();
    incidentCreateMock.mockReset();
    incidentUpdateMock.mockReset();
    incidentEventCreateMock.mockReset();
    incidentEventCreateManyMock.mockReset();
  });

  it("enqueues ALERT_PENDING when bridge opens a new incident", async () => {
    incidentFindFirstMock.mockResolvedValueOnce(null);
    incidentCreateMock.mockResolvedValueOnce({
      id: "inc-bridge-open",
      tenant_id: "tenant-A",
      status: "open",
      severity: "high",
      started_at: new Date("2026-03-17T10:00:00.000Z")
    });
    incidentEventCreateManyMock.mockResolvedValueOnce({ count: 2 });

    const { openOrRefreshBridgeIncident } = await import("../src/services/incidents-service.js");
    const result = await openOrRefreshBridgeIncident({
      tenantId: "tenant-A",
      severity: "high",
      summary: "Bridge summary",
      fingerprint: "bridge-fp-1",
      details: {
        source: "operational_finding_bridge"
      },
      lastSeenAt: new Date("2026-03-17T10:05:00.000Z")
    });

    expect(result.action).toBe("created");
    expect(incidentEventCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            incident_id: "inc-bridge-open",
            event_type: "BRIDGE_OPENED"
          }),
          expect.objectContaining({
            incident_id: "inc-bridge-open",
            event_type: "ALERT_PENDING"
          })
        ])
      })
    );
  });

  it("enqueues ALERT_PENDING when bridge reopens a resolved incident", async () => {
    incidentFindFirstMock.mockResolvedValueOnce({
      id: "inc-bridge-reopen",
      tenant_id: "tenant-A",
      status: "resolved",
      severity: "high",
      started_at: new Date("2026-03-17T09:00:00.000Z"),
      details_json: {}
    });
    incidentUpdateMock.mockResolvedValueOnce({
      id: "inc-bridge-reopen",
      tenant_id: "tenant-A",
      status: "open",
      severity: "high",
      started_at: new Date("2026-03-17T10:00:00.000Z")
    });
    incidentEventCreateManyMock.mockResolvedValueOnce({ count: 2 });

    const { openOrRefreshBridgeIncident } = await import("../src/services/incidents-service.js");
    const result = await openOrRefreshBridgeIncident({
      tenantId: "tenant-A",
      incidentId: "inc-bridge-reopen",
      severity: "high",
      summary: "Bridge summary reopen",
      fingerprint: "bridge-fp-2",
      details: {
        source: "operational_finding_bridge"
      },
      lastSeenAt: new Date("2026-03-17T10:05:00.000Z")
    });

    expect(result.action).toBe("reopened");
    expect(incidentEventCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            incident_id: "inc-bridge-reopen",
            event_type: "BRIDGE_REOPENED"
          }),
          expect.objectContaining({
            incident_id: "inc-bridge-reopen",
            event_type: "ALERT_PENDING"
          })
        ])
      })
    );
  });

  it("does not enqueue ALERT_PENDING on bridge refresh of an already-open incident", async () => {
    incidentFindFirstMock.mockResolvedValueOnce({
      id: "inc-bridge-refresh",
      tenant_id: "tenant-A",
      status: "open",
      severity: "medium",
      started_at: new Date("2026-03-17T09:00:00.000Z"),
      details_json: {}
    });
    incidentUpdateMock.mockResolvedValueOnce({
      id: "inc-bridge-refresh",
      tenant_id: "tenant-A",
      status: "open",
      severity: "medium",
      started_at: new Date("2026-03-17T09:00:00.000Z")
    });
    incidentEventCreateMock.mockResolvedValueOnce({});

    const { openOrRefreshBridgeIncident } = await import("../src/services/incidents-service.js");
    const result = await openOrRefreshBridgeIncident({
      tenantId: "tenant-A",
      incidentId: "inc-bridge-refresh",
      severity: "medium",
      summary: "Bridge summary refresh",
      fingerprint: "bridge-fp-3",
      details: {
        source: "operational_finding_bridge"
      },
      lastSeenAt: new Date("2026-03-17T10:05:00.000Z")
    });

    expect(result.action).toBe("updated");
    expect(incidentEventCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incident_id: "inc-bridge-refresh",
          event_type: "BRIDGE_REFRESHED"
        })
      })
    );
    expect(incidentEventCreateManyMock).not.toHaveBeenCalled();
  });
});
