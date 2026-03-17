import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

type LedgerStatus = "processing" | "completed" | "failed";

type LedgerRow = {
  id: string;
  tenant_id: string;
  source: string;
  idempotency_key: string;
  status: LedgerStatus;
  first_seen_at: Date;
  last_seen_at: Date;
  completed_at: Date | null;
  lock_expires_at: Date | null;
  error_code: string | null;
  error_message: string | null;
  operational_event_id: string | null;
  seen_count: number;
  attempt_count: number;
  created_at: Date;
  updated_at: Date;
};

type EventRow = {
  id: string;
  tenant_id: string;
  source: string;
  event_type: string;
  service: string | null;
  system: string;
  environment: string | null;
  event_ts: Date;
  severity: "warn" | "low" | "medium" | "high" | "critical" | null;
  correlation_key: string | null;
  metadata_json: Record<string, unknown>;
  request_id: string;
  api_key_id: string | null;
  created_at: Date;
};

function makeStatefulPrismaMock() {
  const state = {
    events: [] as EventRow[],
    ledger: new Map<string, LedgerRow>(),
    nextEventId: 1,
    nextLedgerId: 1,
    failNextEventCreate: false
  };

  const uniqueKey = (tenantId: string, source: string, idempotencyKey: string) =>
    `${tenantId}::${source}::${idempotencyKey}`;

  const getUniqueKeyFromWhere = (where: any) =>
    uniqueKey(
      where.tenant_id_source_idempotency_key.tenant_id,
      where.tenant_id_source_idempotency_key.source,
      where.tenant_id_source_idempotency_key.idempotency_key
    );

  const applyUpdateData = (row: LedgerRow, data: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(data)) {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        "increment" in (value as Record<string, unknown>)
      ) {
        const incrementBy = Number((value as { increment: number }).increment);
        const current = Number((row as Record<string, unknown>)[key] ?? 0);
        (row as Record<string, unknown>)[key] = current + incrementBy;
        continue;
      }
      (row as Record<string, unknown>)[key] = value as unknown;
    }
    row.updated_at = new Date();
  };

  const whereMatches = (row: LedgerRow, where: Record<string, unknown>): boolean => {
    for (const [key, value] of Object.entries(where)) {
      if (key === "OR") {
        const branches = value as Array<Record<string, unknown>>;
        if (!branches.some((branch) => whereMatches(row, branch))) {
          return false;
        }
        continue;
      }

      if (key === "tenant_id" || key === "source" || key === "idempotency_key" || key === "status") {
        if ((row as Record<string, unknown>)[key] !== value) {
          return false;
        }
        continue;
      }

      if (key === "lock_expires_at") {
        if (value === null) {
          if (row.lock_expires_at !== null) {
            return false;
          }
          continue;
        }

        const filter = value as { lte?: Date };
        if (filter && typeof filter === "object" && Object.prototype.hasOwnProperty.call(filter, "lte")) {
          const current = row.lock_expires_at;
          if (!current || current.getTime() > new Date(filter.lte as Date).getTime()) {
            return false;
          }
        }
        continue;
      }
    }
    return true;
  };

  const updateLedgerByUnique = (args: any) => {
    const key = getUniqueKeyFromWhere(args.where);
    const row = state.ledger.get(key);
    if (!row) {
      throw new Error("Ledger entry not found");
    }
    applyUpdateData(row, args.data);
    return { ...row };
  };

  const prisma = {
    eventIdempotencyLedger: {
      create: async (args: any) => {
        const data = args.data;
        const key = uniqueKey(data.tenant_id, data.source, data.idempotency_key);
        if (state.ledger.has(key)) {
          throw new Error("Unique constraint violation");
        }
        const now = new Date();
        const row: LedgerRow = {
          id: `ledger-${state.nextLedgerId++}`,
          tenant_id: data.tenant_id,
          source: data.source,
          idempotency_key: data.idempotency_key,
          status: data.status,
          first_seen_at: data.first_seen_at ?? now,
          last_seen_at: data.last_seen_at ?? now,
          completed_at: data.completed_at ?? null,
          lock_expires_at: data.lock_expires_at ?? null,
          error_code: data.error_code ?? null,
          error_message: data.error_message ?? null,
          operational_event_id: data.operational_event_id ?? null,
          seen_count: data.seen_count ?? 1,
          attempt_count: data.attempt_count ?? 1,
          created_at: now,
          updated_at: now
        };
        state.ledger.set(key, row);
        return { ...row };
      },
      findUnique: async (args: any) => {
        const key = getUniqueKeyFromWhere(args.where);
        const row = state.ledger.get(key);
        return row ? { ...row } : null;
      },
      update: async (args: any) => updateLedgerByUnique(args),
      updateMany: async (args: any) => {
        let count = 0;
        for (const row of state.ledger.values()) {
          if (whereMatches(row, args.where)) {
            applyUpdateData(row, args.data);
            count += 1;
          }
        }
        return { count };
      }
    },
    $transaction: async (cb: (tx: any) => Promise<any>) => {
      const tx = {
        operationalEvent: {
          create: async (args: any) => {
            if (state.failNextEventCreate) {
              state.failNextEventCreate = false;
              throw new Error("simulated_persist_failure");
            }
            const data = args.data;
            const row: EventRow = {
              id: `evt-${state.nextEventId++}`,
              tenant_id: data.tenant_id,
              source: data.source,
              event_type: data.event_type,
              service: data.service ?? null,
              system: data.system,
              environment: data.environment ?? null,
              event_ts: new Date(data.event_ts),
              severity: data.severity ?? null,
              correlation_key: data.correlation_key ?? null,
              metadata_json: (data.metadata_json ?? {}) as Record<string, unknown>,
              request_id: data.request_id,
              api_key_id: data.api_key_id ?? null,
              created_at: new Date()
            };
            state.events.push(row);
            return { id: row.id };
          }
        },
        eventIdempotencyLedger: {
          update: async (args: any) => updateLedgerByUnique(args)
        }
      };
      return cb(tx);
    }
  };

  return { state, prisma, uniqueKey };
}

