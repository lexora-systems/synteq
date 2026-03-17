import { beforeEach, describe, expect, it } from "vitest";
import { runOperationalEventsAnalysisBatch } from "../src/services/operational-events-analysis-service.js";
import { operationalEventsRules } from "../src/services/operational-events-rules.js";

type EventRow = {
  id: string;
  tenant_id: string;
  source: string;
  event_type: string;
  system: string;
  correlation_key: string | null;
  event_ts: Date;
  created_at: Date;
};

type FindingRow = {
  id: string;
  tenant_id: string;
  source: string;
  rule_key: string;
  severity: "warn" | "low" | "medium" | "high" | "critical";
  status: "open" | "resolved";
  system: string;
  correlation_key: string | null;
  fingerprint: string;
  summary: string;
  evidence_json: Record<string, unknown>;
  first_seen_at: Date;
  last_seen_at: Date;
  resolved_at: Date | null;
  event_count: number;
};

function makeClient(seed: { events: EventRow[] }) {
  const state = {
    events: [...seed.events],
    cursor: null as null | {
      worker_key: string;
      last_event_created_at: Date | null;
      last_event_id: string | null;
    },
    findings: [] as FindingRow[]
  };

  const filterEvents = (where: any) =>
    state.events.filter((event) => {
      if (!where) return true;

      if (where.OR) {
        return where.OR.some((branch: any) => {
          if (branch.created_at?.gt) {
            return event.created_at > branch.created_at.gt;
          }
          if (branch.AND) {
            const createdEq = branch.AND.find((item: any) => item.created_at !== undefined)?.created_at;
            const idGt = branch.AND.find((item: any) => item.id !== undefined)?.id;
            return (
              createdEq &&
              idGt &&
              event.created_at.getTime() === new Date(createdEq).getTime() &&
              event.id > idGt.gt
            );
          }
          return false;
        });
      }

      if (where.tenant_id && event.tenant_id !== where.tenant_id) return false;
      if (where.source && event.source !== where.source) return false;
      if (where.system && event.system !== where.system) return false;
      if (where.event_type && event.event_type !== where.event_type) return false;
      if (where.correlation_key && event.correlation_key !== where.correlation_key) return false;
      if (where.event_ts?.gte && event.event_ts < where.event_ts.gte) return false;
      return true;
    });

  return {
    state,
    client: {
      operationalEvent: {
        findMany: async (args: any) => {
          const rows = filterEvents(args.where);
          let sorted = [...rows];
          if (Array.isArray(args.orderBy)) {
            sorted = sorted.sort((a, b) => {
              for (const order of args.orderBy) {
                const [key, direction] = Object.entries(order)[0] as [keyof EventRow, "asc" | "desc"];
                const av = a[key] as unknown as Date | string;
                const bv = b[key] as unknown as Date | string;
                const cmp =
                  av instanceof Date && bv instanceof Date
                    ? av.getTime() - bv.getTime()
                    : String(av).localeCompare(String(bv));
                if (cmp !== 0) {
                  return direction === "asc" ? cmp : -cmp;
                }
              }
              return 0;
            });
          }

          return typeof args.take === "number" ? sorted.slice(0, args.take) : sorted;
        },
        count: async (args: any) => filterEvents(args.where).length
      },
      operationalEventAnalysisCursor: {
        findUnique: async (args: any) => {
          if (!state.cursor || state.cursor.worker_key !== args.where.worker_key) {
            return null;
          }
          return state.cursor;
        },
        upsert: async (args: any) => {
          if (!state.cursor) {
            state.cursor = {
              worker_key: args.create.worker_key,
              last_event_created_at: args.create.last_event_created_at,
              last_event_id: args.create.last_event_id
            };
            return state.cursor;
          }
          state.cursor.last_event_created_at = args.update.last_event_created_at;
          state.cursor.last_event_id = args.update.last_event_id;
          return state.cursor;
        }
      },
      operationalFinding: {
        findUnique: async (args: any) => {
          const where = args.where.tenant_id_fingerprint;
          const found = state.findings.find(
            (item) => item.tenant_id === where.tenant_id && item.fingerprint === where.fingerprint
          );
          if (!found) return null;
          return {
            id: found.id,
            status: found.status,
            event_count: found.event_count,
            first_seen_at: found.first_seen_at
          };
        },
        create: async (args: any) => {
          const id = `finding-${state.findings.length + 1}`;
          state.findings.push({
            id,
            ...args.data,
            resolved_at: args.data.resolved_at ?? null
          });
          return { id };
        },
        update: async (args: any) => {
          const finding = state.findings.find((item) => item.id === args.where.id);
          if (!finding) {
            throw new Error("Finding not found");
          }
          Object.assign(finding, args.data);
          return { id: finding.id };
        }
      }
    }
  };
}

