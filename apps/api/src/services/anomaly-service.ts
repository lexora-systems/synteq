import { type AlertPolicy, Comparator, type Prisma, type Severity } from "@prisma/client";
import { config } from "../config.js";
import { getBigQueryClient } from "../lib/bigquery.js";
import { prisma } from "../lib/prisma.js";
import {
  compareValue,
  ewma,
  poissonZScore,
  proportionZScore,
  robustZScore,
  rollingAverage,
  smoothedBaseline
} from "../utils/anomaly-math.js";
import { buildIncidentFingerprint } from "../utils/crypto.js";
import { markBreachedSla } from "./incidents-service.js";

type WindowSummary = {
  total: number;
  failed: number;
  timeout: number;
  p95: number;
  retryRate: number;
  duplicates: number;
  avgCostUsd: number;
  latestBucket: Date | null;
};

type HistoryPoint = {
  count_total: number;
  count_failed: number;
  p95_duration_ms: number | null;
  retry_rate: number;
  duplicate_rate: number;
  avg_cost_usd: number | null;
};

type DetectionResult = {
  triggered: boolean;
  observed: number;
  zScore: number;
  baseline: number;
  summary: string;
  minEventsMet: boolean;
};

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return asNumber((value as { value: unknown }).value, fallback);
  }

  return fallback;
}

function safeObject(value: Prisma.JsonValue): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function comparator(policy: AlertPolicy): Comparator {
  return policy.comparator;
}

function computeSlaDueAt(startedAt: Date, severity: Severity): Date {
  const minutesBySeverity: Record<Severity, number> = {
    warn: 240,
    low: 180,
    medium: 120,
    high: 60,
    critical: 15
  };

  const due = new Date(startedAt);
  due.setMinutes(due.getMinutes() + minutesBySeverity[severity]);
  return due;
}

async function queryWindowSummary(input: {
  tenantId: string;
  workflowId: string;
  env: string;
  windowSec: number;
}): Promise<WindowSummary> {
  const bq = getBigQueryClient();
  const [rows] = await bq.query({
    query: `
      SELECT
        COALESCE(SUM(count_total), 0) AS total,
        COALESCE(SUM(count_failed), 0) AS failed,
        COALESCE(SUM(count_timeout), 0) AS timeout,
        COALESCE(AVG(p95_duration_ms), 0) AS p95,
        COALESCE(SUM(retry_rate * count_total) / NULLIF(SUM(count_total), 0), 0) AS retry_rate,
        COALESCE(SUM(duplicate_rate * count_total), 0) AS duplicates,
        COALESCE(AVG(avg_cost_usd), 0) AS avg_cost_usd,
        MAX(bucket_ts) AS latest_bucket
      FROM \`${config.BIGQUERY_PROJECT_ID}.${config.BIGQUERY_DATASET}.workflow_metrics_minute\`
      WHERE tenant_id = @tenantId
        AND workflow_id = @workflowId
        AND environment = @env
        AND bucket_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @windowSec SECOND)
    `,
    params: input,
    useLegacySql: false
  });

  const row = (rows[0] as Record<string, unknown> | undefined) ?? {};
  return {
    total: Math.round(asNumber(row.total, 0)),
    failed: Math.round(asNumber(row.failed, 0)),
    timeout: Math.round(asNumber(row.timeout, 0)),
    p95: asNumber(row.p95, 0),
    retryRate: asNumber(row.retry_rate, 0),
    duplicates: Math.round(asNumber(row.duplicates, 0)),
    avgCostUsd: asNumber(row.avg_cost_usd, 0),
    latestBucket: row.latest_bucket instanceof Date ? row.latest_bucket : null
  };
}

