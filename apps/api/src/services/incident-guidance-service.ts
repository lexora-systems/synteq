import type { Incident, IncidentEvent } from "@prisma/client";
import type { IncidentConfidence, IncidentGuidance, IncidentType } from "@synteq/shared";
import { classifyIncidentType } from "./incident-classifier.js";
import { TemplateIncidentNarrator } from "./incident-guidance-narrator.js";

type IncidentWithContext = Incident & {
  policy?: {
    metric?: string | null;
    name?: string | null;
  } | null;
  workflow?: {
    id: string;
    display_name: string;
    environment: string;
  } | null;
};

type IncidentGuidanceInput = {
  incident: IncidentWithContext;
  recentEvents?: IncidentEvent[];
};

type IncidentRuleResult = {
  likely_causes: string[];
  business_impact: string;
  recommended_actions: string[];
  confidence: IncidentConfidence;
};

const narrator = new TemplateIncidentNarrator();

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

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

function duplicateConfidence(details: Record<string, unknown>): IncidentConfidence {
  const duplicateRate = asNumber(details.duplicate_rate) ?? asNumber(details.observed);
  const zScore = asNumber(details.z_score);
  if ((duplicateRate !== null && duplicateRate >= 0.1) || (zScore !== null && zScore >= 3)) {
    return "high";
  }

  return "medium";
}

function retryConfidence(details: Record<string, unknown>): IncidentConfidence {
  const retryRate = asNumber(details.retry_rate) ?? asNumber(details.observed);
  const failed = asNumber(details.failed);
  const total = asNumber(details.total);
  const failureRate = failed !== null && total !== null && total > 0 ? failed / total : null;
  if (retryRate !== null && retryRate >= 0.2 && failureRate !== null && failureRate >= 0.1) {
    return "high";
  }

  return "medium";
}

function latencyConfidence(details: Record<string, unknown>): IncidentConfidence {
  const observed = asNumber(details.observed) ?? asNumber(details.p95_duration_ms);
  const baseline = asNumber(details.baseline);
  const zScore = asNumber(details.z_score);
  if (
    (observed !== null && baseline !== null && baseline > 0 && observed >= baseline * 1.5) ||
    (zScore !== null && zScore >= 3)
  ) {
    return "high";
  }

  return "medium";
}

function failureConfidence(details: Record<string, unknown>): IncidentConfidence {
  const errorConcentration = asNumber(details.error_class_share);
  const dominantErrorClass = asString(details.error_class);
  if ((errorConcentration !== null && errorConcentration >= 0.6) || dominantErrorClass) {
    return "high";
  }

  return "medium";
}

function costConfidence(details: Record<string, unknown>): IncidentConfidence {
  const observed = asNumber(details.observed) ?? asNumber(details.avg_cost_usd);
  const baseline = asNumber(details.baseline);
  if (observed !== null && baseline !== null && baseline > 0 && observed >= baseline * 1.5) {
    return "high";
  }

  return "medium";
}

function buildRuleResult(type: IncidentType, details: Record<string, unknown>): IncidentRuleResult {
  if (type === "duplicate_webhook") {
    return {
      likely_causes: [
        "upstream sender retrying without idempotency enforcement",
        "missing execution_id dedupe in workflow",
        "webhook delivery duplication from provider"
      ],
      business_impact:
        "Duplicate processing can create duplicate orders, duplicate fulfillment, and customer/account state inconsistency.",
      recommended_actions: [
        "Enforce idempotency key or execution_id validation.",
        "Suppress duplicate execution IDs for a short TTL.",
        "Inspect sender retry configuration.",
        "Review duplicate event sources in recent metrics."
      ],
      confidence: duplicateConfidence(details)
    };
  }

  if (type === "retry_storm") {
    return {
      likely_causes: [
        "upstream dependency degradation",
        "overly aggressive retry policy",
        "timeout threshold too low",
        "failing downstream endpoint causing repeated retries"
      ],
      business_impact:
        "Retry storms increase infrastructure cost, delay workflow completion, and can amplify customer-facing failures.",
      recommended_actions: [
        "Increase exponential backoff.",
        "Inspect downstream API health.",
        "Cap max retry attempts temporarily.",
        "Pause noisy workflow if needed."
      ],
      confidence: retryConfidence(details)
    };
  }

  if (type === "latency_spike") {
    return {
      likely_causes: [
        "downstream API slowdown",
        "database contention",
        "queue backlog or worker saturation",
        "cold starts or insufficient concurrency"
      ],
      business_impact: "Latency spikes delay automations, increase SLA risk, and degrade user or customer experience.",
      recommended_actions: [
        "Inspect p95 latency by workflow step.",
        "Review downstream dependency health.",
        "Scale worker concurrency or reduce load.",
        "Inspect DB and queue utilization."
      ],
      confidence: latencyConfidence(details)
    };
  }

  if (type === "failure_rate_spike") {
    return {
      likely_causes: [
        "auth or credential failures",
        "upstream 5xx responses",
        "payload or schema mismatch",
        "deployment or configuration regression"
      ],
      business_impact:
        "Failure spikes can break automations, cause lost or incomplete workflows, and create revenue-impacting disruption.",
      recommended_actions: [
        "Inspect dominant error_class.",
        "Compare against recent deploy or config changes.",
        "Verify credentials and API keys.",
        "Replay failed executions after fix if supported."
      ],
      confidence: failureConfidence(details)
    };
  }

  if (type === "missing_heartbeat") {
    return {
      likely_causes: ["worker or cron stopped running", "scheduler misfire", "service crash", "network partition"],
      business_impact: "Missing heartbeat means workflow inactivity, missed scheduled tasks, and delayed business operations.",
      recommended_actions: [
        "Verify scheduler and worker status.",
        "Inspect service uptime and logs.",
        "Restart job runner if safe.",
        "Confirm heartbeat interval configuration."
      ],
      confidence: "medium"
    };
  }

  if (type === "cost_spike") {
    return {
      likely_causes: ["AI prompt/output inflation", "runaway retries", "model or config change", "duplicate processing"],
      business_impact: "Cost spikes create unexpected API spend, margin erosion, and budget overrun risk.",
      recommended_actions: [
        "Cap max tokens and request limits.",
        "Inspect recent prompt or model changes.",
        "Correlate with retry and duplicate anomalies.",
        "Temporarily reduce traffic or model tier if needed."
      ],
      confidence: costConfidence(details)
    };
  }

  return {
    likely_causes: ["Unable to determine a dominant cause from current signals."],
    business_impact:
      "An incident is active and may impact workflow reliability, SLA compliance, and downstream business operations.",
    recommended_actions: [
      "Inspect recent incident metrics for the affected workflow.",
      "Review service logs around incident start time.",
      "Compare recent workflow, infrastructure, and configuration changes."
    ],
    confidence: "low"
  };
}

