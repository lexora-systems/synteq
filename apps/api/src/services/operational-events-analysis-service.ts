import { sha256 } from "../utils/crypto.js";
import { prisma } from "../lib/prisma.js";
import { hasFeature, resolveTenantAccess, type ResolvedTenantAccess } from "./entitlement-guard-service.js";
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
  metadata_json?: unknown;
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

type TenantAccessResolver = (input: { tenantId: string; now: Date }) => Promise<ResolvedTenantAccess>;

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

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function asPositiveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

type DurationFamily = "workflow" | "job";

function durationFamilyForEventType(eventType: string): DurationFamily | null {
  if (eventType.startsWith("workflow_")) {
    return "workflow";
  }
  if (eventType.startsWith("job_")) {
    return "job";
  }
  return null;
}

function terminalTypesForDurationFamily(family: DurationFamily) {
  return family === "workflow" ? [...githubWorkflowTerminalTypes()] : [...githubJobTerminalTypes()];
}

function startTypesForDurationFamily(family: DurationFamily) {
  return family === "workflow" ? [...githubWorkflowStartTypes()] : [...githubJobStartTypes()];
}

function eventComesAfter(a: OperationalEventRow, b: OperationalEventRow) {
  if (a.event_ts.getTime() !== b.event_ts.getTime()) {
    return a.event_ts.getTime() > b.event_ts.getTime();
  }
  return a.id > b.id;
}

function runAttemptForEvent(event: OperationalEventRow): number | null {
  const metadata = asObject(event.metadata_json);
  const runAttempt = asPositiveNumber(metadata.run_attempt);
  if (runAttempt !== null) {
    return runAttempt;
  }

  const workflowRun = asObject(metadata.workflow_run);
  const workflowJob = asObject(metadata.workflow_job);
  return asPositiveNumber(workflowRun.run_attempt) ?? asPositiveNumber(workflowJob.run_attempt);
}

async function durationMsForTerminalEvent(input: {
  client: AnalysisClient;
  tenantId: string;
  correlationKey: string | null;
  family: DurationFamily;
  terminalEventTs: Date;
}): Promise<number | null> {
  if (!input.correlationKey) {
    return null;
  }

  const startEvent = await input.client.operationalEvent.findMany({
    where: {
      tenant_id: input.tenantId,
      source: "github_actions",
      correlation_key: input.correlationKey,
      event_type: {
        in: startTypesForDurationFamily(input.family)
      },
      event_ts: {
        lte: input.terminalEventTs
      }
    },
    orderBy: [{ event_ts: "desc" }, { id: "desc" }],
    take: 1,
    select: {
      id: true,
      tenant_id: true,
      source: true,
      event_type: true,
      system: true,
      correlation_key: true,
      event_ts: true,
      created_at: true,
      metadata_json: true
    }
  });

  if (startEvent.length === 0) {
    return null;
  }

  const durationMs = input.terminalEventTs.getTime() - startEvent[0].event_ts.getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }

  return durationMs;
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

function parseDurationKey(value: string): { tenantId: string; system: string; family: DurationFamily } {
  const firstDelimiter = value.indexOf("|");
  const lastDelimiter = value.lastIndexOf("|");
  const tenantId = value.slice(0, firstDelimiter);
  const system = value.slice(firstDelimiter + 1, lastDelimiter);
  const family = value.slice(lastDelimiter + 1) as DurationFamily;
  return {
    tenantId,
    system,
    family
  };
}

