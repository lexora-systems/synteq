import type { ReliabilityScanRange, ReliabilityScanResult } from "@synteq/shared";
import { config } from "../config.js";
import { getBigQueryClient } from "../lib/bigquery.js";
import { prisma } from "../lib/prisma.js";
import { estimateMonthlyRiskUsd, localizeRiskEstimate } from "./risk-estimator.js";

const MIN_EVENTS_FOR_ENOUGH_DATA = 25;

type MetricsSummary = {
  count_total: number;
  count_success: number;
  duplicate_events_est: number;
  retry_events_est: number;
  p95_duration_ms: number;
  avg_cost_usd: number;
};

type ScanWindow = {
  from: Date;
  to: Date;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function safeRatio(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }

  return clamp(numerator / denominator, 0, 1);
}

function rangeToHours(range: ReliabilityScanRange): number {
  if (range === "24h") {
    return 24;
  }
  if (range === "30d") {
    return 24 * 30;
  }
  return 24 * 7;
}

function windowForRange(range: ReliabilityScanRange, now: Date): ScanWindow {
  const to = new Date(now);
  const from = new Date(now.getTime() - rangeToHours(range) * 60 * 60 * 1000);
  return { from, to };
}

async function queryMetricsSummary(params: {
  tenantId: string;
  workflowId: string;
  window: ScanWindow;
}): Promise<MetricsSummary> {
  const bq = getBigQueryClient();
  const [rows] = await bq.query({
    query: `
      SELECT
        COALESCE(SUM(count_total), 0) AS count_total,
        COALESCE(SUM(count_success), 0) AS count_success,
        COALESCE(SUM(duplicate_rate * count_total), 0) AS duplicate_events_est,
        COALESCE(SUM(retry_rate * count_total), 0) AS retry_events_est,
        COALESCE(AVG(p95_duration_ms), 0) AS p95_duration_ms,
        COALESCE(AVG(avg_cost_usd), 0) AS avg_cost_usd
      FROM \`${config.BIGQUERY_PROJECT_ID}.${config.BIGQUERY_DATASET}.workflow_metrics_minute\`
      WHERE tenant_id = @tenantId
        AND workflow_id = @workflowId
        AND bucket_ts >= @fromTs
        AND bucket_ts <= @toTs
    `,
    params: {
      tenantId: params.tenantId,
      workflowId: params.workflowId,
      fromTs: params.window.from.toISOString(),
      toTs: params.window.to.toISOString()
    },
    useLegacySql: false
  });

  const row = (rows[0] as Record<string, unknown> | undefined) ?? {};
  return {
    count_total: Math.round(asNumber(row.count_total)),
    count_success: Math.round(asNumber(row.count_success)),
    duplicate_events_est: asNumber(row.duplicate_events_est),
    retry_events_est: asNumber(row.retry_events_est),
    p95_duration_ms: asNumber(row.p95_duration_ms),
    avg_cost_usd: asNumber(row.avg_cost_usd)
  };
}

async function queryBaselineMetrics(params: {
  tenantId: string;
  workflowId: string;
  window: ScanWindow;
}): Promise<{ baseline_p95_duration_ms: number; baseline_avg_cost_usd: number }> {
  const bq = getBigQueryClient();
  const durationMs = params.window.to.getTime() - params.window.from.getTime();
  const baselineFrom = new Date(params.window.from.getTime() - durationMs);
  const baselineTo = new Date(params.window.from);

  const [rows] = await bq.query({
    query: `
      SELECT
        COALESCE(AVG(p95_duration_ms), 0) AS baseline_p95_duration_ms,
        COALESCE(AVG(avg_cost_usd), 0) AS baseline_avg_cost_usd
      FROM \`${config.BIGQUERY_PROJECT_ID}.${config.BIGQUERY_DATASET}.workflow_metrics_minute\`
      WHERE tenant_id = @tenantId
        AND workflow_id = @workflowId
        AND bucket_ts >= @baselineFrom
        AND bucket_ts < @baselineTo
    `,
    params: {
      tenantId: params.tenantId,
      workflowId: params.workflowId,
      baselineFrom: baselineFrom.toISOString(),
      baselineTo: baselineTo.toISOString()
    },
    useLegacySql: false
  });

  const row = (rows[0] as Record<string, unknown> | undefined) ?? {};
  return {
    baseline_p95_duration_ms: asNumber(row.baseline_p95_duration_ms),
    baseline_avg_cost_usd: asNumber(row.baseline_avg_cost_usd)
  };
}

