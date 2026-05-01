import { describe, expect, it } from "vitest";
import {
  getOperationalDashboard,
  type OperationalDashboardClient
} from "../src/services/operational-dashboard-service.js";
import {
  PIPELINE_STAGE_DEFINITIONS,
  readPipelineStageSnapshots,
  type PipelineStageName
} from "../src/services/pipeline-freshness-service.js";

type PipelineSnapshots = Awaited<ReturnType<typeof readPipelineStageSnapshots>>;
type PipelineSnapshot = PipelineSnapshots extends Map<PipelineStageName, infer T> ? T : never;

type WorkflowRow = {
  id: string;
  tenant_id: string;
  display_name: string;
  slug: string;
  system: string;
  environment: string;
  source_type: string;
  is_active: boolean;
  created_at: Date;
};

type GitHubIntegrationRow = {
  id: string;
  tenant_id: string;
  webhook_id: string;
  webhook_secret?: string;
  repository_full_name: string | null;
  is_active: boolean;
  last_seen_at: Date | null;
  created_at: Date;
};

type IncidentRow = {
  id: string;
  tenant_id: string;
  status: "open" | "acked" | "resolved";
  severity: "warn" | "low" | "medium" | "high" | "critical";
  workflow_id: string | null;
  environment: string | null;
  details_json: Record<string, unknown>;
  resolved_at: Date | null;
  last_seen_at: Date;
};

type OperationalEventRow = {
  id: string;
  tenant_id: string;
  source: string;
  event_type: string;
  service: string | null;
  system: string;
  environment: string | null;
  event_ts: Date;
  metadata_json: Record<string, unknown>;
};

type DashboardState = {
  workflows?: WorkflowRow[];
  githubIntegrations?: GitHubIntegrationRow[];
  incidents?: IncidentRow[];
  events?: OperationalEventRow[];
};

const now = new Date("2026-05-01T10:00:00.000Z");

function minutesAgo(minutes: number) {
  return new Date(now.getTime() - minutes * 60_000);
}

function workflow(overrides: Partial<WorkflowRow> = {}): WorkflowRow {
  return {
    id: "wf-1",
    tenant_id: "tenant-A",
    display_name: "Customer Onboarding",
    slug: "n8n-customer-onboarding",
    system: "n8n:customer-onboarding",
    environment: "production",
    source_type: "n8n",
    is_active: true,
    created_at: minutesAgo(120),
    ...overrides
  };
}

function event(overrides: Partial<OperationalEventRow> = {}): OperationalEventRow {
  return {
    id: "evt-1",
    tenant_id: "tenant-A",
    source: "n8n",
    event_type: "workflow_execution_succeeded",
    service: "Customer Onboarding",
    system: "n8n:customer-onboarding",
    environment: "production",
    event_ts: minutesAgo(5),
    metadata_json: {
      source_id: "wf-1",
      source_key: "n8n-customer-onboarding",
      workflow_id: "customer-onboarding",
      status: "succeeded"
    },
    ...overrides
  };
}

function incident(overrides: Partial<IncidentRow> = {}): IncidentRow {
  return {
    id: "inc-1",
    tenant_id: "tenant-A",
    status: "open",
    severity: "medium",
    workflow_id: null,
    environment: "production",
    details_json: {
      sourceId: "wf-1",
      sourceKey: "n8n-customer-onboarding"
    },
    resolved_at: null,
    last_seen_at: minutesAgo(2),
    ...overrides
  };
}

function freshPipelineSnapshots(): PipelineSnapshots {
  const snapshots = new Map<PipelineStageName, PipelineSnapshot>();
  for (const definition of PIPELINE_STAGE_DEFINITIONS) {
    snapshots.set(definition.stage, {
      worker_name: definition.workerName,
      last_heartbeat_at: minutesAgo(1),
      last_completed_at: minutesAgo(1)
    } as PipelineSnapshot);
  }
  return snapshots as PipelineSnapshots;
}

