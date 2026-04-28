import {
  ingestOperationalEventsRequestSchema,
  type GenericWorkflowSourceType,
  type IngestWorkflowEventInput
} from "@synteq/shared";
import { ingestOperationalEvents, type IngestOperationalEventsResult } from "./operational-event-ingestion-service.js";
import type { OperationalSourceOwner } from "./ingest-source-ownership-service.js";
import { handleGenericWorkflowEventDetection } from "./generic-workflow-incident-service.js";

export const genericWorkflowSourceTypes = ["webhook", "n8n", "make", "zapier"] as const;

export type GenericWorkflowSourceTypeValue = (typeof genericWorkflowSourceTypes)[number];
export type NormalizedWorkflowEventStatus = "started" | "succeeded" | "failed" | "cancelled" | "timed_out";

export type WorkflowEventIngestionResult = IngestOperationalEventsResult & {
  normalized_status: NormalizedWorkflowEventStatus;
  source_type: IngestWorkflowEventInput["source_type"];
};

export function isGenericWorkflowSourceType(value: string): value is GenericWorkflowSourceType {
  return genericWorkflowSourceTypes.includes(value as GenericWorkflowSourceType);
}

export function normalizeWorkflowEventStatus(status: string): NormalizedWorkflowEventStatus {
  const normalized = status.trim().toLowerCase();

  if (normalized === "success") {
    return "succeeded";
  }

  if (normalized === "timeout") {
    return "timed_out";
  }

  if (normalized === "canceled") {
    return "cancelled";
  }

  return normalized as NormalizedWorkflowEventStatus;
}

function workflowEventTypeForStatus(status: NormalizedWorkflowEventStatus) {
  return `workflow_execution_${status}`;
}

function workflowSeverityForStatus(status: NormalizedWorkflowEventStatus): "low" | "medium" | "high" | undefined {
  if (status === "failed" || status === "timed_out") {
    return "high";
  }

  if (status === "cancelled") {
    return "medium";
  }

  if (status === "succeeded") {
    return "low";
  }

  return undefined;
}

function operationalSourceForWorkflowSourceType(sourceType: IngestWorkflowEventInput["source_type"]) {
  return sourceType;
}

export function workflowEventIdempotencyKey(input: {
  sourceType: IngestWorkflowEventInput["source_type"];
  sourceIdentity: string;
  workflowId: string;
  executionId: string;
  status: NormalizedWorkflowEventStatus;
  occurredAt: Date;
}) {
  return [
    input.sourceType,
    input.sourceIdentity,
    input.workflowId,
    input.executionId,
    input.status,
    input.occurredAt.toISOString()
  ].join("|");
}

export function looksSynthetic(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.simulation === true || record.synthetic === true;
}

export function isSimulationWorkflowEvent(body: { metadata?: Record<string, unknown> }) {
  return looksSynthetic(body.metadata);
}

export async function ingestWorkflowExecutionEvent(
  body: IngestWorkflowEventInput,
  context: {
    tenantId: string;
    apiKeyId?: string;
    requestId: string;
    sourceOwner?: OperationalSourceOwner;
  }
): Promise<WorkflowEventIngestionResult> {
  const normalizedStatus = normalizeWorkflowEventStatus(body.status);
  const occurredAt = body.timestamp ?? body.started_at ?? new Date();
  const sourceIdentity = body.source_key ?? body.source_id ?? "source";
  const source = operationalSourceForWorkflowSourceType(body.source_type);

  const mapped = ingestOperationalEventsRequestSchema.parse({
    event: {
      source,
      event_type: workflowEventTypeForStatus(normalizedStatus),
      service: body.workflow_name,
      system: `${body.source_type}:${body.workflow_id}`,
      environment: body.environment,
      timestamp: occurredAt,
      severity: workflowSeverityForStatus(normalizedStatus),
      correlation_key: `${body.source_type}:${body.workflow_id}:${body.execution_id}`,
      metadata: {
        event_kind: "workflow_execution",
        provider: body.source_type,
        source_type: body.source_type,
        source_id: body.source_id ?? null,
        source_key: body.source_key ?? null,
        workflow_id: body.workflow_id,
        workflow_name: body.workflow_name,
        execution_id: body.execution_id,
        status: normalizedStatus,
        started_at: body.started_at ? body.started_at.toISOString() : null,
        finished_at: body.finished_at ? body.finished_at.toISOString() : null,
        duration_ms: body.duration_ms ?? null,
        error_message: body.error_message ?? null,
        environment: body.environment ?? null,
        metadata: body.metadata ?? {}
      }
    }
  });

  const result = await ingestOperationalEvents(mapped, {
    tenantId: context.tenantId,
    apiKeyId: context.apiKeyId,
    requestId: context.requestId,
    idempotencyHints: [
      {
        namespace: "workflow_execution_event",
        upstreamKey: workflowEventIdempotencyKey({
          sourceType: body.source_type,
          sourceIdentity,
          workflowId: body.workflow_id,
          executionId: body.execution_id,
          status: normalizedStatus,
          occurredAt
        })
      }
    ],
    sourceOwner: context.sourceOwner
  });

  await handleGenericWorkflowEventDetection({
    tenantId: context.tenantId,
    body,
    normalizedStatus,
    ingested: result.ingested
  });

  return {
    ...result,
    normalized_status: normalizedStatus,
    source_type: body.source_type
  };
}
