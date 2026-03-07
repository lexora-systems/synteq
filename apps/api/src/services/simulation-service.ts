import { randomUUID } from "node:crypto";
import type { IngestExecutionInput, SimulationScenario, SimulationResult } from "@synteq/shared";
import { prisma } from "../lib/prisma.js";
import { enqueueExecutionEvent } from "./ingest-queue-service.js";

const EVENTS_PER_SIMULATION = 36;

type ScenarioPolicyConfig = {
  metric: string;
  threshold: number;
  minEvents: number;
  severity: "warn" | "low" | "medium" | "high" | "critical";
  comparator: "gt" | "gte" | "lt" | "lte" | "eq";
  summaryRecommendation: string;
};

const scenarioPolicyMap: Record<SimulationScenario, ScenarioPolicyConfig> = {
  "webhook-failure": {
    metric: "failure_rate",
    threshold: 0.2,
    minEvents: 20,
    severity: "high",
    comparator: "gte",
    summaryRecommendation: "Run anomaly and incident jobs, then open the incident detail to review guidance for failure spikes."
  },
  "retry-storm": {
    metric: "retry_rate",
    threshold: 0.12,
    minEvents: 20,
    severity: "high",
    comparator: "gte",
    summaryRecommendation: "Run anomaly and incident jobs, then verify retry storm guidance and recommended backoff actions."
  },
  "latency-spike": {
    metric: "latency_p95",
    threshold: 4000,
    minEvents: 20,
    severity: "medium",
    comparator: "gte",
    summaryRecommendation: "Run anomaly and incident jobs, then check latency spike guidance and p95 evidence."
  },
  "duplicate-webhook": {
    metric: "duplicate_rate",
    threshold: 0.02,
    minEvents: 20,
    severity: "high",
    comparator: "gte",
    summaryRecommendation: "Run anomaly and incident jobs, then open incidents to verify duplicate webhook diagnosis and idempotency actions."
  }
};

function buildBaseEvent(input: {
  tenantId: string;
  workflowId: string;
  workflowSlug: string;
  environment: string;
  batchId: string;
  scenario: SimulationScenario;
  index: number;
  now: Date;
}): IngestExecutionInput {
  return {
    event_ts: new Date(input.now.getTime() - (EVENTS_PER_SIMULATION - input.index) * 1_000),
    tenant_id: input.tenantId,
    workflow_id: input.workflowId,
    workflow_slug: input.workflowSlug,
    environment: input.environment,
    execution_id: `sim-${input.batchId}-${input.index}`,
    run_id: `sim-run-${input.batchId}`,
    status: "success",
    duration_ms: 420,
    retry_count: 0,
    token_in: 200,
    token_out: 120,
    cost_estimate_usd: 0.02,
    payload: {
      simulation: true,
      scenario: input.scenario,
      batch_id: input.batchId,
      synthetic_index: input.index
    }
  };
}

function buildScenarioEvent(input: {
  base: IngestExecutionInput;
  scenario: SimulationScenario;
  index: number;
  batchId: string;
}): IngestExecutionInput {
  if (input.scenario === "webhook-failure") {
    return {
      ...input.base,
      status: input.index % 5 === 0 ? "timeout" : "failed",
      retry_count: input.index % 3,
      duration_ms: 800 + input.index * 25,
      error_class: "WebhookDeliveryError",
      error_message: "Synthetic webhook downstream failure for simulation."
    };
  }

  if (input.scenario === "retry-storm") {
    return {
      ...input.base,
      status: input.index % 6 === 0 ? "success" : input.index % 2 === 0 ? "failed" : "timeout",
      retry_count: 3 + (input.index % 4),
      duration_ms: 1200 + input.index * 40,
      error_class: input.index % 2 === 0 ? "UpstreamTimeout" : "Dependency5xx",
      error_message: "Synthetic retry storm pressure event."
    };
  }

  if (input.scenario === "latency-spike") {
    return {
      ...input.base,
      status: input.index % 10 === 0 ? "failed" : "success",
      retry_count: input.index % 2,
      duration_ms: 7_000 + input.index * 120,
      error_class: input.index % 10 === 0 ? "TimeoutExceeded" : undefined,
      error_message: input.index % 10 === 0 ? "Synthetic latency spike timeout." : undefined
    };
  }

  return {
    ...input.base,
    execution_id: `sim-dup-${input.batchId}-${Math.floor(input.index / 6)}`,
    status: "success",
    retry_count: 0,
    duration_ms: 450 + input.index * 10
  };
}