function stalePipelineSnapshots(): PipelineSnapshots {
  const snapshots = new Map<PipelineStageName, PipelineSnapshot>();
  for (const definition of PIPELINE_STAGE_DEFINITIONS) {
    snapshots.set(definition.stage, {
      worker_name: definition.workerName,
      last_heartbeat_at: minutesAgo(90),
      last_completed_at: minutesAgo(90)
    } as PipelineSnapshot);
  }
  return snapshots as PipelineSnapshots;
}

function matchesInFilter(value: string, filter: unknown) {
  if (typeof filter === "string") {
    return value === filter;
  }
  if (filter && typeof filter === "object" && Array.isArray((filter as { in?: unknown[] }).in)) {
    return (filter as { in: string[] }).in.includes(value);
  }
  return true;
}

function matchesDateGte(value: Date | null, filter: unknown) {
  if (!filter || typeof filter !== "object" || !("gte" in filter)) {
    return true;
  }
  if (!value) {
    return false;
  }
  return value.getTime() >= new Date((filter as { gte: Date }).gte).getTime();
}

function createClient(state: DashboardState): OperationalDashboardClient {
  const workflows = state.workflows ?? [];
  const githubIntegrations = state.githubIntegrations ?? [];
  const incidents = state.incidents ?? [];
  const events = state.events ?? [];

  return {
    workflow: {
      findMany: async (args) => {
        const where = args.where as { tenant_id?: string; is_active?: boolean };
        return workflows
          .filter((row) => row.tenant_id === where.tenant_id && row.is_active === where.is_active)
          .sort((left, right) => right.created_at.getTime() - left.created_at.getTime())
          .map(({ id, display_name, slug, system, environment, source_type }) => ({
            id,
            display_name,
            slug,
            system,
            environment,
            source_type
          }));
      }
    },
    gitHubIntegration: {
      findMany: async (args) => {
        const where = args.where as { tenant_id?: string; is_active?: boolean };
        return githubIntegrations
          .filter((row) => row.tenant_id === where.tenant_id && row.is_active === where.is_active)
          .sort((left, right) => right.created_at.getTime() - left.created_at.getTime())
          .map(({ id, webhook_id, repository_full_name, last_seen_at }) => ({
            id,
            webhook_id,
            repository_full_name,
            last_seen_at
          }));
      }
    },
    incident: {
      findMany: async (args) => {
        const where = args.where as { tenant_id?: string; status?: unknown };
        return incidents
          .filter((row) => row.tenant_id === where.tenant_id && matchesInFilter(row.status, where.status))
          .sort((left, right) => right.last_seen_at.getTime() - left.last_seen_at.getTime())
          .map(({ id, severity, workflow_id, environment, details_json }) => ({
            id,
            severity,
            workflow_id,
            environment,
            details_json
          }));
      },
      count: async (args) => {
        const where = args.where as { tenant_id?: string; status?: unknown; resolved_at?: unknown };
        return incidents.filter(
          (row) =>
            row.tenant_id === where.tenant_id &&
            matchesInFilter(row.status, where.status) &&
            matchesDateGte(row.resolved_at, where.resolved_at)
        ).length;
      }
    },
    operationalEvent: {
      findMany: async (args) => {
        const where = args.where as { tenant_id?: string };
        const take = typeof args.take === "number" ? args.take : events.length;
        return events
          .filter((row) => row.tenant_id === where.tenant_id)
          .sort((left, right) => {
            const timeDelta = right.event_ts.getTime() - left.event_ts.getTime();
            return timeDelta === 0 ? right.id.localeCompare(left.id) : timeDelta;
          })
          .slice(0, take)
          .map(({ id, source, event_type, service, system, environment, event_ts, metadata_json }) => ({
            id,
            source,
            event_type,
            service,
            system,
            environment,
            event_ts,
            metadata_json
          }));
      },
      count: async (args) => {
        const where = args.where as { tenant_id?: string; event_ts?: unknown; event_type?: unknown };
        return events.filter((row) => {
          if (row.tenant_id !== where.tenant_id) {
            return false;
          }
          if (!matchesDateGte(row.event_ts, where.event_ts)) {
            return false;
          }
          if (where.event_type && !matchesInFilter(row.event_type, where.event_type)) {
            return false;
          }
          return true;
        }).length;
      }
    }
  };
}