async function queryRollingHistory(input: {
  tenantId: string;
  workflowId: string;
  env: string;
  windowSec: number;
}): Promise<HistoryPoint[]> {
  const bq = getBigQueryClient();
  const [rows] = await bq.query({
    query: `
      SELECT
        count_total,
        count_failed,
        p95_duration_ms,
        retry_rate,
        duplicate_rate,
        avg_cost_usd
      FROM \`${config.BIGQUERY_PROJECT_ID}.${config.BIGQUERY_DATASET}.workflow_metrics_minute\`
      WHERE tenant_id = @tenantId
        AND workflow_id = @workflowId
        AND environment = @env
        AND bucket_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
        AND bucket_ts < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @windowSec SECOND)
      ORDER BY bucket_ts DESC
      LIMIT 1440
    `,
    params: input,
    useLegacySql: false
  });

  return (rows as Record<string, unknown>[]).map((row) => ({
    count_total: Math.round(asNumber(row.count_total)),
    count_failed: Math.round(asNumber(row.count_failed)),
    p95_duration_ms: row.p95_duration_ms === null ? null : asNumber(row.p95_duration_ms),
    retry_rate: asNumber(row.retry_rate),
    duplicate_rate: asNumber(row.duplicate_rate),
    avg_cost_usd: row.avg_cost_usd === null ? null : asNumber(row.avg_cost_usd)
  }));
}

async function querySeasonalHistory(input: {
  tenantId: string;
  workflowId: string;
  env: string;
}): Promise<HistoryPoint[]> {
  const bq = getBigQueryClient();
  const [rows] = await bq.query({
    query: `
      SELECT
        count_total,
        count_failed,
        p95_duration_ms,
        retry_rate,
        duplicate_rate,
        avg_cost_usd
      FROM \`${config.BIGQUERY_PROJECT_ID}.${config.BIGQUERY_DATASET}.workflow_metrics_minute\`
      WHERE tenant_id = @tenantId
        AND workflow_id = @workflowId
        AND environment = @env
        AND bucket_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
        AND EXTRACT(HOUR FROM bucket_ts) = EXTRACT(HOUR FROM CURRENT_TIMESTAMP())
      ORDER BY bucket_ts DESC
      LIMIT 420
    `,
    params: input,
    useLegacySql: false
  });

  return (rows as Record<string, unknown>[]).map((row) => ({
    count_total: Math.round(asNumber(row.count_total)),
    count_failed: Math.round(asNumber(row.count_failed)),
    p95_duration_ms: row.p95_duration_ms === null ? null : asNumber(row.p95_duration_ms),
    retry_rate: asNumber(row.retry_rate),
    duplicate_rate: asNumber(row.duplicate_rate),
    avg_cost_usd: row.avg_cost_usd === null ? null : asNumber(row.avg_cost_usd)
  }));
}

async function queryHeartbeatGap(input: {
  tenantId: string;
  workflowId: string;
  env: string;
}): Promise<number | null> {
  const bq = getBigQueryClient();
  const [rows] = await bq.query({
    query: `
      SELECT
        MAX(heartbeat_ts) AS last_heartbeat
      FROM \`${config.BIGQUERY_PROJECT_ID}.${config.BIGQUERY_DATASET}.heartbeats\`
      WHERE tenant_id = @tenantId
        AND workflow_id = @workflowId
        AND environment = @env
    `,
    params: input,
    useLegacySql: false
  });

  const row = (rows[0] as Record<string, unknown> | undefined) ?? {};
  const lastHeartbeat = row.last_heartbeat instanceof Date ? row.last_heartbeat : null;
  if (!lastHeartbeat) {
    return null;
  }

  return (Date.now() - lastHeartbeat.getTime()) / 1000;
}

function weightedBaseline(
  rollingHistory: HistoryPoint[],
  seasonalHistory: HistoryPoint[],
  selector: (point: HistoryPoint) => number
): number {
  const rolling = rollingAverage(rollingHistory.map(selector).filter((value) => Number.isFinite(value)));
  const seasonal = rollingAverage(seasonalHistory.map(selector).filter((value) => Number.isFinite(value)));
  return smoothedBaseline(rolling, seasonal, 0.3);
}