function buildEvidence(input: {
  details: Record<string, unknown>;
  incident: IncidentWithContext;
  incidentType: IncidentType;
  recentEvents: IncidentEvent[];
}) {
  const evidence: string[] = [];
  const metric = asString(input.details.metric) ?? input.incident.policy?.metric ?? "unknown_metric";
  evidence.push(`metric=${metric}`);
  evidence.push(`incident_type=${input.incidentType}`);

  const observed = asNumber(input.details.observed);
  const baseline = asNumber(input.details.baseline);
  const zScore = asNumber(input.details.z_score);
  if (observed !== null) {
    evidence.push(`observed=${observed}`);
  }
  if (baseline !== null) {
    evidence.push(`baseline=${baseline}`);
  }
  if (zScore !== null) {
    evidence.push(`z_score=${zScore.toFixed(2)}`);
  }

  const retryRate = asNumber(input.details.retry_rate);
  if (retryRate !== null) {
    evidence.push(`retry_rate=${retryRate.toFixed(4)}`);
  }

  const duplicateRate = asNumber(input.details.duplicate_rate);
  if (duplicateRate !== null) {
    evidence.push(`duplicate_rate=${duplicateRate.toFixed(4)}`);
  }

  const avgCost = asNumber(input.details.avg_cost_usd);
  if (avgCost !== null) {
    evidence.push(`avg_cost_usd=${avgCost.toFixed(6)}`);
  }

  const errorClass = asString(input.details.error_class);
  if (errorClass) {
    evidence.push(`error_class=${errorClass}`);
  }

  if (input.recentEvents.length > 0) {
    const recentTypes = input.recentEvents.slice(0, 5).map((event) => event.event_type);
    evidence.push(`recent_events=${recentTypes.join(",")}`);
  }

  return evidence;
}

export async function generateIncidentGuidance(input: IncidentGuidanceInput): Promise<IncidentGuidance> {
  const details = asObject(input.incident.details_json);
  const incidentType = classifyIncidentType({
    policyMetric: input.incident.policy?.metric,
    details,
    anomalyType: asString(details.anomaly_type),
    summary: input.incident.summary
  });

  const ruleResult = buildRuleResult(incidentType, details);
  const recentEvents = input.recentEvents ?? [];
  const evidence = buildEvidence({
    details,
    incident: input.incident,
    incidentType,
    recentEvents
  });

  const narration = await narrator.narrate({
    incident_type: incidentType,
    likely_causes: ruleResult.likely_causes,
    business_impact: ruleResult.business_impact,
    recommended_actions: ruleResult.recommended_actions,
    confidence: ruleResult.confidence,
    evidence,
    workflow_id: input.incident.workflow?.display_name ?? input.incident.workflow_id,
    environment: input.incident.environment
  });

  return {
    incident_type: incidentType,
    likely_causes: ruleResult.likely_causes,
    business_impact: ruleResult.business_impact,
    recommended_actions: ruleResult.recommended_actions,
    confidence: ruleResult.confidence,
    evidence,
    generated_by: "rules_v1",
    summary_text: narration.summary_text
  };
}