function buildFingerprintOverride(input: {
  tenantId: string;
  workflowId: string;
  scenario: SimulationScenario;
  batchId: string;
  index: number;
}) {
  return `${input.tenantId}:${input.workflowId}:${input.scenario}:${input.batchId}:${input.index}`;
}

async function ensureScenarioPolicy(input: {
  tenantId: string;
  workflowId: string;
  environment: string;
  scenario: SimulationScenario;
}) {
  const policyConfig = scenarioPolicyMap[input.scenario];
  const existing = await prisma.alertPolicy.findFirst({
    where: {
      tenant_id: input.tenantId,
      metric: policyConfig.metric,
      filter_workflow_id: input.workflowId,
      filter_env: input.environment,
      is_enabled: true
    },
    select: {
      id: true
    }
  });

  if (existing) {
    return existing.id;
  }

  const created = await prisma.alertPolicy.create({
    data: {
      tenant_id: input.tenantId,
      name: `Synteq Simulation ${input.scenario}`,
      metric: policyConfig.metric,
      window_sec: 300,
      threshold: policyConfig.threshold,
      comparator: policyConfig.comparator,
      min_events: policyConfig.minEvents,
      severity: policyConfig.severity,
      is_enabled: true,
      filter_workflow_id: input.workflowId,
      filter_env: input.environment
    },
    select: {
      id: true
    }
  });

  return created.id;
}

export async function runSimulationScenario(params: {
  tenantId: string;
  workflowId: string;
  scenario: SimulationScenario;
  requestId: string;
}): Promise<SimulationResult> {
  const workflow = await prisma.workflow.findFirst({
    where: {
      id: params.workflowId,
      tenant_id: params.tenantId,
      is_active: true
    },
    select: {
      id: true,
      slug: true,
      environment: true
    }
  });

  if (!workflow) {
    const error = new Error("Workflow not found");
    error.name = "NotFoundError";
    throw error;
  }

  const batchId = randomUUID();
  await ensureScenarioPolicy({
    tenantId: params.tenantId,
    workflowId: workflow.id,
    environment: workflow.environment,
    scenario: params.scenario
  });

  let queuedEvents = 0;
  let directEvents = 0;
  const now = new Date();

  for (let index = 0; index < EVENTS_PER_SIMULATION; index += 1) {
    const base = buildBaseEvent({
      tenantId: params.tenantId,
      workflowId: workflow.id,
      workflowSlug: workflow.slug,
      environment: workflow.environment,
      batchId,
      scenario: params.scenario,
      index,
      now
    });
    const scenarioEvent = buildScenarioEvent({
      base,
      scenario: params.scenario,
      index,
      batchId
    });

    const fingerprintOverride =
      params.scenario === "duplicate-webhook"
        ? buildFingerprintOverride({
            tenantId: params.tenantId,
            workflowId: workflow.id,
            scenario: params.scenario,
            batchId,
            index
          })
        : undefined;

    const outcome = await enqueueExecutionEvent(scenarioEvent, `${params.requestId}-${index}`, {
      fingerprintOverride
    });
    if (outcome.queued) {
      queuedEvents += 1;
    } else {
      directEvents += 1;
    }
  }

  return {
    scenario: params.scenario,
    workflow_id: workflow.id,
    batch_id: batchId,
    injected_events: EVENTS_PER_SIMULATION,
    queued_events: queuedEvents,
    direct_events: directEvents,
    recommendation: scenarioPolicyMap[params.scenario].summaryRecommendation
  };
}

