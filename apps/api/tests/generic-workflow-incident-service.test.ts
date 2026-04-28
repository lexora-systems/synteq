import { beforeEach, describe, expect, it, vi } from "vitest";

const incidentFindFirstMock = vi.fn();
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

function resetState() {
  state.incidents = [];
  state.events = [];
  state.nextIncidentId = 1;
  state.nextEventId = 1;
}

function statusMatches(incident: IncidentRow, status: unknown) {
  if (!status) {
    return true;
  }
  if (typeof status === "string") {
    return incident.status === status;
  }
  if (status && typeof status === "object" && Array.isArray((status as { in?: unknown[] }).in)) {
    return (status as { in: string[] }).in.includes(incident.status);
  }
  return true;
}

function filterIncidents(where: Record<string, unknown>) {
  return state.incidents.filter((incident) => {
    if (where.id && incident.id !== where.id) {
      return false;
    }
    if (where.tenant_id && incident.tenant_id !== where.tenant_id) {
      return false;
    }
    if (where.fingerprint && incident.fingerprint !== where.fingerprint) {
      return false;
    }
    if (!statusMatches(incident, where.status)) {
      return false;
    }
    return true;
  });
}

function baseWorkflowEvent(overrides: Record<string, unknown> = {}) {
  return {
    source_type: "n8n",
    source_id: "source-1",
    source_key: "n8n-customer-onboarding",
    workflow_id: "customer-onboarding",
    workflow_name: "Customer Onboarding",
    execution_id: "exec-1",
    status: "failed",
    started_at: new Date("2026-04-28T10:00:00.000Z"),
    finished_at: new Date("2026-04-28T10:01:00.000Z"),
    duration_ms: 60_000,
    error_message: "HTTP node failed",
    environment: "production",
    metadata: {
      synthetic: true,
      test: true,
      platform: "n8n"
    },
    ...overrides
  };
}

async function detect(input: {
  body?: Record<string, unknown>;
  normalizedStatus: "succeeded" | "failed" | "timed_out";
  ingested?: number;
}) {
  const { handleGenericWorkflowEventDetection } = await import("../src/services/generic-workflow-incident-service.js");
  return handleGenericWorkflowEventDetection({
    tenantId: "tenant-A",
    body: baseWorkflowEvent(input.body) as never,
    normalizedStatus: input.normalizedStatus,
    ingested: input.ingested ?? 1
  });
}

