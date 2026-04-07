import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.fn();
const updateManyMock = vi.fn();
const updateMock = vi.fn();
const createMock = vi.fn();
const userFindManyMock = vi.fn();
const getTenantEntitlementsMock = vi.fn();
const sendIncidentAlertMock = vi.fn();

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    incidentEvent: {
      findMany: findManyMock,
      updateMany: updateManyMock,
      update: updateMock,
      create: createMock
    },
    user: {
      findMany: userFindManyMock
    }
  }
}));

vi.mock("../src/services/email-service.js", () => ({
  sendIncidentAlert: sendIncidentAlertMock
}));

vi.mock("../src/services/tenant-trial-service.js", () => ({
  getTenantEntitlements: getTenantEntitlementsMock
}));

vi.mock("../src/config.js", () => ({
  config: {
    SLACK_DEFAULT_WEBHOOK_URL: "",
    ALERT_DISPATCH_MAX_RETRIES: 3,
    ALERT_DISPATCH_BACKOFF_BASE_SEC: 30
  }
}));

describe("alert dispatch idempotency", () => {
  beforeEach(() => {
    findManyMock.mockReset();
    updateManyMock.mockReset();
    updateMock.mockReset();
    createMock.mockReset();
    userFindManyMock.mockReset();
    getTenantEntitlementsMock.mockReset();
    sendIncidentAlertMock.mockReset();
    getTenantEntitlementsMock.mockResolvedValue({
      tenant_id: "tenant-A",
      current_plan: "pro",
      effective_plan: "pro",
      trial: {
        status: "none",
        available: false,
        active: false,
        consumed: false,
        started_at: null,
        ends_at: null,
        source: null,
        days_remaining: 0
      }
    });
    userFindManyMock.mockResolvedValue([
      {
        email: "owner@synteq.local"
      }
    ]);
    vi.resetModules();
  });

  it("allows only one worker to claim and send a pending alert event", async () => {
    let claimed = false;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ""
    });
    vi.stubGlobal("fetch", fetchMock);

    const pendingEvent = {
      id: 101,
      event_type: "ALERT_PENDING",
      payload_json: {},
      incident: {
        id: "inc-1",
        tenant_id: "tenant-A",
        severity: "high",
        summary: "Failure rate spike",
        workflow_id: "wf-1",
        environment: "prod",
        status: "open",
        details_json: {},
        sla_due_at: new Date(Date.now() + 300000),
        sla_breached_at: null,
        policy: {
          channels: [
            {
              channel: {
                id: "channel-1",
                type: "slack",
                is_enabled: true,
                config_json: {
                  webhook_url: "https://hooks.slack.test/abc"
                }
              }
            }
          ]
        }
      }
    };

    findManyMock.mockResolvedValue([pendingEvent]);
    updateManyMock.mockImplementation(async (args: { where: { id: number; event_type: string } }) => {
      if (args.where.id !== 101 || args.where.event_type !== "ALERT_PENDING") {
        return { count: 0 };
      }

      if (claimed) {
        return { count: 0 };
      }

      claimed = true;
      return { count: 1 };
    });
    updateMock.mockResolvedValue({});
    createMock.mockResolvedValue({});

    const { dispatchPendingAlertEvents } = await import("../src/services/alert-service.js");
    await Promise.all([dispatchPendingAlertEvents(10), dispatchPendingAlertEvents(10)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updateManyMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("sends basic email alerts for free tenants", async () => {
    getTenantEntitlementsMock.mockResolvedValueOnce({
      tenant_id: "tenant-A",
      current_plan: "free",
      effective_plan: "free",
      trial: {
        status: "none",
        available: false,
        active: false,
        consumed: false,
        started_at: null,
        ends_at: null,
        source: null,
        days_remaining: 0
      }
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ""
    });
    vi.stubGlobal("fetch", fetchMock);

    const pendingEvent = {
      id: 301,
      event_type: "ALERT_PENDING",
      payload_json: {},
      incident: {
        id: "inc-free-1",
        tenant_id: "tenant-A",
        severity: "medium",
        summary: "Retry storm",
        workflow_id: "wf-2",
        environment: "prod",
        status: "open",
        details_json: {},
        sla_due_at: new Date(Date.now() + 300000),
        sla_breached_at: null,
        policy: {
          channels: [
            {
              channel: {
                id: "channel-1",
                type: "slack",
                is_enabled: true,
                config_json: {
                  webhook_url: "https://hooks.slack.test/abc"
                }
              }
            }
          ]
        }
      }
    };

    findManyMock.mockResolvedValue([pendingEvent]);
    updateManyMock.mockResolvedValue({ count: 1 });
    createMock.mockResolvedValue({});

    const { dispatchPendingAlertEvents } = await import("../src/services/alert-service.js");
    await dispatchPendingAlertEvents(10);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendIncidentAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "owner@synteq.local",
        incidentId: "inc-free-1"
      })
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 301 },
        data: expect.objectContaining({
          event_type: "ALERT_SENT"
        })
      })
    );
  });

  it("processes bridge ALERT_PENDING events for free tenants without policy linkage", async () => {
    getTenantEntitlementsMock.mockResolvedValueOnce({
      tenant_id: "tenant-A",
      current_plan: "free",
      effective_plan: "free",
      trial: {
        status: "none",
        available: false,
        active: false,
        consumed: false,
        started_at: null,
        ends_at: null,
        source: null,
        days_remaining: 0
      }
    });

    const pendingEvent = {
      id: 401,
      event_type: "ALERT_PENDING",
      payload_json: {
        source: "operational_finding_bridge",
        reason: "bridge_opened"
      },
      incident: {
        id: "inc-bridge-1",
        tenant_id: "tenant-A",
        severity: "high",
        summary: "GitHub workflow failures burst",
        workflow_id: null,
        environment: null,
        status: "open",
        details_json: {
          source: "operational_finding_bridge"
        },
        sla_due_at: new Date(Date.now() + 300000),
        sla_breached_at: null,
        policy: null
      }
    };

    findManyMock.mockResolvedValue([pendingEvent]);
    updateManyMock.mockResolvedValue({ count: 1 });
    createMock.mockResolvedValue({});

    const { dispatchPendingAlertEvents } = await import("../src/services/alert-service.js");
    await dispatchPendingAlertEvents(10);

    expect(sendIncidentAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "owner@synteq.local",
        incidentId: "inc-bridge-1"
      })
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 401 },
        data: expect.objectContaining({
          event_type: "ALERT_SENT"
        })
      })
    );
  });
});
