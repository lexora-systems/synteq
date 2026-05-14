import { describe, expect, it } from "vitest";
import {
  getReliabilityWindows,
  type ReliabilityWindowsClient
} from "../src/services/reliability-windows-service.js";

type OperationalEventRow = {
  id: string;
  tenant_id: string;
  source: string;
  event_type: string;
  system: string;
  environment: string | null;
  event_ts: Date;
  metadata_json: Record<string, unknown>;
};

const now = new Date("2026-05-01T10:00:00.000Z");

function minutesAgo(minutes: number) {
  return new Date(now.getTime() - minutes * 60_000);
}

function event(overrides: Partial<OperationalEventRow> = {}): OperationalEventRow {
  return {
    id: "evt-1",
    tenant_id: "tenant-A",
    source: "workflow",
    event_type: "workflow_execution_succeeded",
    system: "checkout-service",
    environment: "prod",
    event_ts: minutesAgo(5),
    metadata_json: {
      workflow_id: "wf-1",
      source_id: "src-1",
      source_key: "payments-daily",
      status: "succeeded"
    },
    ...overrides
  };
}

function matchesDateRange(value: Date, filter: unknown) {
  if (!filter || typeof filter !== "object") {
    return true;
  }
  const range = filter as { gte?: Date; lte?: Date };
  if (range.gte && value.getTime() < new Date(range.gte).getTime()) {
    return false;
  }
  if (range.lte && value.getTime() > new Date(range.lte).getTime()) {
    return false;
  }
  return true;
}

function createClient(events: OperationalEventRow[], observedArgs: unknown[] = []): ReliabilityWindowsClient {
  return {
    operationalEvent: {
      findMany: async (args) => {
        observedArgs.push(args);
        const where = args.where as { tenant_id?: string; event_ts?: unknown };
        return events
          .filter((row) => row.tenant_id === where.tenant_id && matchesDateRange(row.event_ts, where.event_ts))
          .sort((left, right) => {
            const timeDelta = right.event_ts.getTime() - left.event_ts.getTime();
            return timeDelta === 0 ? right.id.localeCompare(left.id) : timeDelta;
          })
          .map(({ id, source, event_type, system, environment, event_ts, metadata_json }) => ({
            id,
            source,
            event_type,
            system,
            environment,
            event_ts,
            metadata_json
          }));
      }
    }
  };
}

async function readReliability(events: OperationalEventRow[], input: Partial<Parameters<typeof getReliabilityWindows>[0]> = {}) {
  return getReliabilityWindows({
    tenantId: "tenant-A",
    now,
    client: createClient(events),
    ...input
  });
}

