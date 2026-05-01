import { prisma } from "../lib/prisma.js";
import {
  PIPELINE_STAGE_DEFINITIONS,
  evaluatePipelineStageFreshness,
  getPipelineStageThresholdMinutes,
  readPipelineStageSnapshots,
  type PipelineStageName
} from "./pipeline-freshness-service.js";

export type OperationalHealthState = "healthy" | "degraded" | "failing" | "unknown";
export type OperationalFreshnessState = "fresh" | "stale" | "unknown";
export type OperationalIncidentSeverityBucket = "critical" | "high" | "medium" | "low" | "unknown";

export type OperationalDashboard = {
  generatedAt: string;
  globalState: OperationalHealthState;
  activeIncidents: {
    total: number;
    bySeverity: Record<OperationalIncidentSeverityBucket, number>;
  };
  recentlyResolved: {
    total: number;
    windowHours: number;
  };
  sources: {
    total: number;
    fresh: number;
    stale: number;
    unknown: number;
    items: Array<{
      id: string;
      name: string;
      type: string;
      state: OperationalFreshnessState;
      lastSignalAt: string | null;
    }>;
  };
  workflows: {
    total: number;
    healthy: number;
    degraded: number;
    failing: number;
    unknown: number;
    items: Array<{
      id: string;
      name: string;
      sourceName?: string;
      environment?: string;
      state: OperationalHealthState;
      lastSignalAt: string | null;
      activeIncidentCount: number;
    }>;
  };
  pipeline: {
    state: OperationalFreshnessState;
    jobs: Array<{
      name: string;
      state: OperationalFreshnessState;
      lastSeenAt: string | null;
    }>;
  };
  events: {
    windowHours: number;
    succeeded: number;
    failed: number;
    timedOut: number;
    unknown: number;
  };
};

type DashboardWorkflowRow = {
  id: string;
  display_name: string;
  slug: string;
  system: string;
  environment: string;
  source_type: string;
};

type DashboardGitHubIntegrationRow = {
  id: string;
  webhook_id: string;
  repository_full_name: string | null;
  last_seen_at: Date | null;
};

type DashboardIncidentRow = {
  id: string;
  severity: string;
  workflow_id: string | null;
  environment: string | null;
  details_json: unknown;
};

type DashboardOperationalEventRow = {
  id: string;
  source: string;
  event_type: string;
  service: string | null;
  system: string;
  environment: string | null;
  event_ts: Date;
  metadata_json: unknown;
};

type CountArgs = Record<string, unknown>;
type FindManyArgs = Record<string, unknown>;

export type OperationalDashboardClient = {
  workflow: {
    findMany: (args: FindManyArgs) => Promise<DashboardWorkflowRow[]>;
  };
  gitHubIntegration: {
    findMany: (args: FindManyArgs) => Promise<DashboardGitHubIntegrationRow[]>;
  };
  incident: {
    findMany: (args: FindManyArgs) => Promise<DashboardIncidentRow[]>;
    count: (args: CountArgs) => Promise<number>;
  };
  operationalEvent: {
    findMany: (args: FindManyArgs) => Promise<DashboardOperationalEventRow[]>;
    count: (args: CountArgs) => Promise<number>;
  };
};

type PipelineSnapshots = Awaited<ReturnType<typeof readPipelineStageSnapshots>>;
type PipelineSnapshotReader = () => Promise<PipelineSnapshots>;

const SOURCE_FRESHNESS_MINUTES = 30;
const WORKFLOW_FRESHNESS_MINUTES = 30;
const RECENTLY_RESOLVED_WINDOW_HOURS = 24;
const EVENT_WINDOW_HOURS = 1;
const LATEST_EVENT_LIMIT = 1000;

const succeededEventTypes = [
  "workflow_execution_succeeded",
  "workflow_succeeded",
  "workflow_completed",
  "job_completed"
];

const failedEventTypes = [
  "workflow_execution_failed",
  "workflow_failed",
  "job_failed"
];

const timedOutEventTypes = [
  "workflow_execution_timed_out",
  "workflow_timed_out",
  "job_timed_out",
  "timeout"
];
const genericWorkflowSourceTypes = new Set(["webhook", "n8n", "make", "zapier"]);

function subtractHours(from: Date, hours: number) {
  return new Date(from.getTime() - hours * 60 * 60_000);
}