function evaluateMetric(
  policy: AlertPolicy,
  summary: WindowSummary,
  rollingHistory: HistoryPoint[],
  seasonalHistory: HistoryPoint[]
): DetectionResult {
  const n = summary.total;
  if (n < policy.min_events && policy.metric !== "missing_heartbeat") {
    return {
      triggered: false,
      observed: 0,
      zScore: 0,
      baseline: 0,
      summary: `n=${n} below min_events=${policy.min_events}`,
      minEventsMet: false
    };
  }

  const historyTotal = rollingHistory.reduce((acc, point) => acc + point.count_total, 0);
  const historyFailed = rollingHistory.reduce((acc, point) => acc + point.count_failed, 0);
  const rollingFailure = historyTotal > 0 ? historyFailed / historyTotal : 0.01;
  const seasonalFailure = weightedBaseline(rollingHistory, seasonalHistory, (point) =>
    point.count_total > 0 ? point.count_failed / point.count_total : 0
  );
  const baselineFailure = smoothedBaseline(rollingFailure, seasonalFailure, 0.3);

  const baselineRetry = weightedBaseline(rollingHistory, seasonalHistory, (point) => point.retry_rate);
  const baselineDupLambda = weightedBaseline(rollingHistory, seasonalHistory, (point) => point.duplicate_rate * point.count_total);
  const baselineCost = weightedBaseline(rollingHistory, seasonalHistory, (point) => point.avg_cost_usd ?? 0);

  if (policy.metric === "failure_rate") {
    const observedRate = summary.failed / Math.max(n, 1);
    const z = proportionZScore({ total: n, failures: summary.failed, baselineRate: baselineFailure });
    const passed = z >= 3 && compareValue(observedRate, policy.threshold, comparator(policy));
    return {
      triggered: passed,
      observed: observedRate,
      zScore: z,
      baseline: baselineFailure,
      summary: `failure_rate=${observedRate.toFixed(4)} baseline=${baselineFailure.toFixed(4)} z=${z.toFixed(2)}`,
      minEventsMet: true
    };
  }

  if (policy.metric === "latency_p95") {
    const series = rollingHistory
      .map((point) => point.p95_duration_ms)
      .filter((value): value is number => value !== null && value > 0);
    const z = robustZScore(summary.p95, series);
    const baseline = weightedBaseline(rollingHistory, seasonalHistory, (point) => point.p95_duration_ms ?? 0);
    const passed = z >= 3 && compareValue(summary.p95, policy.threshold, comparator(policy));
    return {
      triggered: passed,
      observed: summary.p95,
      zScore: z,
      baseline,
      summary: `latency_p95=${summary.p95.toFixed(2)} baseline=${baseline.toFixed(2)} z=${z.toFixed(2)}`,
      minEventsMet: true
    };
  }

  if (policy.metric === "retry_rate") {
    const retryCount = Math.round(summary.retryRate * n);
    const z = proportionZScore({ total: n, failures: retryCount, baselineRate: baselineRetry });
    const passed = z >= 3 && compareValue(summary.retryRate, policy.threshold, comparator(policy));
    return {
      triggered: passed,
      observed: summary.retryRate,
      zScore: z,
      baseline: baselineRetry,
      summary: `retry_rate=${summary.retryRate.toFixed(4)} baseline=${baselineRetry.toFixed(4)} z=${z.toFixed(2)}`,
      minEventsMet: true
    };
  }

  if (policy.metric === "duplicate_rate") {
    const observedRate = summary.duplicates / Math.max(n, 1);
    const z = poissonZScore(summary.duplicates, baselineDupLambda);
    const passed = z >= 3 && compareValue(observedRate, policy.threshold, comparator(policy));
    return {
      triggered: passed,
      observed: observedRate,
      zScore: z,
      baseline: baselineDupLambda,
      summary: `duplicate_rate=${observedRate.toFixed(4)} baseline_lambda=${baselineDupLambda.toFixed(4)} z=${z.toFixed(2)}`,
      minEventsMet: true
    };
  }

  if (policy.metric === "cost_spike") {
    const costSeries = rollingHistory
      .map((point) => point.avg_cost_usd)
      .filter((value): value is number => value !== null && value > 0);
    const ewmaBaseline = ewma(costSeries, 0.25);
    const z = robustZScore(summary.avgCostUsd, costSeries);
    const ratio = ewmaBaseline > 0 ? summary.avgCostUsd / ewmaBaseline : 0;
    const passed = z >= 2.5 && compareValue(ratio, policy.threshold, comparator(policy));
    return {
      triggered: passed,
      observed: summary.avgCostUsd,
      zScore: z,
      baseline: baselineCost,
      summary: `cost_spike avg_cost=${summary.avgCostUsd.toFixed(6)} ewma=${ewmaBaseline.toFixed(6)} z=${z.toFixed(2)}`,
      minEventsMet: true
    };
  }

  if (policy.metric === "latency_drift_ewma") {
    const latencySeries = rollingHistory
      .map((point) => point.p95_duration_ms)
      .filter((value): value is number => value !== null && value > 0);
    const ewmaBaseline = ewma(latencySeries, 0.2);
    const drift = ewmaBaseline > 0 ? (summary.p95 - ewmaBaseline) / ewmaBaseline : 0;
    const passed = compareValue(drift, policy.threshold, comparator(policy));
    return {
      triggered: passed,
      observed: summary.p95,
      zScore: drift,
      baseline: ewmaBaseline,
      summary: `latency_drift p95=${summary.p95.toFixed(2)} ewma=${ewmaBaseline.toFixed(2)} drift=${drift.toFixed(4)}`,
      minEventsMet: true
    };
  }

  return {
    triggered: false,
    observed: 0,
    zScore: 0,
    baseline: 0,
    summary: `Unsupported metric ${policy.metric}`,
    minEventsMet: true
  };
}