describe("generic workflow incident detection", () => {
  beforeEach(() => {
    vi.resetModules();
    resetState();
    incidentFindFirstMock.mockReset();
    incidentCreateMock.mockReset();
    incidentUpdateMock.mockReset();
    incidentEventCreateMock.mockReset();
    incidentEventCreateManyMock.mockReset();

    incidentFindFirstMock.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      const matches = filterIncidents(args.where ?? {});
      return [...matches].sort((left, right) => right.started_at.getTime() - left.started_at.getTime())[0] ?? null;
    });

    incidentCreateMock.mockImplementation(async (args: { data: Omit<IncidentRow, "id" | "created_at"> }) => {
      const created: IncidentRow = {
        ...args.data,
        id: `inc-${state.nextIncidentId++}`,
        policy_id: args.data.policy_id ?? null,
        workflow_id: args.data.workflow_id ?? null,
        environment: args.data.environment ?? null,
        resolved_at: args.data.resolved_at ?? null,
        sla_breached_at: args.data.sla_breached_at ?? null,
        created_at: new Date("2026-04-28T10:00:00.000Z")
      };
      state.incidents.push(created);
      return created;
    });

    incidentUpdateMock.mockImplementation(async (args: { where: { id: string }; data: Partial<IncidentRow> }) => {
      const incident = state.incidents.find((item) => item.id === args.where.id);
      if (!incident) {
        throw new Error(`Incident not found: ${args.where.id}`);
      }
      Object.assign(incident, args.data);
      return incident;
    });

    incidentEventCreateMock.mockImplementation(async (args: { data: Omit<IncidentEventRow, "id" | "at_time"> & Partial<IncidentEventRow> }) => {
      const created: IncidentEventRow = {
        id: state.nextEventId++,
        incident_id: args.data.incident_id,
        event_type: args.data.event_type,
        payload_json: args.data.payload_json,
        at_time: args.data.at_time ?? new Date("2026-04-28T10:00:00.000Z")
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
          at_time: row.at_time ?? new Date("2026-04-28T10:00:00.000Z")
        });
      }
      return {
        count: args.data.length
      };
    });
  });

  it("creates an incident for a failed generic workflow event", async () => {
    const result = await detect({
      normalizedStatus: "failed"
    });

    expect(result).toMatchObject({
      action: "incident_created",
      rule: "failed",
      incidentId: "inc-1"
    });
    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0]).toMatchObject({
      status: "open",
      severity: "medium",
      summary: "Workflow failed: Customer Onboarding"
    });
    expect(state.incidents[0].details_json).toMatchObject({
      sourceType: "n8n",
      sourceId: "source-1",
      workflowId: "customer-onboarding",
      workflowName: "Customer Onboarding",
      executionId: "exec-1",
      status: "failed",
      durationMs: 60_000,
      errorMessage: "HTTP node failed",
      environment: "production",
      synthetic: true,
      test: true
    });
    expect(state.events.map((event) => event.event_type)).toEqual(["BRIDGE_OPENED", "ALERT_PENDING"]);
  });

  it("creates a high-severity incident for a timed-out generic workflow event", async () => {
    await detect({
      normalizedStatus: "timed_out",
      body: {
        status: "timed_out",
        workflow_id: "invoice-sync",
        workflow_name: "Invoice Sync",
        execution_id: "exec-timeout"
      }
    });

    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0]).toMatchObject({
      severity: "high",
      summary: "Workflow timed out: Invoice Sync"
    });
  });

  it("reuses the same active incident for repeated failed events on the same source and workflow", async () => {
    await detect({
      normalizedStatus: "failed"
    });
    const firstIncidentId = state.incidents[0].id;
    const firstFingerprint = state.incidents[0].fingerprint;

    const second = await detect({
      normalizedStatus: "failed",
      body: {
        execution_id: "exec-2",
        started_at: new Date("2026-04-28T10:03:00.000Z")
      }
    });

    expect(second).toMatchObject({
      action: "incident_updated",
      incidentId: firstIncidentId
    });
    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0].id).toBe(firstIncidentId);
    expect(state.incidents[0].fingerprint).toBe(firstFingerprint);
    expect(state.incidents[0].details_json).toMatchObject({
      executionId: "exec-2"
    });
    expect(state.events.map((event) => event.event_type)).toEqual([
      "BRIDGE_OPENED",
      "ALERT_PENDING",
      "BRIDGE_REFRESHED"
    ]);
  });

  it("creates a separate incident for a different workflow id", async () => {
    await detect({
      normalizedStatus: "failed"
    });
    await detect({
      normalizedStatus: "failed",
      body: {
        workflow_id: "invoice-sync",
        workflow_name: "Invoice Sync",
        execution_id: "exec-2"
      }
    });

    expect(state.incidents).toHaveLength(2);
    expect(new Set(state.incidents.map((incident) => incident.fingerprint)).size).toBe(2);
  });

  it("resolves the matching active generic workflow incident on succeeded event", async () => {
    await detect({
      normalizedStatus: "failed"
    });
    const incidentId = state.incidents[0].id;

    const recovery = await detect({
      normalizedStatus: "succeeded",
      body: {
        status: "succeeded",
        execution_id: "exec-recovered",
        error_message: undefined
      }
    });

    expect(recovery).toMatchObject({
      action: "incident_resolved",
      incidentId
    });
    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0]).toMatchObject({
      id: incidentId,
      status: "resolved"
    });
    expect(state.events.map((event) => event.event_type)).toContain("BRIDGE_RESOLVED");
    expect(state.events.map((event) => event.event_type)).toContain("GENERIC_WORKFLOW_RECOVERY");
  });

  it("does not resolve an unrelated workflow incident on succeeded event", async () => {
    await detect({
      normalizedStatus: "failed"
    });

    const recovery = await detect({
      normalizedStatus: "succeeded",
      body: {
        status: "succeeded",
        workflow_id: "invoice-sync",
        workflow_name: "Invoice Sync",
        execution_id: "exec-invoice-success"
      }
    });

    expect(recovery).toMatchObject({
      action: "recovery_noop"
    });
    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0].status).toBe("open");
    expect(state.events.map((event) => event.event_type)).not.toContain("BRIDGE_RESOLVED");
  });

  it("reuses an acknowledged incident using the existing bridge refresh lifecycle", async () => {
    await detect({
      normalizedStatus: "failed"
    });
    state.incidents[0].status = "acked";
    const incidentId = state.incidents[0].id;

    const refreshed = await detect({
      normalizedStatus: "failed",
      body: {
        execution_id: "exec-after-ack"
      }
    });

    expect(refreshed).toMatchObject({
      action: "incident_updated",
      incidentId
    });
    expect(state.incidents).toHaveLength(1);
    expect(state.incidents[0].id).toBe(incidentId);
  });

  it("does not apply generic workflow incident detection to GitHub source type", async () => {
    const result = await detect({
      normalizedStatus: "failed",
      body: {
        source_type: "github"
      }
    });

    expect(result).toMatchObject({
      action: "skipped"
    });
    expect(state.incidents).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });
});