export async function runOperationalEventsAnalysisBatch(input?: {
  client?: AnalysisClient;
  now?: Date;
  logger?: Logger;
  batchSize?: number;
  resolveAccess?: TenantAccessResolver;
}): Promise<OperationalEventsAnalysisRunResult> {
  const client = input?.client ?? (prisma as unknown as AnalysisClient);
  const now = input?.now ?? new Date();
  const logger = input?.logger ?? defaultLogger;
  const batchSize = input?.batchSize ?? operationalEventsRules.batchSize;
  const resolveAccess = input?.resolveAccess ?? resolveTenantAccess;
  const tenantPremiumIntelligenceCache = new Map<string, boolean>();
  const loggedEntitlementDenials = new Set<string>();

  async function hasPremiumIntelligence(tenantId: string): Promise<boolean> {
    const cached = tenantPremiumIntelligenceCache.get(tenantId);
    if (cached !== undefined) {
      return cached;
    }

    const access = await resolveAccess({
      tenantId,
      now
    });
    const entitled = hasFeature(access, "premium_intelligence");
    tenantPremiumIntelligenceCache.set(tenantId, entitled);
    if (!entitled && !loggedEntitlementDenials.has(tenantId)) {
      loggedEntitlementDenials.add(tenantId);
      logger.info("operational-events-analysis.entitlement.skipped", {
        tenant_id: tenantId,
        feature: "premium_intelligence",
        effective_plan: access.effectivePlan
      });
    }
    return entitled;
  }

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
      created_at: true,
      metadata_json: true
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
  const affectedDurationTerminals = new Map<string, OperationalEventRow>();
  let findingsOpened = 0;
  let findingsResolved = 0;

  for (const event of events) {
    if (event.source !== "github_actions") {
      continue;
    }
    if (!(await hasPremiumIntelligence(event.tenant_id))) {
      continue;
    }

    affectedSystems.add(`${event.tenant_id}|${event.system}`);
    if (event.correlation_key) {
      affectedCorrelations.add(`${event.tenant_id}|${event.system}|${event.correlation_key}`);
    }
    const durationFamily = durationFamilyForEventType(event.event_type);
    const isTerminalDurationEvent =
      durationFamily !== null && terminalTypesForDurationFamily(durationFamily).includes(event.event_type as never);
    if (isTerminalDurationEvent && event.correlation_key) {
      const terminalKey = `${event.tenant_id}|${event.system}|${durationFamily}`;
      const existing = affectedDurationTerminals.get(terminalKey);
      if (!existing || eventComesAfter(event, existing)) {
        affectedDurationTerminals.set(terminalKey, event);
      }
    }
  }

  for (const systemKey of affectedSystems) {
    const { tenantId, system } = parseSystemKey(systemKey);

    const workflowFailureWindowStart = subtractMinutes(now, operationalEventsRules.workflowFailedBurstWindowMinutes);
    const workflowFailedCount = await client.operationalEvent.count({
      where: {
        tenant_id: tenantId,
        source: "github_actions",
        system,
        event_type: "workflow_failed",
        event_ts: {
          gte: workflowFailureWindowStart
        }
      }
    });
    const workflowFailureFingerprint = sha256(`github.workflow_failed|${tenantId}|${system}`);
    if (workflowFailedCount >= operationalEventsRules.workflowFailedBurstThreshold) {
      const evidenceEvents = await client.operationalEvent.findMany({
        where: {
          tenant_id: tenantId,
          source: "github_actions",
          system,
          event_type: "workflow_failed",
          event_ts: {
            gte: workflowFailureWindowStart
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
          correlation_key: true,
          metadata_json: true
        }
      });
      const state = await openOrRefreshFinding({
        client,
        tenantId,
        source: "github_actions",
        ruleKey: "github.workflow_failed",
        severity: "high",
        system,
        fingerprint: workflowFailureFingerprint,
        summary: `GitHub workflow failures repeatedly occurred for ${system}`,
        evidence: {
          window_minutes: operationalEventsRules.workflowFailedBurstWindowMinutes,
          threshold: operationalEventsRules.workflowFailedBurstThreshold,
          observed_failures: workflowFailedCount,
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
        fingerprint: workflowFailureFingerprint,
        resolvedAt: now
      });
      if (state === "resolved") {
        findingsResolved += 1;
      }
    }

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
            correlation_key: true,
            metadata_json: true
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

    const retryWindowStart = subtractMinutes(now, operationalEventsRules.retrySpikeWindowMinutes);
    const retryCandidateEvents = await client.operationalEvent.findMany({
      where: {
        tenant_id: tenantId,
        source: "github_actions",
        system,
        event_type: {
          in: [...githubWorkflowTerminalTypes(), ...githubJobTerminalTypes()]
        },
        event_ts: {
          gte: retryWindowStart
        }
      },
      orderBy: [{ event_ts: "desc" }, { id: "desc" }],
      take: operationalEventsRules.retrySpikeMaxEvents,
      select: {
        id: true,
        event_ts: true,
        event_type: true,
        source: true,
        system: true,
        tenant_id: true,
        created_at: true,
        correlation_key: true,
        metadata_json: true
      }
    });

    const retriedEvents = retryCandidateEvents.filter((event) => {
      const attempt = runAttemptForEvent(event);
      return attempt !== null && attempt > 1;
    });
    const retryRatio = retryCandidateEvents.length > 0 ? retriedEvents.length / retryCandidateEvents.length : 0;
    const retrySpikeFingerprint = sha256(`github.retry_spike|${tenantId}|${system}`);
    if (
      retriedEvents.length >= operationalEventsRules.retrySpikeThreshold &&
      retryRatio >= operationalEventsRules.retrySpikeRatioThreshold
    ) {
      const state = await openOrRefreshFinding({
        client,
        tenantId,
        source: "github_actions",
        ruleKey: "github.retry_spike",
        severity: "high",
        system,
        fingerprint: retrySpikeFingerprint,
        summary: `GitHub retry spike detected for ${system}`,
        evidence: {
          window_minutes: operationalEventsRules.retrySpikeWindowMinutes,
          retried_events: retriedEvents.length,
          total_terminal_events: retryCandidateEvents.length,
          retry_ratio: Number(retryRatio.toFixed(4)),
          ratio_threshold: operationalEventsRules.retrySpikeRatioThreshold,
          event_ids: retriedEvents.slice(0, operationalEventsRules.maxEvidenceEventIds).map((item) => item.id)
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
        fingerprint: retrySpikeFingerprint,
        resolvedAt: now
      });
      if (state === "resolved") {
        findingsResolved += 1;
      }
    }
  }

  for (const [durationKey, terminalEvent] of affectedDurationTerminals.entries()) {
    const { tenantId, system, family } = parseDurationKey(durationKey);
    const currentDurationMs = await durationMsForTerminalEvent({
      client,
      tenantId,
      correlationKey: terminalEvent.correlation_key,
      family,
      terminalEventTs: terminalEvent.event_ts
    });

    const durationFingerprint = sha256(`github.duration_drift|${tenantId}|${system}|${family}`);
    if (currentDurationMs === null) {
      continue;
    }

    const baselineWindowStart = subtractMinutes(terminalEvent.event_ts, operationalEventsRules.durationDriftLookbackMinutes);
    const baselineTerminalEvents = await client.operationalEvent.findMany({
      where: {
        tenant_id: tenantId,
        source: "github_actions",
        system,
        event_type: {
          in: terminalTypesForDurationFamily(family)
        },
        event_ts: {
          gte: baselineWindowStart,
          lt: terminalEvent.event_ts
        }
      },
      orderBy: [{ event_ts: "desc" }, { id: "desc" }],
      take: operationalEventsRules.durationDriftBaselineMaxSamples,
      select: {
        id: true,
        event_ts: true,
        event_type: true,
        source: true,
        system: true,
        tenant_id: true,
        created_at: true,
        correlation_key: true,
        metadata_json: true
      }
    });

    const baselineDurations: number[] = [];
    for (const baselineEvent of baselineTerminalEvents) {
      const duration = await durationMsForTerminalEvent({
        client,
        tenantId,
        correlationKey: baselineEvent.correlation_key,
        family,
        terminalEventTs: baselineEvent.event_ts
      });
      if (duration !== null) {
        baselineDurations.push(duration);
      }
    }

    if (baselineDurations.length < operationalEventsRules.durationDriftBaselineMinSamples) {
      continue;
    }

    const baselineMs = median(baselineDurations);
    const ratio = baselineMs > 0 ? currentDurationMs / baselineMs : 0;
    const deltaMs = currentDurationMs - baselineMs;
    if (
      ratio >= operationalEventsRules.durationDriftRatioThreshold &&
      deltaMs >= operationalEventsRules.durationDriftAbsoluteDeltaMs
    ) {
      const state = await openOrRefreshFinding({
        client,
        tenantId,
        source: "github_actions",
        ruleKey: "github.duration_drift",
        severity: "medium",
        system,
        correlationKey: terminalEvent.correlation_key,
        fingerprint: durationFingerprint,
        summary: `GitHub ${family} duration drift detected for ${system}`,
        evidence: {
          family,
          triggering_event_id: terminalEvent.id,
          current_duration_ms: Math.round(currentDurationMs),
          baseline_duration_ms: Math.round(baselineMs),
          duration_ratio: Number(ratio.toFixed(3)),
          delta_ms: Math.round(deltaMs),
          baseline_samples: baselineDurations.length
        },
        seenAt: terminalEvent.event_ts
      });
      if (state === "created" || state === "reopened") {
        findingsOpened += 1;
      }
    } else {
      const state = await resolveFinding({
        client,
        tenantId,
        fingerprint: durationFingerprint,
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