describe("operational events analysis service", () => {
  const now = new Date("2026-03-17T12:30:00.000Z");
  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  };
  let baseEvents: EventRow[];

  beforeEach(() => {
    baseEvents = [];
  });

  it("processes new events and emits workflow_failed findings", async () => {
    baseEvents.push(
      {
        id: "evt-1",
        tenant_id: "tenant-A",
        source: "github_actions",
        event_type: "workflow_failed",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_run:101",
        event_ts: new Date("2026-03-17T12:10:00.000Z"),
        created_at: new Date("2026-03-17T12:10:00.000Z")
      },
      {
        id: "evt-2",
        tenant_id: "tenant-A",
        source: "ci",
        event_type: "deployment_started",
        system: "acme/payments",
        correlation_key: null,
        event_ts: new Date("2026-03-17T12:11:00.000Z"),
        created_at: new Date("2026-03-17T12:11:00.000Z")
      }
    );

    const { client, state } = makeClient({ events: baseEvents });
    const result = await runOperationalEventsAnalysisBatch({ client: client as any, now, logger });

    expect(result.processed_events).toBe(2);
    expect(state.findings.some((finding) => finding.rule_key === "github.workflow_failed")).toBe(true);
  });

  it("creates github.job_failed_burst when threshold is met", async () => {
    baseEvents.push(
      {
        id: "evt-10",
        tenant_id: "tenant-A",
        source: "github_actions",
        event_type: "job_failed",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_job:201",
        event_ts: new Date("2026-03-17T12:20:00.000Z"),
        created_at: new Date("2026-03-17T12:20:00.000Z")
      },
      {
        id: "evt-11",
        tenant_id: "tenant-A",
        source: "github_actions",
        event_type: "job_failed",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_job:202",
        event_ts: new Date("2026-03-17T12:21:00.000Z"),
        created_at: new Date("2026-03-17T12:21:00.000Z")
      },
      {
        id: "evt-12",
        tenant_id: "tenant-A",
        source: "github_actions",
        event_type: "job_failed",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_job:203",
        event_ts: new Date("2026-03-17T12:22:00.000Z"),
        created_at: new Date("2026-03-17T12:22:00.000Z")
      }
    );

    const { client, state } = makeClient({ events: baseEvents });
    await runOperationalEventsAnalysisBatch({ client: client as any, now, logger });

    const burstFinding = state.findings.find((finding) => finding.rule_key === "github.job_failed_burst");
    expect(burstFinding).toBeTruthy();
    expect(burstFinding?.status).toBe("open");
  });

  it("does not create duplicate findings on repeated runs", async () => {
    baseEvents.push({
      id: "evt-20",
      tenant_id: "tenant-A",
      source: "github_actions",
      event_type: "workflow_failed",
      system: "acme/payments",
      correlation_key: "acme/payments:workflow_run:400",
      event_ts: new Date("2026-03-17T12:05:00.000Z"),
      created_at: new Date("2026-03-17T12:05:00.000Z")
    });

    const { client, state } = makeClient({ events: baseEvents });
    const first = await runOperationalEventsAnalysisBatch({ client: client as any, now, logger });
    const second = await runOperationalEventsAnalysisBatch({ client: client as any, now, logger });

    expect(first.processed_events).toBe(1);
    expect(second.processed_events).toBe(0);
    expect(state.findings.filter((finding) => finding.rule_key === "github.workflow_failed")).toHaveLength(1);
  });

  it("advances watermark/cursor across batches", async () => {
    baseEvents.push(
      {
        id: "evt-30",
        tenant_id: "tenant-A",
        source: "github_actions",
        event_type: "workflow_failed",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_run:500",
        event_ts: new Date("2026-03-17T12:00:00.000Z"),
        created_at: new Date("2026-03-17T12:00:00.000Z")
      },
      {
        id: "evt-31",
        tenant_id: "tenant-A",
        source: "github_actions",
        event_type: "workflow_failed",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_run:501",
        event_ts: new Date("2026-03-17T12:01:00.000Z"),
        created_at: new Date("2026-03-17T12:01:00.000Z")
      }
    );

    const { client } = makeClient({ events: baseEvents });
    const first = await runOperationalEventsAnalysisBatch({
      client: client as any,
      now,
      logger,
      batchSize: 1
    });
    const second = await runOperationalEventsAnalysisBatch({
      client: client as any,
      now,
      logger,
      batchSize: 1
    });

    expect(first.processed_events).toBe(1);
    expect(second.processed_events).toBe(1);
  });

  it("ignores non-github sources safely", async () => {
    baseEvents.push({
      id: "evt-40",
      tenant_id: "tenant-A",
      source: "security_scanner",
      event_type: "security_alert",
      system: "acme/payments",
      correlation_key: null,
      event_ts: new Date("2026-03-17T12:00:00.000Z"),
      created_at: new Date("2026-03-17T12:00:00.000Z")
    });

    const { client, state } = makeClient({ events: baseEvents });
    await runOperationalEventsAnalysisBatch({ client: client as any, now, logger });

    expect(state.findings).toHaveLength(0);
  });

  it("creates stuck findings for stale in-progress job states", async () => {
    baseEvents.push({
      id: "evt-50",
      tenant_id: "tenant-A",
      source: "github_actions",
      event_type: "job_started",
      system: "acme/payments",
      correlation_key: "acme/payments:workflow_job:900",
      event_ts: new Date(now.getTime() - (operationalEventsRules.jobStuckMinutes + 5) * 60_000),
      created_at: new Date(now.getTime() - (operationalEventsRules.jobStuckMinutes + 5) * 60_000)
    });

    const { client, state } = makeClient({ events: baseEvents });
    await runOperationalEventsAnalysisBatch({ client: client as any, now, logger });

    const stuck = state.findings.find((finding) => finding.rule_key === "github.job_stuck");
    expect(stuck).toBeTruthy();
    expect(stuck?.status).toBe("open");
  });
});