async function setupHarness() {
  vi.resetModules();
  const { state, prisma, uniqueKey } = makeStatefulPrismaMock();
  const metricsIncrement = vi.fn();
  const handoffMock = vi.fn(async (input: { events: unknown[] }) => ({
    mode: "operational_events_table" as const,
    queued: input.events.length,
    next_stage: "pending_worker" as const
  }));

  vi.doMock("../src/lib/prisma.js", () => ({ prisma }));
  vi.doMock("../src/lib/runtime-metrics.js", () => ({
    runtimeMetrics: {
      increment: metricsIncrement
    }
  }));
  vi.doMock("../src/services/operational-event-analysis-hook-service.js", () => ({
    handoffOperationalEventsForAnalysis: handoffMock
  }));

  const ingestionModule = await import("../src/services/operational-event-ingestion-service.js");
  const idempotencyModule = await import("../src/services/event-idempotency-service.js");

  return {
    state,
    uniqueKey,
    ingestOperationalEvents: ingestionModule.ingestOperationalEvents,
    normalizeOperationalEvent: ingestionModule.normalizeOperationalEvent,
    buildOperationalEventIdempotencyKey: idempotencyModule.buildOperationalEventIdempotencyKey,
    reserveEventIdempotency: idempotencyModule.reserveEventIdempotency
  };
}

const baseEvent = {
  source: "github_actions",
  event_type: "workflow_failed",
  system: "acme/payments",
  timestamp: new Date("2026-03-17T10:00:00.000Z"),
  correlation_key: "run-101",
  metadata: {
    repository: "acme/payments"
  }
};