function subtractMinutes(from: Date, minutes: number) {
  return new Date(from.getTime() - minutes * 60_000);
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function isoOrNull(value: Date | null) {
  return value ? value.toISOString() : null;
}

function maxDate(...values: Array<Date | null | undefined>) {
  let latest: Date | null = null;
  for (const value of values) {
    if (!value) {
      continue;
    }
    if (!latest || value.getTime() > latest.getTime()) {
      latest = value;
    }
  }
  return latest;
}

function freshnessState(input: {
  lastSignalAt: Date | null;
  now: Date;
  thresholdMinutes: number;
}): OperationalFreshnessState {
  if (!input.lastSignalAt) {
    return "unknown";
  }
  return input.lastSignalAt.getTime() >= subtractMinutes(input.now, input.thresholdMinutes).getTime()
    ? "fresh"
    : "stale";
}

function severityBucket(severity: string): OperationalIncidentSeverityBucket {
  if (severity === "critical" || severity === "high" || severity === "medium") {
    return severity;
  }
  if (severity === "low" || severity === "warn") {
    return "low";
  }
  return "unknown";
}

function eventStatus(event: DashboardOperationalEventRow): "succeeded" | "failed" | "timed_out" | "unknown" {
  const metadata = asObject(event.metadata_json);
  const status = stringField(metadata, "status", "conclusion")?.toLowerCase() ?? "";
  const eventType = event.event_type.toLowerCase();

  if (status === "timed_out" || status === "timeout" || eventType.includes("timed_out") || eventType.includes("timeout")) {
    return "timed_out";
  }
  if (status === "failed" || status === "failure" || eventType.endsWith("_failed")) {
    return "failed";
  }
  if (
    status === "succeeded" ||
    status === "success" ||
    status === "completed" ||
    eventType.endsWith("_succeeded") ||
    eventType.endsWith("_completed")
  ) {
    return "succeeded";
  }
  return "unknown";
}

function eventMatchesWorkflow(event: DashboardOperationalEventRow, workflow: DashboardWorkflowRow) {
  const metadata = asObject(event.metadata_json);
  const sourceId = stringField(metadata, "source_id", "sourceId");
  const sourceKey = stringField(metadata, "source_key", "sourceKey");
  const workflowId = stringField(metadata, "workflow_id", "workflowId");

  if (sourceId === workflow.id || workflowId === workflow.id || sourceKey === workflow.slug) {
    return true;
  }

  if (
    !genericWorkflowSourceTypes.has(workflow.source_type) &&
    event.system === workflow.system &&
    (!event.environment || event.environment === workflow.environment)
  ) {
    return true;
  }

  return false;
}

function eventMatchesGitHubIntegration(
  event: DashboardOperationalEventRow,
  integration: DashboardGitHubIntegrationRow
) {
  if (event.source !== "github_actions") {
    return false;
  }

  if (!integration.repository_full_name) {
    return true;
  }

  const repository = integration.repository_full_name.toLowerCase();
  const metadata = asObject(event.metadata_json);
  const metadataRepository = stringField(metadata, "repository_full_name", "repositoryFullName")?.toLowerCase();
  return event.system.toLowerCase() === repository || metadataRepository === repository;
}

function incidentMatchesWorkflow(incident: DashboardIncidentRow, workflow: DashboardWorkflowRow) {
  if (incident.workflow_id === workflow.id) {
    return true;
  }

  const details = asObject(incident.details_json);
  const sourceId = stringField(details, "sourceId", "source_id");
  const sourceKey = stringField(details, "sourceKey", "source_key");
  const workflowId = stringField(details, "workflowId", "workflow_id");

  return sourceId === workflow.id || workflowId === workflow.id || sourceKey === workflow.slug;
}

function countSourceStates(items: OperationalDashboard["sources"]["items"]) {
  return {
    fresh: items.filter((item) => item.state === "fresh").length,
    stale: items.filter((item) => item.state === "stale").length,
    unknown: items.filter((item) => item.state === "unknown").length
  };
}

function countWorkflowStates(items: OperationalDashboard["workflows"]["items"]) {
  return {
    healthy: items.filter((item) => item.state === "healthy").length,
    degraded: items.filter((item) => item.state === "degraded").length,
    failing: items.filter((item) => item.state === "failing").length,
    unknown: items.filter((item) => item.state === "unknown").length
  };
}

function workflowState(input: {
  workflow: DashboardWorkflowRow;
  latestEvent: DashboardOperationalEventRow | null;
  activeIncidents: DashboardIncidentRow[];
  now: Date;
}) {
  const activeSeverities = input.activeIncidents.map((incident) => severityBucket(incident.severity));
  const lastSignalAt = input.latestEvent?.event_ts ?? null;
  const signalState = freshnessState({
    lastSignalAt,
    now: input.now,
    thresholdMinutes: WORKFLOW_FRESHNESS_MINUTES
  });
  const latestStatus = input.latestEvent ? eventStatus(input.latestEvent) : "unknown";

  if (
    activeSeverities.includes("critical") ||
    activeSeverities.includes("high") ||
    (signalState === "fresh" && (latestStatus === "failed" || latestStatus === "timed_out"))
  ) {
    return "failing" as const;
  }

  if (activeSeverities.length > 0 || signalState === "stale") {
    return "degraded" as const;
  }

  if (signalState === "fresh" && latestStatus === "succeeded") {
    return "healthy" as const;
  }

  return "unknown" as const;
}

async function countRecentEvents(input: {
  client: OperationalDashboardClient;
  tenantId: string;
  windowStart: Date;
}) {
  const baseWhere = {
    tenant_id: input.tenantId,
    event_ts: {
      gte: input.windowStart
    }
  };

  const [total, succeeded, failed, timedOut] = await Promise.all([
    input.client.operationalEvent.count({
      where: baseWhere
    }),
    input.client.operationalEvent.count({
      where: {
        ...baseWhere,
        event_type: {
          in: succeededEventTypes
        }
      }
    }),
    input.client.operationalEvent.count({
      where: {
        ...baseWhere,
        event_type: {
          in: failedEventTypes
        }
      }
    }),
    input.client.operationalEvent.count({
      where: {
        ...baseWhere,
        event_type: {
          in: timedOutEventTypes
        }
      }
    })
  ]);

  return {
    succeeded,
    failed,
    timedOut,
    unknown: Math.max(0, total - succeeded - failed - timedOut)
  };
}

function derivePipeline(input: {
  now: Date;
  snapshots: PipelineSnapshots;
  thresholdForStage: (stage: PipelineStageName) => number;
}) {
  const jobs = PIPELINE_STAGE_DEFINITIONS.map((definition) => {
    const snapshot = input.snapshots.get(definition.stage);
    if (!snapshot) {
      return {
        name: definition.stage,
        state: "unknown" as const,
        lastSeenAt: null
      };
    }

    const freshness = evaluatePipelineStageFreshness({
      stage: definition.stage,
      maxDelayMinutes: input.thresholdForStage(definition.stage),
      now: input.now,
      snapshot
    });
    const lastSeenAt = freshness.lastCompletedAt ?? freshness.lastHeartbeatAt;

    return {
      name: definition.stage,
      state: snapshot.last_completed_at
        ? freshness.status === "healthy"
          ? ("fresh" as const)
          : ("stale" as const)
        : ("unknown" as const),
      lastSeenAt
    };
  });

  return {
    state: jobs.some((job) => job.state === "stale")
      ? ("stale" as const)
      : jobs.some((job) => job.state === "unknown")
        ? ("unknown" as const)
        : ("fresh" as const),
    jobs
  };
}

function deriveGlobalState(input: {
  activeIncidentBuckets: Record<OperationalIncidentSeverityBucket, number>;
  workflows: OperationalDashboard["workflows"];
  sources: OperationalDashboard["sources"];
  pipeline: OperationalDashboard["pipeline"];
  events: OperationalDashboard["events"];
}) {
  if (
    input.activeIncidentBuckets.critical > 0 ||
    input.activeIncidentBuckets.high > 0 ||
    input.workflows.failing > 0
  ) {
    return "failing" as const;
  }

  if (
    input.activeIncidentBuckets.medium > 0 ||
    input.activeIncidentBuckets.low > 0 ||
    input.activeIncidentBuckets.unknown > 0 ||
    input.sources.stale > 0 ||
    input.workflows.degraded > 0 ||
    input.pipeline.state === "stale"
  ) {
    return "degraded" as const;
  }

  const recentEventTotal =
    input.events.succeeded + input.events.failed + input.events.timedOut + input.events.unknown;
  const hasOperationalSignal =
    recentEventTotal > 0 ||
    input.sources.items.some((source) => source.lastSignalAt !== null) ||
    input.workflows.items.some((workflow) => workflow.lastSignalAt !== null);

  return hasOperationalSignal ? ("healthy" as const) : ("unknown" as const);
}

export async function getOperationalDashboard(input: {
  tenantId: string;
  now?: Date;
  client?: OperationalDashboardClient;
  readPipelineSnapshots?: PipelineSnapshotReader;
  thresholdForPipelineStage?: (stage: PipelineStageName) => number;
}): Promise<OperationalDashboard> {
  const now = input.now ?? new Date();
  const client = input.client ?? (prisma as unknown as OperationalDashboardClient);
  const readSnapshots = input.readPipelineSnapshots ?? readPipelineStageSnapshots;
  const thresholdForPipelineStage = input.thresholdForPipelineStage ?? getPipelineStageThresholdMinutes;
  const resolvedWindowStart = subtractHours(now, RECENTLY_RESOLVED_WINDOW_HOURS);
  const eventWindowStart = subtractHours(now, EVENT_WINDOW_HOURS);

  const [workflows, githubIntegrations, activeIncidents, recentlyResolvedTotal, latestEvents, eventCounts, pipelineSnapshots] =
    await Promise.all([
      client.workflow.findMany({
        where: {
          tenant_id: input.tenantId,
          is_active: true
        },
        select: {
          id: true,
          display_name: true,
          slug: true,
          system: true,
          environment: true,
          source_type: true
        },
        orderBy: {
          created_at: "desc"
        }
      }),
      client.gitHubIntegration.findMany({
        where: {
          tenant_id: input.tenantId,
          is_active: true
        },
        select: {
          id: true,
          webhook_id: true,
          repository_full_name: true,
          last_seen_at: true
        },
        orderBy: {
          created_at: "desc"
        }
      }),
      client.incident.findMany({
        where: {
          tenant_id: input.tenantId,
          status: {
            in: ["open", "acked"]
          }
        },
        select: {
          id: true,
          severity: true,
          workflow_id: true,
          environment: true,
          details_json: true
        },
        orderBy: {
          last_seen_at: "desc"
        }
      }),
      client.incident.count({
        where: {
          tenant_id: input.tenantId,
          status: "resolved",
          resolved_at: {
            gte: resolvedWindowStart
          }
        }
      }),
      client.operationalEvent.findMany({
        where: {
          tenant_id: input.tenantId
        },
        select: {
          id: true,
          source: true,
          event_type: true,
          service: true,
          system: true,
          environment: true,
          event_ts: true,
          metadata_json: true
        },
        orderBy: [
          {
            event_ts: "desc"
          },
          {
            id: "desc"
          }
        ],
        take: LATEST_EVENT_LIMIT
      }),
      countRecentEvents({
        client,
        tenantId: input.tenantId,
        windowStart: eventWindowStart
      }),
      readSnapshots()
    ]);

  const bySeverity: Record<OperationalIncidentSeverityBucket, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0
  };

  for (const incident of activeIncidents) {
    bySeverity[severityBucket(incident.severity)] += 1;
  }

  const workflowSourceItems = workflows.map((workflow) => {
    const latestEvent = latestEvents.find((event) => eventMatchesWorkflow(event, workflow)) ?? null;
    const lastSignalAt = latestEvent?.event_ts ?? null;
    return {
      id: workflow.id,
      name: workflow.display_name,
      type: workflow.source_type || "workflow",
      state: freshnessState({
        lastSignalAt,
        now,
        thresholdMinutes: SOURCE_FRESHNESS_MINUTES
      }),
      lastSignalAt: isoOrNull(lastSignalAt)
    };
  });

  const githubSourceItems = githubIntegrations.map((integration) => {
    const latestEvent = latestEvents.find((event) => eventMatchesGitHubIntegration(event, integration)) ?? null;
    const lastSignalAt = maxDate(latestEvent?.event_ts, integration.last_seen_at);
    return {
      id: integration.id,
      name: integration.repository_full_name ?? `hook:${integration.webhook_id}`,
      type: "github_integration",
      state: freshnessState({
        lastSignalAt,
        now,
        thresholdMinutes: SOURCE_FRESHNESS_MINUTES
      }),
      lastSignalAt: isoOrNull(lastSignalAt)
    };
  });

  const sourceItems = [...workflowSourceItems, ...githubSourceItems];
  const sourceCounts = countSourceStates(sourceItems);
  const sources = {
    total: sourceItems.length,
    ...sourceCounts,
    items: sourceItems
  };

  const workflowItems = workflows.map((workflow) => {
    const latestEvent = latestEvents.find((event) => eventMatchesWorkflow(event, workflow)) ?? null;
    const matchingIncidents = activeIncidents.filter((incident) => incidentMatchesWorkflow(incident, workflow));
    return {
      id: workflow.id,
      name: workflow.display_name,
      sourceName: workflow.source_type || workflow.system,
      environment: workflow.environment,
      state: workflowState({
        workflow,
        latestEvent,
        activeIncidents: matchingIncidents,
        now
      }),
      lastSignalAt: isoOrNull(latestEvent?.event_ts ?? null),
      activeIncidentCount: matchingIncidents.length
    };
  });
  const workflowCounts = countWorkflowStates(workflowItems);
  const workflowsReadModel = {
    total: workflowItems.length,
    ...workflowCounts,
    items: workflowItems
  };

  const pipeline = derivePipeline({
    now,
    snapshots: pipelineSnapshots,
    thresholdForStage: thresholdForPipelineStage
  });

  const events = {
    windowHours: EVENT_WINDOW_HOURS,
    ...eventCounts
  };

  return {
    generatedAt: now.toISOString(),
    globalState: deriveGlobalState({
      activeIncidentBuckets: bySeverity,
      workflows: workflowsReadModel,
      sources,
      pipeline,
      events
    }),
    activeIncidents: {
      total: activeIncidents.length,
      bySeverity
    },
    recentlyResolved: {
      total: recentlyResolvedTotal,
      windowHours: RECENTLY_RESOLVED_WINDOW_HOURS
    },
    sources,
    workflows: workflowsReadModel,
    pipeline,
    events
  };
}
