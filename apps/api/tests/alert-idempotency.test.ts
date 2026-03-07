import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.fn();
const updateManyMock = vi.fn();
const updateMock = vi.fn();
const createMock = vi.fn();

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    incidentEvent: {
      findMany: findManyMock,
      updateMany: updateManyMock,
      update: updateMock,
      create: createMock
    }
  }
}));

vi.mock("../src/services/email-service.js", () => ({
  sendIncidentAlert: vi.fn()
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
});
