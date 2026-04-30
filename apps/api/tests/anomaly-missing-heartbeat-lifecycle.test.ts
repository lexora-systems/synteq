import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const resolveTenantAccessMock = vi.fn();
const markBreachedSlaMock = vi.fn();

const alertPolicyFindManyMock = vi.fn();
const workflowFindManyMock = vi.fn();
const incidentFindFirstMock = vi.fn();
const incidentFindManyMock = vi.fn();
const incidentCreateMock = vi.fn();
const incidentUpdateMock = vi.fn();
const incidentEventCreateMock = vi.fn();
const incidentEventCreateManyMock = vi.fn();

type IncidentRow = {
  id: string;
  tenant_id: string;
  policy_id: string | null;
  workflow_id: string | null;
  environment: string | null;
  status: "open" | "acked" | "resolved";
  severity: "warn" | "low" | "medium" | "high" | "critical";
  started_at: Date;
  last_seen_at: Date;
  resolved_at: Date | null;
  sla_due_at: Date;
  sla_breached_at: Date | null;
  fingerprint: string;
  summary: string;
  details_json: Record<string, unknown>;
  created_at: Date;
};

type IncidentEventRow = {
  id: number;
  incident_id: string;
  event_type: string;
  payload_json: Record<string, unknown>;
  at_time: Date;
};

const state: {
  incidents: IncidentRow[];
  events: IncidentEventRow[];
  nextIncidentId: number;
  nextEventId: number;
} = {
  incidents: [],
  events: [],
  nextIncidentId: 1,
  nextEventId: 1
};

let heartbeatMode: "outage" | "healthy" = "outage";

vi.mock("../src/config.js", () => ({
  config: {
    BIGQUERY_PROJECT_ID: "project-test",
    BIGQUERY_DATASET: "synteq",
    INCIDENT_COOLDOWN_WINDOWS: 3,
    INCIDENT_ESCALATION_MINUTES: 20
  }
}));

vi.mock("../src/lib/bigquery.js", () => ({
  getBigQueryClient: () => ({
    query: queryMock
  })
}));

vi.mock("../src/services/entitlement-guard-service.js", () => ({
  resolveTenantAccess: resolveTenantAccessMock
}));

vi.mock("../src/services/incidents-service.js", () => ({
  markBreachedSla: markBreachedSlaMock
}));

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    alertPolicy: {
      findMany: alertPolicyFindManyMock
    },
    workflow: {
      findMany: workflowFindManyMock
    },
    incident: {
      findFirst: incidentFindFirstMock,
      findMany: incidentFindManyMock,
      create: incidentCreateMock,
      update: incidentUpdateMock
    },
    incidentEvent: {
      create: incidentEventCreateMock,
      createMany: incidentEventCreateManyMock
    }
  }
}));

function resetState() {
  state.incidents = [];
  state.events = [];
  state.nextIncidentId = 1;
  state.nextEventId = 1;
}

function matchStatus(input: IncidentRow, whereStatus: unknown): boolean {
  if (!whereStatus) {
    return true;
  }

  if (typeof whereStatus === "string") {
    return input.status === whereStatus;
  }

  if (
    whereStatus &&
    typeof whereStatus === "object" &&
    "in" in (whereStatus as { in?: unknown }) &&
    Array.isArray((whereStatus as { in?: unknown[] }).in)
  ) {
    return ((whereStatus as { in: Array<IncidentRow["status"]> }).in).includes(input.status);
  }

  return true;
}

function filterIncidents(where: Record<string, unknown>): IncidentRow[] {
  return state.incidents.filter((incident) => {
    if (where.tenant_id && incident.tenant_id !== where.tenant_id) {
      return false;
    }
    if (where.policy_id && incident.policy_id !== where.policy_id) {
      return false;
    }
    if (where.workflow_id && incident.workflow_id !== where.workflow_id) {
      return false;
    }
    if (where.environment && incident.environment !== where.environment) {
      return false;
    }
    if (where.fingerprint && incident.fingerprint !== where.fingerprint) {
      return false;
    }
    if (!matchStatus(incident, where.status)) {
      return false;
    }
    return true;
  });
}

