import type { Prisma } from "@prisma/client";
import type { IngestWorkflowEventInput } from "@synteq/shared";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../utils/crypto.js";
import { openOrRefreshBridgeIncident, resolveBridgeIncident } from "./incidents-service.js";

type GenericWorkflowStatus = "started" | "succeeded" | "failed" | "cancelled" | "timed_out";
type GenericWorkflowSourceType = "webhook" | "n8n" | "make" | "zapier";
type GenericWorkflowRule = "failed" | "timed_out";

export type GenericWorkflowDetectionAction =
  | "skipped"
  | "incident_created"
  | "incident_updated"
  | "incident_reopened"
  | "incident_resolved"
  | "recovery_noop";

export type GenericWorkflowDetectionResult = {
  action: GenericWorkflowDetectionAction;
  rule?: GenericWorkflowRule;
  incidentId?: string;
};

const genericWorkflowSources = new Set<string>(["webhook", "n8n", "make", "zapier"]);

function isGenericWorkflowSourceType(value: string): value is GenericWorkflowSourceType {
  return genericWorkflowSources.has(value);
}

function sourceIdentity(body: IngestWorkflowEventInput) {
  return body.source_id ?? body.source_key ?? "source";
}

function fingerprintFor(input: {
  tenantId: string;
  sourceType: GenericWorkflowSourceType;
  sourceIdentity: string;
  workflowId: string;
  environment: string | null;
  rule: GenericWorkflowRule;
}) {
  return sha256(
    [
      "generic_workflow",
      input.tenantId,
      input.sourceType,
      input.sourceIdentity,
      input.workflowId,
      input.environment ?? "default",
      input.rule
    ].join("|")
  );
}

function metadataObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function occurredAtFor(body: IngestWorkflowEventInput) {
  return body.timestamp ?? body.started_at ?? new Date();
}

function hasMarker(metadata: Record<string, unknown>, key: "synthetic" | "test") {
  return metadata[key] === true;
}

function buildContext(input: {
  body: IngestWorkflowEventInput;
  normalizedStatus: GenericWorkflowStatus;
  occurredAt: Date;
}) {
  const metadata = metadataObject(input.body.metadata);
  return {
    source: "generic_workflow_event_detection",
    sourceType: input.body.source_type,
    sourceId: input.body.source_id ?? null,
    sourceKey: input.body.source_key ?? null,
    workflowId: input.body.workflow_id,
    workflowName: input.body.workflow_name,
    executionId: input.body.execution_id,
    status: input.normalizedStatus,
    durationMs: input.body.duration_ms ?? null,
    errorMessage: input.body.error_message ?? null,
    environment: input.body.environment ?? null,
    occurredAt: input.occurredAt.toISOString(),
    synthetic: hasMarker(metadata, "synthetic"),
    test: hasMarker(metadata, "test"),
    metadata
  } satisfies Record<string, unknown>;
}

function titleFor(input: { rule: GenericWorkflowRule; workflowName: string }) {
  if (input.rule === "timed_out") {
    return `Workflow timed out: ${input.workflowName}`;
  }
  return `Workflow failed: ${input.workflowName}`;
}

function severityFor(rule: GenericWorkflowRule) {
  return rule === "timed_out" ? "high" : "medium";
}

async function findActiveGenericWorkflowIncident(input: { tenantId: string; fingerprint: string }) {
  return prisma.incident.findFirst({
    where: {
      tenant_id: input.tenantId,
      fingerprint: input.fingerprint,
      status: {
        in: ["open", "acked"]
      }
    },
    orderBy: {
      started_at: "desc"
    },
    select: {
      id: true
    }
  });
}

async function appendRecoveryContext(input: {
  incidentId: string;
  context: Record<string, unknown>;
  occurredAt: Date;
}) {
  await prisma.incidentEvent.create({
    data: {
      incident_id: input.incidentId,
      event_type: "GENERIC_WORKFLOW_RECOVERY",
      payload_json: {
        ...input.context,
        at: input.occurredAt.toISOString()
      } as Prisma.InputJsonValue
    }
  });
}

async function resolveMatchingGenericWorkflowIncidents(input: {
  tenantId: string;
  body: IngestWorkflowEventInput;
  sourceType: GenericWorkflowSourceType;
  sourceIdentity: string;
  context: Record<string, unknown>;
  occurredAt: Date;
}): Promise<GenericWorkflowDetectionResult> {
  let resolvedIncidentId: string | null = null;

  for (const rule of ["failed", "timed_out"] as const) {
    const fingerprint = fingerprintFor({
      tenantId: input.tenantId,
      sourceType: input.sourceType,
      sourceIdentity: input.sourceIdentity,
      workflowId: input.body.workflow_id,
      environment: input.body.environment ?? null,
      rule
    });
    const incident = await findActiveGenericWorkflowIncident({
      tenantId: input.tenantId,
      fingerprint
    });

    if (!incident) {
      continue;
    }

    const resolution = await resolveBridgeIncident({
      tenantId: input.tenantId,
      incidentId: incident.id,
      resolvedAt: input.occurredAt,
      reason: `generic_workflow_recovered:${rule}`
    });

    if (resolution.resolved) {
      await appendRecoveryContext({
        incidentId: incident.id,
        context: input.context,
        occurredAt: input.occurredAt
      });
      resolvedIncidentId = incident.id;
    }
  }

  if (!resolvedIncidentId) {
    return {
      action: "recovery_noop"
    };
  }

  return {
    action: "incident_resolved",
    incidentId: resolvedIncidentId
  };
}

export async function handleGenericWorkflowEventDetection(input: {
  tenantId: string;
  body: IngestWorkflowEventInput;
  normalizedStatus: GenericWorkflowStatus;
  ingested: number;
}): Promise<GenericWorkflowDetectionResult> {
  if (input.ingested <= 0) {
    return {
      action: "skipped"
    };
  }

  if (!isGenericWorkflowSourceType(input.body.source_type)) {
    return {
      action: "skipped"
    };
  }

  const sourceType = input.body.source_type;
  const sourceId = sourceIdentity(input.body);
  const occurredAt = occurredAtFor(input.body);
  const context = buildContext({
    body: input.body,
    normalizedStatus: input.normalizedStatus,
    occurredAt
  });

  if (input.normalizedStatus === "succeeded") {
    return resolveMatchingGenericWorkflowIncidents({
      tenantId: input.tenantId,
      body: input.body,
      sourceType,
      sourceIdentity: sourceId,
      context,
      occurredAt
    });
  }

  if (input.normalizedStatus !== "failed" && input.normalizedStatus !== "timed_out") {
    return {
      action: "skipped"
    };
  }

  const rule = input.normalizedStatus;
  const fingerprint = fingerprintFor({
    tenantId: input.tenantId,
    sourceType,
    sourceIdentity: sourceId,
    workflowId: input.body.workflow_id,
    environment: input.body.environment ?? null,
    rule
  });
  const title = titleFor({
    rule,
    workflowName: input.body.workflow_name
  });

  const result = await openOrRefreshBridgeIncident({
    tenantId: input.tenantId,
    severity: severityFor(rule),
    summary: title,
    fingerprint,
    details: {
      ...context,
      rule: `generic_workflow.${rule}`,
      incidentFingerprint: fingerprint
    },
    lastSeenAt: occurredAt
  });

  return {
    action:
      result.action === "created"
        ? "incident_created"
        : result.action === "reopened"
          ? "incident_reopened"
          : "incident_updated",
    rule,
    incidentId: result.incident.id
  };
}