async function readDashboard(state: DashboardState, snapshots = freshPipelineSnapshots()) {
  return getOperationalDashboard({
    tenantId: "tenant-A",
    now,
    client: createClient(state),
    readPipelineSnapshots: async () => snapshots,
    thresholdForPipelineStage: () => 30
  });
}

describe("operational dashboard service", () => {
  it("keeps all reads scoped to the requested tenant", async () => {
    const dashboard = await readDashboard({
      workflows: [
        workflow(),
        workflow({
          id: "wf-other",
          tenant_id: "tenant-B",
          display_name: "Other Tenant",
          slug: "other-tenant"
        })
      ],
      incidents: [
        incident({
          tenant_id: "tenant-B",
          severity: "critical"
        })
      ],
      events: [
        event(),
        event({
          id: "evt-other",
          tenant_id: "tenant-B",
          metadata_json: {
            source_id: "wf-other",
            source_key: "other-tenant",
            status: "failed"
          }
        })
      ]
    });

    expect(dashboard.workflows.items.map((item) => item.id)).toEqual(["wf-1"]);
    expect(dashboard.activeIncidents.total).toBe(0);
    expect(JSON.stringify(dashboard)).not.toContain("wf-other");
  });

  it("marks global state failing when active high or critical incidents exist", async () => {
    const dashboard = await readDashboard({
      workflows: [workflow()],
      incidents: [incident({ severity: "high" })],
      events: [event()]
    });

    expect(dashboard.globalState).toBe("failing");
    expect(dashboard.activeIncidents.bySeverity.high).toBe(1);
    expect(dashboard.workflows.items[0].state).toBe("failing");
  });

  it("marks global state degraded for medium or low incidents and stale pipeline jobs", async () => {
    const dashboard = await readDashboard(
      {
        workflows: [workflow()],
        incidents: [incident({ severity: "medium" })],
        events: [event()]
      },
      stalePipelineSnapshots()
    );

    expect(dashboard.globalState).toBe("degraded");
    expect(dashboard.pipeline.state).toBe("stale");
    expect(dashboard.activeIncidents.bySeverity.medium).toBe(1);
  });

  it("marks global state healthy when recent signals exist without active issues", async () => {
    const dashboard = await readDashboard({
      workflows: [workflow()],
      events: [event()]
    });

    expect(dashboard.globalState).toBe("healthy");
    expect(dashboard.sources.fresh).toBe(1);
    expect(dashboard.workflows.healthy).toBe(1);
  });

  it("marks global state unknown when there are no operational signals", async () => {
    const dashboard = await readDashboard({
      workflows: [workflow()]
    });

    expect(dashboard.globalState).toBe("unknown");
    expect(dashboard.sources.unknown).toBe(1);
    expect(dashboard.workflows.unknown).toBe(1);
  });

  it("classifies source freshness as fresh, stale, or unknown", async () => {
    const dashboard = await readDashboard({
      workflows: [
        workflow({ id: "wf-fresh", slug: "fresh", display_name: "Fresh Source" }),
        workflow({ id: "wf-stale", slug: "stale", display_name: "Stale Source" }),
        workflow({ id: "wf-unknown", slug: "unknown", display_name: "Unknown Source" })
      ],
      events: [
        event({
          id: "evt-fresh",
          event_ts: minutesAgo(10),
          metadata_json: {
            source_id: "wf-fresh",
            source_key: "fresh",
            status: "succeeded"
          }
        }),
        event({
          id: "evt-stale",
          event_ts: minutesAgo(60),
          metadata_json: {
            source_id: "wf-stale",
            source_key: "stale",
            status: "succeeded"
          }
        })
      ]
    });

    const states = Object.fromEntries(dashboard.sources.items.map((item) => [item.id, item.state]));
    expect(states).toMatchObject({
      "wf-fresh": "fresh",
      "wf-stale": "stale",
      "wf-unknown": "unknown"
    });
  });

  it("classifies workflow health as healthy, degraded, failing, or unknown", async () => {
    const dashboard = await readDashboard({
      workflows: [
        workflow({ id: "wf-healthy", slug: "healthy", display_name: "Healthy Workflow" }),
        workflow({ id: "wf-degraded", slug: "degraded", display_name: "Degraded Workflow" }),
        workflow({ id: "wf-failing", slug: "failing", display_name: "Failing Workflow" }),
        workflow({ id: "wf-unknown", slug: "unknown", display_name: "Unknown Workflow" })
      ],
      events: [
        event({
          id: "evt-healthy",
          event_ts: minutesAgo(5),
          metadata_json: {
            source_id: "wf-healthy",
            source_key: "healthy",
            status: "succeeded"
          }
        }),
        event({
          id: "evt-degraded",
          event_ts: minutesAgo(60),
          metadata_json: {
            source_id: "wf-degraded",
            source_key: "degraded",
            status: "succeeded"
          }
        }),
        event({
          id: "evt-failing",
          event_ts: minutesAgo(5),
          event_type: "workflow_execution_failed",
          metadata_json: {
            source_id: "wf-failing",
            source_key: "failing",
            status: "failed"
          }
        })
      ]
    });

    const states = Object.fromEntries(dashboard.workflows.items.map((item) => [item.id, item.state]));
    expect(states).toMatchObject({
      "wf-healthy": "healthy",
      "wf-degraded": "degraded",
      "wf-failing": "failing",
      "wf-unknown": "unknown"
    });
  });

  it("counts recently resolved incidents inside the resolved window", async () => {
    const dashboard = await readDashboard({
      workflows: [workflow()],
      incidents: [
        incident({
          id: "inc-recent",
          status: "resolved",
          resolved_at: minutesAgo(60)
        }),
        incident({
          id: "inc-old",
          status: "resolved",
          resolved_at: minutesAgo(60 * 30)
        })
      ],
      events: [event()]
    });

    expect(dashboard.recentlyResolved).toMatchObject({
      total: 1,
      windowHours: 24
    });
  });

  it("counts recent events by simple status buckets", async () => {
    const dashboard = await readDashboard({
      workflows: [workflow()],
      events: [
        event({ id: "evt-success", event_type: "workflow_execution_succeeded" }),
        event({ id: "evt-failed", event_type: "workflow_execution_failed" }),
        event({ id: "evt-timeout", event_type: "workflow_execution_timed_out" }),
        event({ id: "evt-unknown", event_type: "workflow_execution_started" }),
        event({
          id: "evt-old",
          event_type: "workflow_execution_succeeded",
          event_ts: minutesAgo(90)
        })
      ]
    });

    expect(dashboard.events).toMatchObject({
      windowHours: 1,
      succeeded: 1,
      failed: 1,
      timedOut: 1,
      unknown: 1
    });
  });

  it("does not return operational metadata, secrets, or raw payload fields", async () => {
    const dashboard = await readDashboard({
      workflows: [workflow()],
      githubIntegrations: [
        {
          id: "gh-1",
          tenant_id: "tenant-A",
          webhook_id: "hook-1",
          webhook_secret: "super-secret-webhook-value",
          repository_full_name: "acme/payments",
          is_active: true,
          last_seen_at: minutesAgo(5),
          created_at: minutesAgo(90)
        }
      ],
      events: [
        event({
          metadata_json: {
            source_id: "wf-1",
            source_key: "n8n-customer-onboarding",
            status: "succeeded",
            api_key: "super-secret-api-key",
            raw_payload: "raw-secret-payload"
          }
        })
      ]
    });

    const serialized = JSON.stringify(dashboard);
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("raw-secret-payload");
    expect(serialized).not.toContain("api_key");
    expect(serialized).not.toContain("webhook_secret");
  });
});