describe("operational event idempotency ledger integration", () => {
  it("does not create a second operational_event for duplicate normalized ingestion", async () => {
    const harness = await setupHarness();

    const first = await harness.ingestOperationalEvents(
      { events: [baseEvent] },
      { tenantId: "tenant-A", requestId: "req-1" }
    );
    const second = await harness.ingestOperationalEvents(
      { events: [baseEvent] },
      { tenantId: "tenant-A", requestId: "req-2" }
    );

    expect(first.ingested).toBe(1);
    expect(second.duplicates).toBe(1);
    expect(second.ingested).toBe(0);
    expect(harness.state.events).toHaveLength(1);
  });

  it("deduplicates repeated github delivery keys durably", async () => {
    const harness = await setupHarness();
    const idempotencyHints = [{ namespace: "github_delivery", upstreamKey: "gh-int-1:delivery-1:0" }];

    const first = await harness.ingestOperationalEvents(
      { events: [baseEvent] },
      { tenantId: "tenant-A", requestId: "req-gh-1", idempotencyHints }
    );
    const second = await harness.ingestOperationalEvents(
      { events: [baseEvent] },
      { tenantId: "tenant-A", requestId: "req-gh-2", idempotencyHints }
    );

    expect(first.ingested).toBe(1);
    expect(second.duplicates).toBe(1);
    expect(harness.state.events).toHaveLength(1);
  });

  it("handles mixed new and duplicate events in one batch", async () => {
    const harness = await setupHarness();
    await harness.ingestOperationalEvents({ events: [baseEvent] }, { tenantId: "tenant-A", requestId: "seed-1" });

    const result = await harness.ingestOperationalEvents(
      {
        events: [
          baseEvent,
          {
            ...baseEvent,
            correlation_key: "run-102",
            timestamp: new Date("2026-03-17T10:01:00.000Z")
          }
        ]
      },
      { tenantId: "tenant-A", requestId: "batch-1" }
    );

    expect(result.accepted).toBe(2);
    expect(result.ingested).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(result.failed).toBe(0);
    expect(harness.state.events).toHaveLength(2);
  });

  it("marks failed ledger entries and allows safe retry to complete", async () => {
    const harness = await setupHarness();
    harness.state.failNextEventCreate = true;

    const first = await harness.ingestOperationalEvents(
      { events: [baseEvent] },
      { tenantId: "tenant-A", requestId: "req-fail-1" }
    );

    const onlyEntryAfterFailure = [...harness.state.ledger.values()][0];
    expect(first.failed).toBe(1);
    expect(first.ingested).toBe(0);
    expect(onlyEntryAfterFailure.status).toBe("failed");

    const second = await harness.ingestOperationalEvents(
      { events: [baseEvent] },
      { tenantId: "tenant-A", requestId: "req-fail-2" }
    );

    const onlyEntryAfterRetry = [...harness.state.ledger.values()][0];
    expect(second.ingested).toBe(1);
    expect(second.failed).toBe(0);
    expect(harness.state.events).toHaveLength(1);
    expect(onlyEntryAfterRetry.status).toBe("completed");
    expect(onlyEntryAfterRetry.attempt_count).toBe(2);
  });

  it("skips in-flight processing and recovers stale processing entries", async () => {
    const harness = await setupHarness();
    const normalized = harness.normalizeOperationalEvent(baseEvent as any);
    const idempotencyKey = harness.buildOperationalEventIdempotencyKey({
      tenantId: "tenant-A",
      source: normalized.source,
      event: normalized
    });

    await harness.reserveEventIdempotency({
      tenantId: "tenant-A",
      source: normalized.source,
      idempotencyKey,
      now: new Date(Date.now() + 60 * 60 * 1000)
    });

    const inFlight = await harness.ingestOperationalEvents(
      { events: [baseEvent] },
      { tenantId: "tenant-A", requestId: "req-inflight-1" }
    );

    expect(inFlight.skipped).toBe(1);
    expect(inFlight.ingested).toBe(0);
    expect(harness.state.events).toHaveLength(0);

    const stored = harness.state.ledger.get(harness.uniqueKey("tenant-A", normalized.source, idempotencyKey));
    if (!stored) {
      throw new Error("Expected reserved ledger row");
    }
    stored.lock_expires_at = new Date(Date.now() - 60_000);

    const recovered = await harness.ingestOperationalEvents(
      { events: [baseEvent] },
      { tenantId: "tenant-A", requestId: "req-inflight-2" }
    );

    expect(recovered.ingested).toBe(1);
    expect(recovered.skipped).toBe(0);
    expect(harness.state.events).toHaveLength(1);
  });

  it("isolates idempotency by tenant", async () => {
    const harness = await setupHarness();

    const tenantA = await harness.ingestOperationalEvents(
      { events: [baseEvent] },
      { tenantId: "tenant-A", requestId: "tenant-a-1" }
    );
    const tenantB = await harness.ingestOperationalEvents(
      { events: [baseEvent] },
      { tenantId: "tenant-B", requestId: "tenant-b-1" }
    );

    expect(tenantA.ingested).toBe(1);
    expect(tenantB.ingested).toBe(1);
    expect(harness.state.events).toHaveLength(2);
    expect(harness.state.ledger.size).toBe(2);
  });

  it("keeps uniqueness constraint in schema and migration for tenant+source+idempotency key", () => {
    const schema = fs.readFileSync(path.resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    const migration = fs.readFileSync(
      path.resolve(process.cwd(), "prisma/migrations/202603170005_event_idempotency_ledger/migration.sql"),
      "utf8"
    );

    expect(schema).toContain("@@unique([tenant_id, source, idempotency_key], map: \"eid_ledger_tenant_source_key_uq\")");
    expect(migration).toContain("UNIQUE INDEX `eid_ledger_tenant_source_key_uq`");
  });
});