describe("reliability windows service", () => {
  it("keeps reads tenant-scoped and bounded to the seven-day window", async () => {
    const observedArgs: unknown[] = [];
    const result = await getReliabilityWindows({
      tenantId: "tenant-A",
      now,
      client: createClient(
        [
          event({ id: "evt-recent", event_ts: minutesAgo(30) }),
          event({
            id: "evt-other-tenant",
            tenant_id: "tenant-B",
            event_ts: minutesAgo(10),
            event_type: "workflow_execution_failed",
            metadata_json: { status: "failed", secret: "other-tenant-secret" }
          }),
          event({
            id: "evt-old",
            event_ts: minutesAgo(8 * 24 * 60),
            event_type: "workflow_execution_failed",
            metadata_json: { status: "failed" }
          })
        ],
        observedArgs
      )
    });

    expect(result.windows.find((window) => window.label === "7d")).toMatchObject({
      total: 1,
      succeeded: 1,
      failed: 0
    });
    expect(JSON.stringify(result)).not.toContain("other-tenant-secret");
    expect(observedArgs[0]).toMatchObject({
      where: {
        tenant_id: "tenant-A",
        event_ts: {
          gte: new Date("2026-04-24T10:00:00.000Z"),
          lte: now
        }
      }
    });
  });

  it("calculates one-hour, twenty-four-hour, and seven-day windows", async () => {
    const result = await readReliability([
      event({ id: "evt-30m", event_ts: minutesAgo(30) }),
      event({
        id: "evt-2h",
        event_ts: minutesAgo(120),
        event_type: "workflow_execution_failed",
        metadata_json: { status: "failed" }
      }),
      event({
        id: "evt-2d",
        event_ts: minutesAgo(2 * 24 * 60),
        event_type: "workflow_execution_timed_out",
        metadata_json: { status: "timed_out" }
      })
    ]);

    expect(result.windows.find((window) => window.label === "1h")).toMatchObject({
      startAt: "2026-05-01T09:00:00.000Z",
      endAt: "2026-05-01T10:00:00.000Z",
      total: 1,
      succeeded: 1,
      state: "healthy"
    });
    expect(result.windows.find((window) => window.label === "24h")).toMatchObject({
      total: 2,
      succeeded: 1,
      failed: 1
    });
    expect(result.windows.find((window) => window.label === "7d")).toMatchObject({
      total: 3,
      succeeded: 1,
      failed: 1,
      timedOut: 1,
      lastSignalAt: "2026-05-01T09:30:00.000Z"
    });
  });

  it("normalizes success, failure, timeout, and unknown statuses", async () => {
    const result = await readReliability([
      event({ id: "evt-success", event_type: "workflow_execution_succeeded" }),
      event({ id: "evt-status-success", event_type: "custom", metadata_json: { status: "success" } }),
      event({ id: "evt-completed", event_type: "custom", metadata_json: { conclusion: "completed" } }),
      event({ id: "evt-error", event_type: "custom", metadata_json: { outcome: "error" } }),
      event({ id: "evt-timeout", event_type: "workflow_execution_timed_out" }),
      event({ id: "evt-unknown", event_type: "workflow_execution_started", metadata_json: { status: "started" } })
    ]);

    expect(result.windows.find((window) => window.label === "1h")).toMatchObject({
      total: 6,
      succeeded: 3,
      failed: 1,
      timedOut: 1,
      unknown: 1,
      successRate: 0.5,
      failureRate: 0.1667,
      timeoutRate: 0.1667
    });
  });

  it("returns unknown state and null rates when no events exist", async () => {
    const result = await readReliability([]);

    expect(result.windows).toEqual([
      expect.objectContaining({
        label: "1h",
        total: 0,
        successRate: null,
        failureRate: null,
        timeoutRate: null,
        lastSignalAt: null,
        state: "unknown"
      }),
      expect.objectContaining({
        label: "24h",
        total: 0,
        state: "unknown"
      }),
      expect.objectContaining({
        label: "7d",
        total: 0,
        state: "unknown"
      })
    ]);
  });

  it("marks windows healthy when all matching events succeeded", async () => {
    const result = await readReliability([
      event({ id: "evt-1", event_ts: minutesAgo(5) }),
      event({ id: "evt-2", event_ts: minutesAgo(20), event_type: "workflow_completed", metadata_json: { status: "completed" } })
    ]);

    expect(result.windows.find((window) => window.label === "1h")).toMatchObject({
      total: 2,
      failed: 0,
      timedOut: 0,
      state: "healthy"
    });
  });

  it("marks windows degraded when failures exist below the failing threshold", async () => {
    const events = Array.from({ length: 10 }, (_, index) =>
      event({
        id: `evt-${index}`,
        event_type: index === 0 ? "workflow_execution_failed" : "workflow_execution_succeeded",
        metadata_json: {
          status: index === 0 ? "failed" : "succeeded"
        }
      })
    );

    const result = await readReliability(events);

    expect(result.windows.find((window) => window.label === "1h")).toMatchObject({
      total: 10,
      failed: 1,
      failureRate: 0.1,
      state: "degraded"
    });
  });

  it("marks windows failing when failures and timeouts meet the threshold", async () => {
    const result = await readReliability([
      event({ id: "evt-1" }),
      event({ id: "evt-2" }),
      event({ id: "evt-3" }),
      event({ id: "evt-4" }),
      event({
        id: "evt-timeout",
        event_type: "workflow_execution_timed_out",
        metadata_json: { status: "timed_out" }
      })
    ]);

    expect(result.windows.find((window) => window.label === "1h")).toMatchObject({
      total: 5,
      timedOut: 1,
      timeoutRate: 0.2,
      state: "failing"
    });
  });

  it("filters by workflow, source id, and source key when requested", async () => {
    const result = await readReliability(
      [
        event({
          id: "evt-match",
          metadata_json: {
            workflow_id: "wf-1",
            source_id: "src-1",
            source_key: "payments-daily",
            status: "succeeded"
          }
        }),
        event({
          id: "evt-other-source",
          metadata_json: {
            workflow_id: "wf-2",
            source_id: "src-2",
            source_key: "refunds-daily",
            status: "failed"
          },
          event_type: "workflow_execution_failed"
        })
      ],
      {
        workflowId: "wf-1",
        sourceId: "src-1",
        sourceKey: "payments-daily"
      }
    );

    expect(result.scope).toMatchObject({
      tenantId: "tenant-A",
      workflowId: "wf-1",
      sourceId: "src-1",
      sourceKey: "payments-daily"
    });
    expect(result.windows.find((window) => window.label === "1h")).toMatchObject({
      total: 1,
      succeeded: 1,
      failed: 0
    });
  });

  it("matches workflow filters against source identifiers used by generic workflow events", async () => {
    const result = await readReliability(
      [
        event({
          id: "evt-generic-workflow",
          metadata_json: {
            workflow_id: "external-payments-name",
            source_id: "wf-1",
            source_key: "payments-daily",
            status: "succeeded"
          }
        })
      ],
      {
        workflowId: "wf-1"
      }
    );

    expect(result.windows.find((window) => window.label === "1h")).toMatchObject({
      total: 1,
      succeeded: 1
    });
  });

  it("includes GoHighLevel webhook provider metadata in generic workflow reliability windows", async () => {
    const result = await readReliability([
      event({
        id: "evt-ghl-success",
        source: "webhook",
        event_type: "workflow_execution_succeeded",
        system: "webhook:ghl-workflow-1",
        metadata_json: {
          provider: "webhook",
          source_type: "webhook",
          workflow_id: "ghl-workflow-1",
          source_key: "webhook-ghl-production",
          status: "succeeded",
          metadata: {
            provider: "gohighlevel",
            adapter_version: "ghl_webhook_v1"
          }
        }
      }),
      event({
        id: "evt-ghl-timeout",
        source: "webhook",
        event_type: "workflow_execution_timed_out",
        system: "webhook:ghl-workflow-1",
        metadata_json: {
          provider: "webhook",
          source_type: "webhook",
          workflow_id: "ghl-workflow-1",
          source_key: "webhook-ghl-production",
          status: "timed_out",
          metadata: {
            provider: "gohighlevel",
            adapter_version: "ghl_webhook_v1"
          }
        }
      })
    ]);

    expect(result.windows.find((window) => window.label === "1h")).toMatchObject({
      total: 2,
      succeeded: 1,
      timedOut: 1
    });
  });

  it("does not return raw metadata or sensitive operational payload fields", async () => {
    const result = await readReliability([
      event({
        metadata_json: {
          status: "succeeded",
          api_key: "synteq_secret_api_key",
          token: "secret-token",
          webhook_url: "https://hooks.example.invalid/sensitive",
          raw_payload: {
            authorization: "Bearer secret"
          }
        }
      })
    ]);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("synteq_secret_api_key");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("hooks.example.invalid");
    expect(serialized).not.toContain("raw_payload");
    expect(serialized).not.toContain("authorization");
  });
});