async function shouldSuppressReopen(input: {
  tenantId: string;
  policyId: string;
  workflowId: string;
  env: string;
  now: Date;
  windowSec: number;
}) {
  const latestResolved = await prisma.incident.findFirst({
    where: {
      tenant_id: input.tenantId,
      policy_id: input.policyId,
      workflow_id: input.workflowId,
      environment: input.env,
      status: "resolved"
    },
    orderBy: {
      resolved_at: "desc"
    }
  });

  if (!latestResolved?.resolved_at) {
    return false;
  }

  const cooldownWindowSec = input.windowSec * config.INCIDENT_COOLDOWN_WINDOWS;
  const ageSec = (input.now.getTime() - latestResolved.resolved_at.getTime()) / 1000;
  if (ageSec > cooldownWindowSec) {
    return false;
  }

  const details = safeObject(latestResolved.details_json);
  const hits = typeof details.cooldown_hits === "number" ? details.cooldown_hits : 0;
  const nextHits = hits + 1;

  if (nextHits < config.INCIDENT_COOLDOWN_WINDOWS) {
    await prisma.incident.update({
      where: { id: latestResolved.id },
      data: {
        details_json: {
          ...details,
          cooldown_hits: nextHits,
          cooldown_last_observed_at: input.now.toISOString()
        }
      }
    });

    await prisma.incidentEvent.create({
      data: {
        incident_id: latestResolved.id,
        event_type: "COOLDOWN_OBSERVED",
        payload_json: {
          cooldown_hits: nextHits,
          required_hits: config.INCIDENT_COOLDOWN_WINDOWS,
          at: input.now.toISOString()
        }
      }
    });

    return true;
  }

  await prisma.incident.update({
    where: { id: latestResolved.id },
    data: {
      details_json: {
        ...details,
        cooldown_hits: 0
      }
    }
  });

  return false;
}