function sortByDesc<T extends IncidentRow>(rows: T[], field: "started_at" | "resolved_at"): T[] {
  return [...rows].sort((left, right) => {
    const leftTs = left[field]?.getTime() ?? 0;
    const rightTs = right[field]?.getTime() ?? 0;
    return rightTs - leftTs;
  });
}

async function runAt(isoTs: string) {
  const now = new Date(isoTs);
  vi.setSystemTime(now);
  const { runAnomalyDetectionJob } = await import("../src/services/anomaly-service.js");
  await runAnomalyDetectionJob(now);
}

describe("missing heartbeat incident lifecycle dedupe", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    heartbeatMode = "outage";
    resetState();
    vi.resetModules();

    queryMock.mockReset();
    resolveTenantAccessMock.mockReset();
    markBreachedSlaMock.mockReset();
    alertPolicyFindManyMock.mockReset();
    workflowFindManyMock.mockReset();
    incidentFindFirstMock.mockReset();
    incidentFindManyMock.mockReset();
    incidentCreateMock.mockReset();
    incidentUpdateMock.mockReset();
    incidentEventCreateMock.mockReset();
    incidentEventCreateManyMock.mockReset();

    resolveTenantAccessMock.mockResolvedValue({
      tenantId: "tenant-A",
      currentPlan: "pro",
      effectivePlan: "pro",
      detectionLevel: "full"
    });
    markBreachedSlaMock.mockResolvedValue(0);

    alertPolicyFindManyMock.mockResolvedValue([
      {
        id: "policy-hb-1",
        tenant_id: "tenant-A",
        name: "Workflow heartbeat silence",
        metric: "missing_heartbeat",
        window_sec: 300,
        threshold: 1,
        comparator: "gte",
        min_events: 0,
        severity: "high",
        is_enabled: true,
        filter_workflow_id: "wf-1",
        filter_env: "prod"
      }
    ]);

    workflowFindManyMock.mockResolvedValue([
      {
        id: "wf-1",
        environment: "prod"
      }
    ]);

    queryMock.mockImplementation(async () => {
      const lastHeartbeat =
        heartbeatMode === "outage" ? new Date(Date.now() - 5 * 60_000) : new Date(Date.now() - 10_000);
      return [
        [
          {
            last_heartbeat: lastHeartbeat,
            heartbeat_count: 10,
            expected_interval_sec: 60
          }
        ]
      ];
    });

    incidentFindFirstMock.mockImplementation(async (args: { where: Record<string, unknown>; orderBy?: Record<string, unknown> }) => {
      const where = args.where ?? {};
      const matched = filterIncidents(where);

      if (args.orderBy && "resolved_at" in args.orderBy) {
        return sortByDesc(matched, "resolved_at")[0] ?? null;
      }

      return sortByDesc(matched, "started_at")[0] ?? null;
    });

    incidentFindManyMock.mockImplementation(async (args: { where: Record<string, unknown>; orderBy?: Record<string, unknown> }) => {
      const where = args.where ?? {};
      const matched = filterIncidents(where);

      if (args.orderBy && "started_at" in args.orderBy) {
        return sortByDesc(matched, "started_at");
      }

      return matched;
    });

    incidentCreateMock.mockImplementation(async (args: { data: Omit<IncidentRow, "id" | "created_at" | "resolved_at" | "sla_breached_at"> & Partial<IncidentRow> }) => {
      const created: IncidentRow = {
        id: `inc-${state.nextIncidentId++}`,
        tenant_id: args.data.tenant_id,
        policy_id: args.data.policy_id ?? null,
        workflow_id: args.data.workflow_id ?? null,
        environment: args.data.environment ?? null,
        status: args.data.status,
        severity: args.data.severity,
        started_at: args.data.started_at,
        last_seen_at: args.data.last_seen_at,
        resolved_at: args.data.resolved_at ?? null,
        sla_due_at: args.data.sla_due_at,
        sla_breached_at: args.data.sla_breached_at ?? null,
        fingerprint: args.data.fingerprint,
        summary: args.data.summary,
        details_json: args.data.details_json,
        created_at: new Date()
      };
      state.incidents.push(created);
      return created;
    });

    incidentUpdateMock.mockImplementation(async (args: { where: { id: string }; data: Partial<IncidentRow> }) => {
      const existing = state.incidents.find((incident) => incident.id === args.where.id);
      if (!existing) {
        throw new Error(`Incident not found: ${args.where.id}`);
      }
      if (args.data.status) {
        existing.status = args.data.status;
      }
      if (args.data.severity) {
        existing.severity = args.data.severity;
      }
      if (args.data.last_seen_at) {
        existing.last_seen_at = args.data.last_seen_at;
      }
      if (args.data.resolved_at !== undefined) {
        existing.resolved_at = args.data.resolved_at ?? null;
      }
      if (args.data.sla_due_at) {
        existing.sla_due_at = args.data.sla_due_at;
      }
      if (args.data.details_json) {
        existing.details_json = args.data.details_json;
      }
      return existing;
    });

    incidentEventCreateMock.mockImplementation(async (args: { data: Omit<IncidentEventRow, "id" | "at_time"> & Partial<IncidentEventRow> }) => {
      const created: IncidentEventRow = {
        id: state.nextEventId++,
        incident_id: args.data.incident_id,
        event_type: args.data.event_type,
        payload_json: args.data.payload_json,
        at_time: args.data.at_time ?? new Date()
      };
      state.events.push(created);
      return created;
    });

    incidentEventCreateManyMock.mockImplementation(async (args: { data: Array<Omit<IncidentEventRow, "id" | "at_time"> & Partial<IncidentEventRow>> }) => {
      for (const row of args.data) {
        state.events.push({
          id: state.nextEventId++,
          incident_id: row.incident_id,
          event_type: row.event_type,
          payload_json: row.payload_json,
          at_time: row.at_time ?? new Date()
        });
      }
      return {
        count: args.data.length
      };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("creates an incident on the first sustained heartbeat outage", async () => {
    await runAt("2026-04-23T00:00:00.000Z");

    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0].status).toBe("open");
    expect(state.events.map((event) => event.event_type)).toEqual(expect.arrayContaining(["TRIGGERED", "ALERT_PENDING"]));
  });

  it("does not duplicate missing-heartbeat incidents across repeated outage runs", async () => {
    await runAt("2026-04-23T00:00:00.000Z");
    const firstIncidentId = state.incidents[0].id;

    await runAt("2026-04-23T00:01:05.000Z");

    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0].id).toBe(firstIncidentId);
    expect(state.events.filter((event) => event.event_type === "TRIGGERED")).toHaveLength(1);
    expect(state.events.filter((event) => event.event_type === "DETECTED")).toHaveLength(1);
  });

  it("resolves the same incident after heartbeat recovery clear windows", async () => {
    await runAt("2026-04-23T00:00:00.000Z");
    const firstIncidentId = state.incidents[0].id;

    heartbeatMode = "healthy";
    await runAt("2026-04-23T00:01:05.000Z");
    await runAt("2026-04-23T00:02:05.000Z");
    await runAt("2026-04-23T00:03:05.000Z");

    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0].id).toBe(firstIncidentId);
    expect(state.incidents[0].status).toBe("resolved");
    expect(state.events.filter((event) => event.event_type === "CLEAR_WINDOW")).toHaveLength(2);
    expect(state.events.filter((event) => event.event_type === "RESOLVED_AUTO")).toHaveLength(1);
  });
});