export function computeLatencyHealthScore(params: {
  p95DurationMs: number;
  baselineP95DurationMs: number;
  enoughData: boolean;
}): number {
  if (params.p95DurationMs <= 0) {
    return params.enoughData ? 100 : 65;
  }

  if (params.baselineP95DurationMs > 0 && params.enoughData) {
    const ratio = params.p95DurationMs / params.baselineP95DurationMs;
    if (ratio <= 1) {
      return 100;
    }

    if (ratio >= 3) {
      return 0;
    }

    const score = 100 - ((ratio - 1) / 2) * 100;
    return Math.round(clamp(score, 0, 100));
  }

  if (params.p95DurationMs <= 1_000) {
    return 90;
  }
  if (params.p95DurationMs <= 3_000) {
    return 70;
  }
  if (params.p95DurationMs <= 7_500) {
    return 45;
  }
  return 20;
}

export function calculateReliabilityScore(input: {
  successRate: number;
  duplicateRate: number;
  retryRate: number;
  latencyHealthScore: number;
}): number {
  const score =
    clamp(input.successRate, 0, 1) * 50 +
    (1 - clamp(input.duplicateRate, 0, 1)) * 20 +
    (1 - clamp(input.retryRate, 0, 1)) * 15 +
    (clamp(input.latencyHealthScore, 0, 100) / 100) * 15;

  return Math.round(clamp(score, 0, 100));
}

export function deriveScanFlags(input: {
  successRate: number;
  duplicateRate: number;
  retryRate: number;
  latencyHealthScore: number;
  p95DurationMs: number;
  baselineP95DurationMs: number;
  avgCostUsd: number;
  baselineAvgCostUsd: number;
}): string[] {
  const flags: string[] = [];

  if (input.duplicateRate >= 0.02) {
    flags.push("duplicate_risk");
  }
  if (input.retryRate >= 0.12) {
    flags.push("retry_storm_risk");
  }
  if (input.successRate <= 0.95) {
    flags.push("failure_risk");
  }

  const latencyRatio =
    input.baselineP95DurationMs > 0 ? input.p95DurationMs / input.baselineP95DurationMs : input.latencyHealthScore <= 65 ? 1.6 : 1;
  if (input.latencyHealthScore <= 65 || latencyRatio >= 1.5) {
    flags.push("latency_risk");
  }

  const hasCostBaseline = input.baselineAvgCostUsd > 0;
  if (hasCostBaseline && input.avgCostUsd / input.baselineAvgCostUsd >= 1.5) {
    flags.push("cost_risk");
  }

  return flags;
}

function buildRecommendation(flags: string[], enoughData: boolean): string {
  if (!enoughData) {
    return "Not enough live data for a confident score yet. Run a simulation to validate incident detection and guidance.";
  }

  if (flags.length === 0) {
    return "Workflow reliability looks stable. Keep monitoring and run simulations periodically to validate controls.";
  }

  if (flags.includes("failure_risk")) {
    return "Failure risk is elevated. Inspect dominant errors, recent deploy/config changes, and replay failed runs after remediation.";
  }
  if (flags.includes("retry_storm_risk")) {
    return "Retry pressure is elevated. Review retry backoff policies and downstream dependency health to avoid cascading load.";
  }
  if (flags.includes("duplicate_risk")) {
    return "Duplicate webhook risk is elevated. Enforce idempotency key checks and short-TTL execution dedupe at workflow entry.";
  }
  if (flags.includes("latency_risk")) {
    return "Latency is degraded. Inspect p95 bottlenecks, worker saturation, and downstream service response times.";
  }

  return "Cost pressure is elevated. Review model/runtime changes and correlate with retry/duplicate behavior.";
}