async function upsertIncident(input: {
  tenantId: string;
  policy: AlertPolicy;
  workflowId: string;
  env: string;
  result: DetectionResult;
  summary: WindowSummary;
  now: Date;
}) {
  const bucket = input.summary.latestBucket ?? input.now;
  const timeBucket = bucket.toISOString().slice(0, 16);
  const fingerprint = buildIncidentFingerprint({
    tenantId: input.tenantId,
    workflowId: input.workflowId,
    metric: input.policy.metric,
    timeBucket
  });

  const existing = await prisma.incident.findFirst({
    where: {
      tenant_id: input.tenantId,
      fingerprint,
      status: {
        in: ["open", "acked"]
      }
    },
    orderBy: {
      started_at: "desc"
    }
  });

  const details = {
    metric: input.policy.metric,
    observed: input.result.observed,
    baseline: input.result.baseline,
    z_score: input.result.zScore,
    clear_streak: 0,
    cooldown_hits: 0,
    consecutive_trigger_windows: 1,
    last_alert_at: input.now.toISOString(),
    total: input.summary.total,
    failed: input.summary.failed,
    retry_rate: input.summary.retryRate,
    duplicates: input.summary.duplicates,
    avg_cost_usd: input.summary.avgCostUsd,
    reason: input.result.summary
  } satisfies Prisma.JsonObject;

  if (existing) {
    const existingDetails = safeObject(existing.details_json);
    const lastAlertAtRaw = existingDetails.last_alert_at;
    const lastAlertAt = typeof lastAlertAtRaw === "string" ? new Date(lastAlertAtRaw) : new Date(0);
    const preservedLastAlertAt = typeof lastAlertAtRaw === "string" ? lastAlertAtRaw : input.now.toISOString();
    const shouldNotify = input.now.getTime() - lastAlertAt.getTime() >= 30 * 60_000;

    const previousConsecutive =
      typeof existingDetails.consecutive_trigger_windows === "number" ? existingDetails.consecutive_trigger_windows : 0;
    const nextConsecutive = previousConsecutive + 1;

    let nextSeverity = existing.severity;
    const openMinutes = (input.now.getTime() - existing.started_at.getTime()) / 60_000;
    if (openMinutes >= config.INCIDENT_ESCALATION_MINUTES && existing.severity !== "critical") {
      nextSeverity = "critical";
    }

    await prisma.incident.update({
      where: { id: existing.id },
      data: {
        last_seen_at: input.now,
        severity: nextSeverity,
        sla_due_at: nextSeverity === "critical" ? computeSlaDueAt(existing.started_at, "critical") : existing.sla_due_at,
        details_json: {
          ...existingDetails,
          ...details,
          consecutive_trigger_windows: nextConsecutive,
          last_alert_at: shouldNotify ? input.now.toISOString() : preservedLastAlertAt
        }
      }
    });

    await prisma.incidentEvent.create({
      data: {
        incident_id: existing.id,
        event_type: "DETECTED",
        payload_json: {
          ...details,
          consecutive_trigger_windows: nextConsecutive,
          escalated_severity: nextSeverity !== existing.severity
        }
      }
    });

    if (nextSeverity !== existing.severity) {
      await prisma.incidentEvent.create({
        data: {
          incident_id: existing.id,
          event_type: "SEVERITY_ESCALATED",
          payload_json: {
            previous: existing.severity,
            next: nextSeverity,
            at: input.now.toISOString()
          }
        }
      });
      await prisma.incidentEvent.create({
        data: {
          incident_id: existing.id,
          event_type: "ALERT_PENDING",
          payload_json: {
            ...details,
            escalation: true,
            severity: nextSeverity
          }
        }
      });
      return;
    }

    if (shouldNotify) {
      await prisma.incidentEvent.create({
        data: {
          incident_id: existing.id,
          event_type: "ALERT_PENDING",
          payload_json: {
            ...details,
            escalation: false,
            severity: nextSeverity
          }
        }
      });
    }

    return;
  }

  const shouldSuppress = await shouldSuppressReopen({
    tenantId: input.tenantId,
    policyId: input.policy.id,
    workflowId: input.workflowId,
    env: input.env,
    now: input.now,
    windowSec: input.policy.window_sec
  });

  if (shouldSuppress) {
    return;
  }

  const startedAt = input.now;
  const incident = await prisma.incident.create({
    data: {
      tenant_id: input.tenantId,
      policy_id: input.policy.id,
      workflow_id: input.workflowId,
      environment: input.env,
      status: "open",
      severity: input.policy.severity,
      started_at: startedAt,
      last_seen_at: startedAt,
      sla_due_at: computeSlaDueAt(startedAt, input.policy.severity),
      fingerprint,
      summary: `${input.policy.name}: ${input.result.summary}`,
      details_json: details
    }
  });

  await prisma.incidentEvent.createMany({
    data: [
      {
        incident_id: incident.id,
        event_type: "TRIGGERED",
        payload_json: details
      },
      {
        incident_id: incident.id,
        event_type: "ALERT_PENDING",
        payload_json: details
      }
    ]
  });
}

async function clearIncidentIfStable(input: {
  tenantId: string;
  policyId: string;
  workflowId: string;
  env: string;
  now: Date;
}) {
  const incidents = await prisma.incident.findMany({
    where: {
      tenant_id: input.tenantId,
      policy_id: input.policyId,
      workflow_id: input.workflowId,
      environment: input.env,
      status: {
        in: ["open", "acked"]
      }
    }
  });

  for (const incident of incidents) {
    const details = safeObject(incident.details_json);
    const currentStreak = typeof details.clear_streak === "number" ? details.clear_streak : 0;
    const nextStreak = currentStreak + 1;

    if (nextStreak >= 3) {
      await prisma.incident.update({
        where: { id: incident.id },
        data: {
          status: "resolved",
          resolved_at: input.now,
          details_json: {
            ...details,
            clear_streak: nextStreak,
            cooldown_hits: 0,
            resolved_by: "auto"
          }
        }
      });

      await prisma.incidentEvent.create({
        data: {
          incident_id: incident.id,
          event_type: "RESOLVED_AUTO",
          payload_json: {
            clear_streak: nextStreak,
            at: input.now.toISOString()
          }
        }
      });
      continue;
    }

    await prisma.incident.update({
      where: { id: incident.id },
      data: {
        details_json: {
          ...details,
          clear_streak: nextStreak
        }
      }
    });

    await prisma.incidentEvent.create({
      data: {
        incident_id: incident.id,
        event_type: "CLEAR_WINDOW",
        payload_json: {
          clear_streak: nextStreak,
          at: input.now.toISOString()
        }
      }
    });
  }
}

