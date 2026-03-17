import { sha256 } from "../utils/crypto.js";
import { prisma } from "../lib/prisma.js";
import {
  githubJobStartTypes,
  githubJobTerminalTypes,
  githubWorkflowStartTypes,
  githubWorkflowTerminalTypes,
  isGitHubJobCorrelation,
  isGitHubWorkflowCorrelation,
  operationalEventsRules
} from "./operational-events-rules.js";

type Logger = {
  info: (message: string, payload?: Record<string, unknown>) => void;
  warn: (message: string, payload?: Record<string, unknown>) => void;
  error: (message: string, payload?: Record<string, unknown>) => void;
};

type OperationalEventRow = {
  id: string;
  tenant_id: string;
  source: string;
  event_type: string;
  system: string;
  correlation_key: string | null;
  event_ts: Date;
  created_at: Date;
};

type CursorRow = {
  worker_key: string;
  last_event_created_at: Date | null;
  last_event_id: string | null;
};

type FindingRow = {
  id: string;
  status: "open" | "resolved";
  event_count: number;
  first_seen_at: Date;
};

type AnalysisClient = {
  operationalEvent: {
    findMany: (args: Record<string, unknown>) => Promise<OperationalEventRow[]>;
    count: (args: Record<string, unknown>) => Promise<number>;
  };
  operationalEventAnalysisCursor: {
    findUnique: (args: Record<string, unknown>) => Promise<CursorRow | null>;
    upsert: (args: Record<string, unknown>) => Promise<unknown>;
  };
  operationalFinding: {
    findUnique: (args: Record<string, unknown>) => Promise<FindingRow | null>;
    create: (args: Record<string, unknown>) => Promise<unknown>;
    update: (args: Record<string, unknown>) => Promise<unknown>;
  };
};

const defaultLogger: Logger = {
  info: (message, payload) => console.info(message, payload ?? {}),
  warn: (message, payload) => console.warn(message, payload ?? {}),
  error: (message, payload) => console.error(message, payload ?? {})
};

type FindingState = "created" | "reopened" | "updated" | "resolved" | "unchanged";

export type OperationalEventsAnalysisRunResult = {
  processed_events: number;
  findings_opened: number;
  findings_resolved: number;
  cursor_advanced: boolean;
};

function subtractMinutes(from: Date, minutes: number) {
  return new Date(from.getTime() - minutes * 60_000);
}

async function openOrRefreshFinding(input: {
  client: AnalysisClient;
  tenantId: string;
  source: string;
  ruleKey: string;
  severity: "warn" | "low" | "medium" | "high" | "critical";
  system: string;
  correlationKey?: string | null;
  fingerprint: string;
  summary: string;
  evidence: Record<string, unknown>;
  seenAt: Date;
}): Promise<FindingState> {
  const existing = await input.client.operationalFinding.findUnique({
    where: {
      tenant_id_fingerprint: {
        tenant_id: input.tenantId,
        fingerprint: input.fingerprint
      }
    },
    select: {
      id: true,
      status: true,
      event_count: true,
      first_seen_at: true
    }
  });

  if (!existing) {
    await input.client.operationalFinding.create({
      data: {
        tenant_id: input.tenantId,
        source: input.source,
        rule_key: input.ruleKey,
        severity: input.severity,
        status: "open",
        system: input.system,
        correlation_key: input.correlationKey ?? null,
        fingerprint: input.fingerprint,
        summary: input.summary,
        evidence_json: input.evidence,
        first_seen_at: input.seenAt,
        last_seen_at: input.seenAt,
        event_count: 1
      }
    });
    return "created";
  }

  await input.client.operationalFinding.update({
    where: { id: existing.id },
    data: {
      severity: input.severity,
      status: "open",
      resolved_at: null,
      summary: input.summary,
      evidence_json: input.evidence,
      last_seen_at: input.seenAt,
      event_count: Math.max(1, existing.event_count) + 1
    }
  });

  if (existing.status === "resolved") {
    return "reopened";
  }

  return "updated";
}

async function resolveFinding(input: {
  client: AnalysisClient;
  tenantId: string;
  fingerprint: string;
  resolvedAt: Date;
}): Promise<FindingState> {
  const existing = await input.client.operationalFinding.findUnique({
    where: {
      tenant_id_fingerprint: {
        tenant_id: input.tenantId,
        fingerprint: input.fingerprint
      }
    },
    select: {
      id: true,
      status: true,
      event_count: true,
      first_seen_at: true
    }
  });

  if (!existing || existing.status === "resolved") {
    return "unchanged";
  }

  await input.client.operationalFinding.update({
    where: { id: existing.id },
    data: {
      status: "resolved",
      resolved_at: input.resolvedAt,
      last_seen_at: input.resolvedAt
    }
  });
  return "resolved";
}

function parseSystemKey(value: string): { tenantId: string; system: string } {
  const [tenantId, ...systemParts] = value.split("|");
  return {
    tenantId,
    system: systemParts.join("|")
  };
}