function projectMonthlyVolume(totalEvents: number, windowFrom: Date, windowTo: Date): number {
  const windowHours = Math.max(1, (windowTo.getTime() - windowFrom.getTime()) / (60 * 60 * 1000));
  const hourly = totalEvents / windowHours;
  return Math.max(0, Math.round(hourly * 24 * 30));
}

export async function runReliabilityScan(params: {
  tenantId: string;
  workflowId: string;
  range?: ReliabilityScanRange;
}): Promise<ReliabilityScanResult> {
  const now = new Date();
  const requestedRange = params.range ?? "7d";
  const primaryWindow = windowForRange(requestedRange, now);
  let selectedWindow = primaryWindow;
  let summary = await queryMetricsSummary({
    tenantId: params.tenantId,
    workflowId: params.workflowId,
    window: primaryWindow
  });

  if (!params.range && summary.count_total < MIN_EVENTS_FOR_ENOUGH_DATA) {
    const fallbackWindow = windowForRange("24h", now);
    const fallbackSummary = await queryMetricsSummary({
      tenantId: params.tenantId,
      workflowId: params.workflowId,
      window: fallbackWindow
    });

    if (fallbackSummary.count_total > summary.count_total) {
      summary = fallbackSummary;
      selectedWindow = fallbackWindow;
    }
  }

  const enoughData = summary.count_total >= MIN_EVENTS_FOR_ENOUGH_DATA;
  const [baseline, workflow, tenant] = await Promise.all([
    queryBaselineMetrics({
      tenantId: params.tenantId,
      workflowId: params.workflowId,
      window: selectedWindow
    }),
    prisma.workflow.findFirst({
      where: {
        id: params.workflowId,
        tenant_id: params.tenantId
      },
      select: {
        display_name: true
      }
    }),
    prisma.tenant.findUnique({
      where: {
        id: params.tenantId
      },
      select: {
        default_currency: true
      }
    })
  ]);

  const successRate = safeRatio(summary.count_success, summary.count_total);
  const duplicateRate = safeRatio(summary.duplicate_events_est, summary.count_total);
  const retryRate = safeRatio(summary.retry_events_est, summary.count_total);
  const latencyHealthScore = computeLatencyHealthScore({
    p95DurationMs: summary.p95_duration_ms,
    baselineP95DurationMs: baseline.baseline_p95_duration_ms,
    enoughData
  });
  const reliabilityScore = calculateReliabilityScore({
    successRate,
    duplicateRate,
    retryRate,
    latencyHealthScore
  });

  const anomalyFlags = deriveScanFlags({
    successRate,
    duplicateRate,
    retryRate,
    latencyHealthScore,
    p95DurationMs: summary.p95_duration_ms,
    baselineP95DurationMs: baseline.baseline_p95_duration_ms,
    avgCostUsd: summary.avg_cost_usd,
    baselineAvgCostUsd: baseline.baseline_avg_cost_usd
  });
  const estimatedMonthlyRiskUsd = estimateMonthlyRiskUsd({
    monthlyEventVolume: projectMonthlyVolume(summary.count_total, selectedWindow.from, selectedWindow.to),
    successRate,
    duplicateRate,
    retryRate
  });
  const localizedRisk = localizeRiskEstimate(estimatedMonthlyRiskUsd, tenant?.default_currency);

  return {
    workflow_id: params.workflowId,
    workflow_name: workflow?.display_name,
    scan_window: {
      from: selectedWindow.from.toISOString(),
      to: selectedWindow.to.toISOString()
    },
    reliability_score: reliabilityScore,
    success_rate: Number(successRate.toFixed(4)),
    duplicate_rate: Number(duplicateRate.toFixed(4)),
    retry_rate: Number(retryRate.toFixed(4)),
    latency_health_score: latencyHealthScore,
    anomaly_flags: anomalyFlags,
    estimated_monthly_risk_usd: localizedRisk.amount_usd,
    estimated_monthly_risk: localizedRisk.amount,
    currency: localizedRisk.currency,
    conversion_rate: localizedRisk.conversion_rate,
    recommendation: buildRecommendation(anomalyFlags, enoughData),
    enough_data: enoughData,
    generated_by: "scan_rules_v1"
  };
}