function buildTargets(policy: AlertPolicy, workflows: { id: string; environment: string }[]): { workflowId: string; env: string }[] {
  if (policy.filter_workflow_id) {
    const wf = workflows.find((item) => item.id === policy.filter_workflow_id);
    return [
      {
        workflowId: policy.filter_workflow_id,
        env: policy.filter_env ?? wf?.environment ?? "prod"
      }
    ];
  }

  return workflows
    .map((workflow) => ({
      workflowId: workflow.id,
      env: policy.filter_env ?? workflow.environment
    }))
    .filter(
      (target, index, source) =>
        source.findIndex((item) => item.workflowId === target.workflowId && item.env === target.env) === index
    );
}

export async function runAnomalyDetectionJob(now = new Date()) {
  const policies = await prisma.alertPolicy.findMany({
    where: {
      is_enabled: true
    }
  });

  for (const policy of policies) {
    const workflows = await prisma.workflow.findMany({
      where: {
        tenant_id: policy.tenant_id,
        is_active: true
      },
      select: {
        id: true,
        environment: true
      }
    });

    const targets = buildTargets(policy, workflows);
    for (const target of targets) {
      if (policy.metric === "missing_heartbeat") {
        const gapSec = await queryHeartbeatGap({
          tenantId: policy.tenant_id,
          workflowId: target.workflowId,
          env: target.env
        });
        const expected = Math.max(policy.window_sec, 60);
        const observedGap = gapSec ?? Number.MAX_SAFE_INTEGER;
        const triggered = observedGap > expected * 3;

        if (triggered) {
          const summary: WindowSummary = {
            total: 0,
            failed: 0,
            timeout: 0,
            p95: 0,
            retryRate: 0,
            duplicates: 0,
            avgCostUsd: 0,
            latestBucket: now
          };

          await upsertIncident({
            tenantId: policy.tenant_id,
            policy,
            workflowId: target.workflowId,
            env: target.env,
            now,
            summary,
            result: {
              triggered: true,
              observed: observedGap,
              zScore: observedGap,
              baseline: expected,
              summary: `missing heartbeat gap_sec=${Math.round(observedGap)} expected<=${expected * 3}`,
              minEventsMet: true
            }
          });
        } else {
          await clearIncidentIfStable({
            tenantId: policy.tenant_id,
            policyId: policy.id,
            workflowId: target.workflowId,
            env: target.env,
            now
          });
        }
        continue;
      }

      const summary = await queryWindowSummary({
        tenantId: policy.tenant_id,
        workflowId: target.workflowId,
        env: target.env,
        windowSec: policy.window_sec
      });

      const [rollingHistory, seasonalHistory] = await Promise.all([
        queryRollingHistory({
          tenantId: policy.tenant_id,
          workflowId: target.workflowId,
          env: target.env,
          windowSec: policy.window_sec
        }),
        querySeasonalHistory({
          tenantId: policy.tenant_id,
          workflowId: target.workflowId,
          env: target.env
        })
      ]);

      const result = evaluateMetric(policy, summary, rollingHistory, seasonalHistory);
      if (result.triggered) {
        await upsertIncident({
          tenantId: policy.tenant_id,
          policy,
          workflowId: target.workflowId,
          env: target.env,
          result,
          summary,
          now
        });
      } else {
        await clearIncidentIfStable({
          tenantId: policy.tenant_id,
          policyId: policy.id,
          workflowId: target.workflowId,
          env: target.env,
          now
        });
      }
    }
  }

  await markBreachedSla(now);
}