function parseCorrelationKey(value: string): { tenantId: string; system: string; correlationKey: string } {
  const [tenantId, system, ...correlationParts] = value.split("|");
  return {
    tenantId,
    system,
    correlationKey: correlationParts.join("|")
  };
}

export async function runOperationalEventsAnalysisBatch(input?: {
  client?: AnalysisClient;
  now?: Date;
  logger?: Logger;
  batchSize?: number;
}): Promise<OperationalEventsAnalysisRunResult> {
  const client = input?.client ?? (prisma as unknown as AnalysisClient);
  const now = input?.now ?? new Date();
  const logger = input?.logger ?? defaultLogger;
  const batchSize = input?.batchSize ?? operationalEventsRules.batchSize;

  const cursor = await client.operationalEventAnalysisCursor.findUnique({
    where: {
      worker_key: operationalEventsRules.workerKey
    }
  });

  const events = await client.operationalEvent.findMany({
    where: cursor?.last_event_created_at
      ? {
          OR: [
            {
              created_at: {
                gt: cursor.last_event_created_at
              }
            },
            {
              AND: [
                {
                  created_at: cursor.last_event_created_at
                },
                {
                  id: {
                    gt: cursor.last_event_id ?? ""
                  }
                }
              ]
            }
          ]
        }
      : undefined,
    orderBy: [{ created_at: "asc" }, { id: "asc" }],
    take: batchSize,
    select: {
      id: true,
      tenant_id: true,
      source: true,
      event_type: true,
      system: true,
      correlation_key: true,
      event_ts: true,
      created_at: true
    }
  });

  if (events.length === 0) {
    logger.info("operational-events-analysis.batch.noop", {
      worker_key: operationalEventsRules.workerKey
    });
    return {
      processed_events: 0,
      findings_opened: 0,
      findings_resolved: 0,
      cursor_advanced: false
    };
  }

  const affectedSystems = new Set<string>();
  const affectedCorrelations = new Set<string>();
  let findingsOpened = 0;
  let findingsResolved = 0;

  for (const event of events) {
    if (event.source !== "github_actions") {
      continue;
    }

    affectedSystems.add(`${event.tenant_id}|${event.system}`);
    if (event.correlation_key) {
      affectedCorrelations.add(`${event.tenant_id}|${event.system}|${event.correlation_key}`);
    }

    if (event.event_type === "workflow_failed") {
      const fingerprint = sha256(`github.workflow_failed|${event.tenant_id}|${event.correlation_key ?? event.id}`);
      const state = await openOrRefreshFinding({
        client,
        tenantId: event.tenant_id,
        source: "github_actions",
        ruleKey: "github.workflow_failed",
        severity: "high",
        system: event.system,
        correlationKey: event.correlation_key,
        fingerprint,
        summary: `GitHub workflow failed for ${event.system}`,
        evidence: {
          triggering_event_id: event.id,
          event_type: event.event_type,
          event_ts: event.event_ts.toISOString(),
          correlation_key: event.correlation_key
        },
        seenAt: event.event_ts
      });

      if (state === "created" || state === "reopened") {
        findingsOpened += 1;
      }
    }
  }

  for (const systemKey of affectedSystems) {
    const { tenantId, system } = parseSystemKey(systemKey);
    const burstWindowStart = subtractMinutes(now, operationalEventsRules.jobFailedBurstWindowMinutes);
    const failedCount = await client.operationalEvent.count({
      where: {
        tenant_id: tenantId,
        source: "github_actions",
        system,
        event_type: "job_failed",
        event_ts: {
          gte: burstWindowStart
        }
      }
    });

    const fingerprint = sha256(`github.job_failed_burst|${tenantId}|${system}`);
    if (failedCount >= operationalEventsRules.jobFailedBurstThreshold) {
      const evidenceEvents = await client.operationalEvent.findMany({
        where: {
          tenant_id: tenantId,
          source: "github_actions",
          system,
          event_type: "job_failed",
          event_ts: {
            gte: burstWindowStart
          }
        },
        orderBy: [{ event_ts: "desc" }, { id: "desc" }],
        take: operationalEventsRules.maxEvidenceEventIds,
        select: {
          id: true,
          event_ts: true,
          event_type: true,
          source: true,
          system: true,
          tenant_id: true,
          created_at: true,
          correlation_key: true
        }
      });

      const state = await openOrRefreshFinding({
        client,
        tenantId,
        source: "github_actions",
        ruleKey: "github.job_failed_burst",
        severity: "high",
        system,
        fingerprint,
        summary: `GitHub job failures burst detected for ${system}`,
        evidence: {
          window_minutes: operationalEventsRules.jobFailedBurstWindowMinutes,
          threshold: operationalEventsRules.jobFailedBurstThreshold,
          observed_failures: failedCount,
          event_ids: evidenceEvents.map((item) => item.id)
        },
        seenAt: now
      });

      if (state === "created" || state === "reopened") {
        findingsOpened += 1;
      }
    } else {
      const state = await resolveFinding({
        client,
        tenantId,
        fingerprint,
        resolvedAt: now
      });
      if (state === "resolved") {
        findingsResolved += 1;
      }
    }
  }

  const workflowStartTypes = githubWorkflowStartTypes();
  const workflowTerminalTypes = githubWorkflowTerminalTypes();
  const jobStartTypes = githubJobStartTypes();
  const jobTerminalTypes = githubJobTerminalTypes();

  for (const correlationSetKey of affectedCorrelations) {
    const { tenantId, system, correlationKey } = parseCorrelationKey(correlationSetKey);
    const latestEvents = await client.operationalEvent.findMany({
      where: {
        tenant_id: tenantId,
        source: "github_actions",
        correlation_key: correlationKey
      },
      orderBy: [{ event_ts: "desc" }, { id: "desc" }],
      take: operationalEventsRules.maxEvidenceEventIds,
      select: {
        id: true,
        event_ts: true,
        event_type: true,
        source: true,
        system: true,
        tenant_id: true,
        created_at: true,
        correlation_key: true
      }
    });

    if (latestEvents.length === 0) {
      continue;
    }

    const latest = latestEvents[0];
    if (isGitHubWorkflowCorrelation(correlationKey)) {
      const fingerprint = sha256(`github.workflow_stuck|${tenantId}|${correlationKey}`);
      if (workflowTerminalTypes.has(latest.event_type as never)) {
        const state = await resolveFinding({
          client,
          tenantId,
          fingerprint,
          resolvedAt: now
        });
        if (state === "resolved") {
          findingsResolved += 1;
        }
        continue;
      }

      if (workflowStartTypes.has(latest.event_type as never)) {
        const ageMinutes = (now.getTime() - latest.event_ts.getTime()) / 60_000;
        if (ageMinutes >= operationalEventsRules.workflowStuckMinutes) {
          const state = await openOrRefreshFinding({
            client,
            tenantId,
            source: "github_actions",
            ruleKey: "github.workflow_stuck",
            severity: "medium",
            system,
            correlationKey,
            fingerprint,
            summary: `GitHub workflow appears stuck for ${system}`,
            evidence: {
              correlation_key: correlationKey,
              latest_event_type: latest.event_type,
              latest_event_ts: latest.event_ts.toISOString(),
              age_minutes: Math.round(ageMinutes),
              threshold_minutes: operationalEventsRules.workflowStuckMinutes,
              recent_event_ids: latestEvents.map((item) => item.id)
            },
            seenAt: now
          });
          if (state === "created" || state === "reopened") {
            findingsOpened += 1;
          }
        } else {
          const state = await resolveFinding({
            client,
            tenantId,
            fingerprint,
            resolvedAt: now
          });
          if (state === "resolved") {
            findingsResolved += 1;
          }
        }
      }
      continue;
    }

    if (isGitHubJobCorrelation(correlationKey)) {
      const fingerprint = sha256(`github.job_stuck|${tenantId}|${correlationKey}`);
      if (jobTerminalTypes.has(latest.event_type as never)) {
        const state = await resolveFinding({
          client,
          tenantId,
          fingerprint,
          resolvedAt: now
        });
        if (state === "resolved") {
          findingsResolved += 1;
        }
        continue;
      }

      if (jobStartTypes.has(latest.event_type as never)) {
        const ageMinutes = (now.getTime() - latest.event_ts.getTime()) / 60_000;
        if (ageMinutes >= operationalEventsRules.jobStuckMinutes) {
          const state = await openOrRefreshFinding({
            client,
            tenantId,
            source: "github_actions",
            ruleKey: "github.job_stuck",
            severity: "medium",
            system,
            correlationKey,
            fingerprint,
            summary: `GitHub job appears stuck for ${system}`,
            evidence: {
              correlation_key: correlationKey,
              latest_event_type: latest.event_type,
              latest_event_ts: latest.event_ts.toISOString(),
              age_minutes: Math.round(ageMinutes),
              threshold_minutes: operationalEventsRules.jobStuckMinutes,
              recent_event_ids: latestEvents.map((item) => item.id)
            },
            seenAt: now
          });
          if (state === "created" || state === "reopened") {
            findingsOpened += 1;
          }
        } else {
          const state = await resolveFinding({
            client,
            tenantId,
            fingerprint,
            resolvedAt: now
          });
          if (state === "resolved") {
            findingsResolved += 1;
          }
        }
      }
    }
  }

  const lastEvent = events[events.length - 1];
  await client.operationalEventAnalysisCursor.upsert({
    where: {
      worker_key: operationalEventsRules.workerKey
    },
    create: {
      worker_key: operationalEventsRules.workerKey,
      last_event_created_at: lastEvent.created_at,
      last_event_id: lastEvent.id
    },
    update: {
      last_event_created_at: lastEvent.created_at,
      last_event_id: lastEvent.id
    }
  });

  // Bridge point for next phase: hand open findings to incident escalation service.
  logger.info("operational-events-analysis.batch.completed", {
    processed_events: events.length,
    findings_opened: findingsOpened,
    findings_resolved: findingsResolved
  });

  return {
    processed_events: events.length,
    findings_opened: findingsOpened,
    findings_resolved: findingsResolved,
    cursor_advanced: true
  };
}
