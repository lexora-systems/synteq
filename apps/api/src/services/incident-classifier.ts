import type { IncidentType } from "@synteq/shared";

type IncidentClassifierInput = {
  policyMetric?: string | null;
  details?: Record<string, unknown>;
  anomalyType?: string | null;
  summary?: string | null;
};

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function metricToIncidentType(metric: string): IncidentType | null {
  if (metric === "duplicate_rate") {
    return "duplicate_webhook";
  }

  if (metric === "retry_rate") {
    return "retry_storm";
  }

  if (metric === "latency_p95" || metric === "latency_drift_ewma") {
    return "latency_spike";
  }

  if (metric === "failure_rate") {
    return "failure_rate_spike";
  }

  if (metric === "missing_heartbeat") {
    return "missing_heartbeat";
  }

  if (metric === "cost_spike") {
    return "cost_spike";
  }

  return null;
}

export function classifyIncidentType(input: IncidentClassifierInput): IncidentType {
  const details = input.details ?? {};
  const candidates = [
    asString(input.policyMetric),
    asString(input.anomalyType),
    asString(details.metric),
    asString(details.anomaly_type)
  ].filter((value): value is string => Boolean(value));

  for (const metric of candidates) {
    const mapped = metricToIncidentType(metric);
    if (mapped) {
      return mapped;
    }
  }

  const observedRetryRate = asNumber(details.retry_rate);
  const observedDuplicateRate = asNumber(details.duplicate_rate);
  const observedLatency = asNumber(details.p95_duration_ms);
  const observedCost = asNumber(details.avg_cost_usd);
  const failed = asNumber(details.failed);
  const total = asNumber(details.total);

  if (observedDuplicateRate !== null && observedDuplicateRate >= 0.05) {
    return "duplicate_webhook";
  }

  if (observedRetryRate !== null && observedRetryRate >= 0.2) {
    return "retry_storm";
  }

  if (observedLatency !== null && observedLatency > 0) {
    const baseline = asNumber(details.baseline);
    if (baseline !== null && baseline > 0 && observedLatency >= baseline * 1.5) {
      return "latency_spike";
    }
  }

  if (failed !== null && total !== null && total > 0 && failed / total >= 0.2) {
    return "failure_rate_spike";
  }

  if (observedCost !== null) {
    const baseline = asNumber(details.baseline);
    if (baseline !== null && baseline > 0 && observedCost >= baseline * 1.5) {
      return "cost_spike";
    }
  }

  const summary = (input.summary ?? "").toLowerCase();
  if (summary.includes("heartbeat")) {
    return "missing_heartbeat";
  }
  if (summary.includes("duplicate")) {
    return "duplicate_webhook";
  }
  if (summary.includes("retry")) {
    return "retry_storm";
  }
  if (summary.includes("latency")) {
    return "latency_spike";
  }
  if (summary.includes("failure")) {
    return "failure_rate_spike";
  }
  if (summary.includes("cost")) {
    return "cost_spike";
  }

  return "unknown";
}
