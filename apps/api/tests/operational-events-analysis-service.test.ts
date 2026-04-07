import { beforeEach, describe, expect, it } from "vitest";
import { runOperationalEventsAnalysisBatch } from "../src/services/operational-events-analysis-service.js";
import { operationalEventsRules } from "../src/services/operational-events-rules.js";
import type { ResolvedTenantAccess } from "../src/services/entitlement-guard-service.js";

type EventRow = {
  id: string;
  tenant_id: string;
  source: string;
  event_type: string;
  system: string;
  correlation_key: string | null;
  event_ts: Date;
  created_at: Date;
  metadata_json?: Record<string, unknown>;
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
      if (typeof where.event_type === "string" && event.event_type !== where.event_type) return false;
      if (where.event_type?.in && !where.event_type.in.includes(event.event_type)) return false;
      if (where.correlation_key && event.correlation_key !== where.correlation_key) return false;
      if (where.event_ts?.gte && event.event_ts < where.event_ts.gte) return false;
      if (where.event_ts?.gt && event.event_ts <= where.event_ts.gt) return false;
      if (where.event_ts?.lte && event.event_ts > where.event_ts.lte) return false;
      if (where.event_ts?.lt && event.event_ts >= where.event_ts.lt) return false;
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
  const proAccessResolver = async (): Promise<ResolvedTenantAccess> => ({
    tenantId: "tenant-A",
    currentPlan: "pro",
    effectivePlan: "pro",
    entitlements: {
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
    },
    maxSources: null,
    maxHistoryHours: null,
    detectionLevel: "full",
    alertMode: "full",
    incidentMode: "full",
    simulationAllowed: true,
    features: {
      alerts: true,
      team_members: true,
      premium_intelligence: true,
      trend_analysis: true
    }
  });
  const freeAccessResolver = async (): Promise<ResolvedTenantAccess> => ({
    tenantId: "tenant-A",
    currentPlan: "free",
    effectivePlan: "free",
    entitlements: {
      tenant_id: "tenant-A",
      current_plan: "free",
      effective_plan: "free",
      trial: {
        status: "none",
        available: true,
        active: false,
        consumed: false,
        started_at: null,
        ends_at: null,
        source: null,
        days_remaining: 0
      }
    },
    maxSources: 1,
    maxHistoryHours: 24,
    detectionLevel: "basic",
    alertMode: "basic_email",
    incidentMode: "basic",
    simulationAllowed: true,
    features: {
      alerts: false,
      team_members: false,
      premium_intelligence: false,
      trend_analysis: false
    }
  });
  let baseEvents: EventRow[];

  beforeEach(() => {
    baseEvents = [];
  });

  it("creates workflow failure finding only when failures recur in the configured window", async () => {
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
        source: "github_actions",
        event_type: "workflow_failed",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_run:102",
        event_ts: new Date("2026-03-17T12:11:00.000Z"),
        created_at: new Date("2026-03-17T12:11:00.000Z")
      },
      {
        id: "evt-3",
        tenant_id: "tenant-A",
        source: "github_actions",
        event_type: "workflow_failed",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_run:103",
        event_ts: new Date("2026-03-17T12:12:00.000Z"),
        created_at: new Date("2026-03-17T12:12:00.000Z")
      }
    );

    const { client, state } = makeClient({ events: baseEvents });
    const result = await runOperationalEventsAnalysisBatch({
      client: client as any,
      now,
      logger,
      resolveAccess: proAccessResolver
    });

    expect(result.processed_events).toBe(3);
    expect(state.findings.some((finding) => finding.rule_key === "github.workflow_failed")).toBe(true);
  });

  it("does not create workflow failure finding for a single isolated failure", async () => {
    baseEvents.push({
      id: "evt-single-workflow-failure",
      tenant_id: "tenant-A",
      source: "github_actions",
      event_type: "workflow_failed",
      system: "acme/payments",
      correlation_key: "acme/payments:workflow_run:single",
      event_ts: new Date("2026-03-17T12:10:00.000Z"),
      created_at: new Date("2026-03-17T12:10:00.000Z")
    });

    const { client, state } = makeClient({ events: baseEvents });
    await runOperationalEventsAnalysisBatch({
      client: client as any,
      now,
      logger,
      resolveAccess: proAccessResolver
    });

    expect(state.findings.some((finding) => finding.rule_key === "github.workflow_failed")).toBe(false);
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
    await runOperationalEventsAnalysisBatch({
      client: client as any,
      now,
      logger,
      resolveAccess: proAccessResolver
    });

    const burstFinding = state.findings.find((finding) => finding.rule_key === "github.job_failed_burst");
    expect(burstFinding).toBeTruthy();
    expect(burstFinding?.status).toBe("open");
  });

  it("creates github.retry_spike when retried terminal runs exceed threshold and ratio", async () => {
    baseEvents.push(
      {
        id: "evt-r1",
        tenant_id: "tenant-A",
        source: "github_actions",
        event_type: "workflow_completed",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_run:501",
        event_ts: new Date("2026-03-17T12:05:00.000Z"),
        created_at: new Date("2026-03-17T12:05:00.000Z"),
        metadata_json: { run_attempt: 2 }
      },
      {
        id: "evt-r2",
        tenant_id: "tenant-A",
        source: "github_actions",
        event_type: "workflow_failed",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_run:502",
        event_ts: new Date("2026-03-17T12:08:00.000Z"),
        created_at: new Date("2026-03-17T12:08:00.000Z"),
        metadata_json: { run_attempt: 3 }
      },
      {
        id: "evt-r3",
        tenant_id: "tenant-A",
        source: "github_actions",
        event_type: "job_completed",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_job:701",
        event_ts: new Date("2026-03-17T12:12:00.000Z"),
        created_at: new Date("2026-03-17T12:12:00.000Z"),
        metadata_json: { run_attempt: 2 }
      },
      {
        id: "evt-r4",
        tenant_id: "tenant-A",
        source: "github_actions",
        event_type: "workflow_completed",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_run:503",
        event_ts: new Date("2026-03-17T12:15:00.000Z"),
        created_at: new Date("2026-03-17T12:15:00.000Z"),
        metadata_json: { run_attempt: 1 }
      }
    );

    const { client, state } = makeClient({ events: baseEvents });
    await runOperationalEventsAnalysisBatch({
      client: client as any,
      now,
      logger,
      resolveAccess: proAccessResolver
    });

    const retryFinding = state.findings.find((finding) => finding.rule_key === "github.retry_spike");
    expect(retryFinding).toBeTruthy();
    expect(retryFinding?.status).toBe("open");
  });

  it("creates github.duration_drift when current run duration materially exceeds recent baseline", async () => {
    baseEvents.push(
      {
        id: "evt-d1-start",
        tenant_id: "tenant-A",
        source: "github_actions",
        event_type: "workflow_started",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_run:601",
        event_ts: new Date("2026-03-17T11:30:00.000Z"),
        created_at: new Date("2026-03-17T11:30:00.000Z")
      },
      {
        id: "evt-d1-end",
        tenant_id: "tenant-A",
        source: "github_actions",
        event_type: "workflow_completed",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_run:601",
        event_ts: new Date("2026-03-17T11:32:00.000Z"),
        created_at: new Date("2026-03-17T11:32:00.000Z")
      },
      {
        id: "evt-d2-start",
        tenant_id: "tenant-A",
        source: "github_actions",
        event_type: "workflow_started",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_run:602",
        event_ts: new Date("2026-03-17T11:40:00.000Z"),
        created_at: new Date("2026-03-17T11:40:00.000Z")
      },
      {
        id: "evt-d2-end",
        tenant_id: "tenant-A",
        source: "github_actions",
        event_type: "workflow_completed",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_run:602",
        event_ts: new Date("2026-03-17T11:42:00.000Z"),
        created_at: new Date("2026-03-17T11:42:00.000Z")
      },
      {
        id: "evt-d3-start",
        tenant_id: "tenant-A",
        source: "github_actions",
        event_type: "workflow_started",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_run:603",
        event_ts: new Date("2026-03-17T11:50:00.000Z"),
        created_at: new Date("2026-03-17T11:50:00.000Z")
      },
      {
        id: "evt-d3-end",
        tenant_id: "tenant-A",
        source: "github_actions",
        event_type: "workflow_completed",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_run:603",
        event_ts: new Date("2026-03-17T11:52:00.000Z"),
        created_at: new Date("2026-03-17T11:52:00.000Z")
      },
      {
        id: "evt-d4-start",
        tenant_id: "tenant-A",
        source: "github_actions",
        event_type: "workflow_started",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_run:604",
        event_ts: new Date("2026-03-17T12:09:00.000Z"),
        created_at: new Date("2026-03-17T12:09:00.000Z")
      },
      {
        id: "evt-d4-end",
        tenant_id: "tenant-A",
        source: "github_actions",
        event_type: "workflow_completed",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_run:604",
        event_ts: new Date("2026-03-17T12:29:00.000Z"),
        created_at: new Date("2026-03-17T12:29:00.000Z")
      }
    );

    const { client, state } = makeClient({ events: baseEvents });
    await runOperationalEventsAnalysisBatch({
      client: client as any,
      now,
      logger,
      resolveAccess: proAccessResolver
    });

    const durationFinding = state.findings.find((finding) => finding.rule_key === "github.duration_drift");
    expect(durationFinding).toBeTruthy();
    expect(durationFinding?.status).toBe("open");
  });

  it("does not create duplicate findings on repeated runs", async () => {
    baseEvents.push(
      {
        id: "evt-20",
        tenant_id: "tenant-A",
        source: "github_actions",
        event_type: "workflow_failed",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_run:400",
        event_ts: new Date("2026-03-17T12:20:00.000Z"),
        created_at: new Date("2026-03-17T12:20:00.000Z")
      },
      {
        id: "evt-21",
        tenant_id: "tenant-A",
        source: "github_actions",
        event_type: "workflow_failed",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_run:401",
        event_ts: new Date("2026-03-17T12:21:00.000Z"),
        created_at: new Date("2026-03-17T12:21:00.000Z")
      },
      {
        id: "evt-22",
        tenant_id: "tenant-A",
        source: "github_actions",
        event_type: "workflow_failed",
        system: "acme/payments",
        correlation_key: "acme/payments:workflow_run:402",
        event_ts: new Date("2026-03-17T12:22:00.000Z"),
        created_at: new Date("2026-03-17T12:22:00.000Z")
      }
    );

    const { client, state } = makeClient({ events: baseEvents });
    const first = await runOperationalEventsAnalysisBatch({
      client: client as any,
      now,
      logger,
      resolveAccess: proAccessResolver
    });
    const second = await runOperationalEventsAnalysisBatch({
      client: client as any,
      now,
      logger,
      resolveAccess: proAccessResolver
    });

    expect(first.processed_events).toBe(3);
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
      batchSize: 1,
      resolveAccess: proAccessResolver
    });
    const second = await runOperationalEventsAnalysisBatch({
      client: client as any,
      now,
      logger,
      batchSize: 1,
      resolveAccess: proAccessResolver
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
    await runOperationalEventsAnalysisBatch({
      client: client as any,
      now,
      logger,
      resolveAccess: proAccessResolver
    });

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
    await runOperationalEventsAnalysisBatch({
      client: client as any,
      now,
      logger,
      resolveAccess: proAccessResolver
    });

    const stuck = state.findings.find((finding) => finding.rule_key === "github.job_stuck");
    expect(stuck).toBeTruthy();
    expect(stuck?.status).toBe("open");
  });

  it("skips premium operational finding generation for non-entitled tenants", async () => {
    baseEvents.push({
      id: "evt-60",
      tenant_id: "tenant-A",
      source: "github_actions",
      event_type: "workflow_failed",
      system: "acme/payments",
      correlation_key: "acme/payments:workflow_run:999",
      event_ts: new Date("2026-03-17T12:10:00.000Z"),
      created_at: new Date("2026-03-17T12:10:00.000Z")
    });

    const { client, state } = makeClient({ events: baseEvents });
    await runOperationalEventsAnalysisBatch({
      client: client as any,
      now,
      logger,
      resolveAccess: freeAccessResolver
    });

    expect(state.findings).toHaveLength(0);
  });
});
