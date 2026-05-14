import { sha256 } from "../utils/crypto.js";
import { sanitizeText } from "../utils/sanitize.js";

const ADAPTER_VERSION = "ghl_webhook_v1";
const SOURCE_TYPE = "webhook";
const PROVIDER = "gohighlevel";

const providerAliases = new Set(["gohighlevel", "go_high_level", "go-high-level", "ghl"]);
const sensitiveOrPiiPattern =
  /(secret|password|token|authorization|signature|api[_-]?key|credential|cookie|session|private[_-]?key|client[_-]?secret|email|phone|address|body|note|notes|custom[_-]?field|raw[_-]?payload)/i;
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const phoneLikePattern = /^\+?[0-9][0-9().\-\s]{6,}$/;

type NormalizedGoHighLevelStatus = "started" | "succeeded" | "failed" | "timed_out";

type Path = string | string[];

export type GoHighLevelWorkflowEventPayload = {
  source_type: typeof SOURCE_TYPE;
  source_id?: string;
  source_key?: string;
  workflow_id: string;
  workflow_name: string;
  status: NormalizedGoHighLevelStatus;
  execution_id: string;
  timestamp: Date;
  started_at?: Date;
  finished_at?: Date;
  duration_ms?: number;
  error_message?: string;
  environment?: string;
  metadata: Record<string, string | number | boolean | null>;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeProvider(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  return value.trim().toLowerCase();
}

function isGoHighLevelProvider(value: unknown) {
  const normalized = normalizeProvider(value);
  return normalized !== null && providerAliases.has(normalized);
}

function pathParts(path: Path) {
  return Array.isArray(path) ? path : path.split(".");
}

function valueAt(source: Record<string, unknown>, path: Path): unknown {
  let current: unknown = source;
  for (const part of pathParts(path)) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function firstValue(source: Record<string, unknown>, paths: Path[]) {
  for (const path of paths) {
    const value = valueAt(source, path);
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

function safeString(value: unknown, maxLength = 191): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const clean = sanitizeText(String(value), maxLength);
  return clean;
}

function safeMetadataString(value: unknown, maxLength = 191): string | undefined {
  const clean = safeString(value, maxLength);
  if (!clean || emailPattern.test(clean) || phoneLikePattern.test(clean) || /^https?:\/\//i.test(clean)) {
    return undefined;
  }
  if (sensitiveOrPiiPattern.test(clean)) {
    return undefined;
  }
  return clean;
}

function safeErrorMessage(value: unknown): string | undefined {
  const clean = safeString(value, 512);
  if (!clean || emailPattern.test(clean) || phoneLikePattern.test(clean) || sensitiveOrPiiPattern.test(clean)) {
    return undefined;
  }
  return clean;
}

function firstSafeString(source: Record<string, unknown>, paths: Path[], maxLength = 191) {
  return safeString(firstValue(source, paths), maxLength);
}

function firstSafeMetadataString(source: Record<string, unknown>, paths: Path[], maxLength = 191) {
  return safeMetadataString(firstValue(source, paths), maxLength);
}

function firstSafeDate(source: Record<string, unknown>, paths: Path[]): Date | undefined {
  const value = firstValue(source, paths);
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function firstDurationMs(source: Record<string, unknown>) {
  const value = firstValue(source, ["duration_ms", "durationMs", "duration", "elapsed_ms", "elapsedMs"]);
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.min(Math.trunc(value), 86_400_000);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.min(Math.trunc(parsed), 86_400_000);
    }
  }
  return undefined;
}

export function hasExplicitGoHighLevelProvider(input: unknown): boolean {
  const body = asObject(input);
  const metadata = asObject(body.metadata);
  return isGoHighLevelProvider(body.provider) || isGoHighLevelProvider(metadata.provider);
}

export function normalizeGoHighLevelStatus(status: unknown): NormalizedGoHighLevelStatus {
  const normalized = safeString(status, 64)?.toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) {
    return "started";
  }

  if (["success", "succeeded", "completed", "complete"].includes(normalized)) {
    return "succeeded";
  }
  if (["failed", "failure", "error"].includes(normalized)) {
    return "failed";
  }
  if (["timeout", "timed_out"].includes(normalized)) {
    return "timed_out";
  }
  if (["started", "running", "in_progress", "pending"].includes(normalized)) {
    return "started";
  }

  return "started";
}

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function deterministicId(input: Record<string, unknown>) {
  return `ghl_${sha256(canonicalize(input)).slice(0, 32)}`;
}

function coalesceMetadata(input: Array<[string, string | number | boolean | null | undefined]>) {
  const metadata: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of input) {
    if (value !== undefined) {
      metadata[key] = value;
    }
  }
  return metadata;
}

function sourceIdentity(input: { sourceId?: string; sourceKey?: string }) {
  return input.sourceId ?? input.sourceKey ?? "unresolved_source";
}

export function normalizeGoHighLevelWebhookPayload(
  input: unknown,
  options: {
    receivedAt?: Date;
  } = {}
): unknown {
  if (!hasExplicitGoHighLevelProvider(input)) {
    return input;
  }

  const body = asObject(input);
  const metadataInput = asObject(body.metadata);
  const receivedAt = options.receivedAt ?? new Date();

  // Source identity remains Synteq-provided; do not infer tenant/source ownership from CRM object fields.
  const sourceId = firstSafeMetadataString(body, [
    "source_id",
    "sourceId",
    "synteq_source_id",
    "metadata.source_id",
    "metadata.sourceId"
  ]);
  const sourceKey = firstSafeMetadataString(body, [
    "source_key",
    "sourceKey",
    "synteq_source_key",
    "metadata.source_key",
    "metadata.sourceKey"
  ]);
  const ghlEventType =
    firstSafeMetadataString(body, ["ghl_event_type", "event_type", "eventType", "type", "action"], 128) ??
    firstSafeMetadataString(metadataInput, ["ghl_event_type", "event_type", "eventType"], 128);
  const actionId = firstSafeMetadataString(body, ["action_id", "actionId", "action.id", "metadata.action_id"]);
  const workflowId =
    firstSafeMetadataString(body, ["workflow_id", "workflowId", "workflow.id", "metadata.workflow_id"]) ??
    actionId ??
    deterministicId({
      provider: PROVIDER,
      eventType: ghlEventType ?? "webhook"
    });
  const workflowName =
    firstSafeString(body, ["workflow_name", "workflowName", "workflow.name", "action_name", "actionName", "action.name"], 255) ??
    "GoHighLevel Webhook";
  const objectType =
    firstSafeMetadataString(body, ["object_type", "objectType", "entity_type", "entityType"], 64) ??
    (firstValue(body, ["opportunity", "opportunity_id", "opportunityId"]) !== undefined
      ? "opportunity"
      : firstValue(body, ["appointment", "appointment_id", "appointmentId"]) !== undefined
        ? "appointment"
        : firstValue(body, ["calendar", "calendar_id", "calendarId"]) !== undefined
          ? "calendar"
          : firstValue(body, ["pipeline", "pipeline_id", "pipelineId"]) !== undefined
            ? "pipeline"
            : firstValue(body, ["contact", "contact_id", "contactId"]) !== undefined
              ? "contact"
              : undefined);
  const objectId = firstSafeMetadataString(body, [
    "object_id",
    "objectId",
    "entity_id",
    "entityId",
    "contact.id",
    "contact_id",
    "contactId",
    "opportunity.id",
    "opportunity_id",
    "opportunityId",
    "appointment.id",
    "appointment_id",
    "appointmentId",
    "calendar.id",
    "calendar_id",
    "calendarId",
    "pipeline.id",
    "pipeline_id",
    "pipelineId"
  ]);
  const pipelineId = firstSafeMetadataString(body, ["pipeline_id", "pipelineId", "pipeline.id"]);
  const opportunityId = firstSafeMetadataString(body, ["opportunity_id", "opportunityId", "opportunity.id"]);
  const calendarId = firstSafeMetadataString(body, ["calendar_id", "calendarId", "calendar.id"]);
  const appointmentId = firstSafeMetadataString(body, ["appointment_id", "appointmentId", "appointment.id"]);
  const locationId = firstSafeMetadataString(body, ["location_id", "locationId", "location.id", "metadata.location_id"]);
  const deliveryId = firstSafeMetadataString(body, [
    "delivery_id",
    "deliveryId",
    "event_id",
    "eventId",
    "message_id",
    "messageId",
    "webhook_id",
    "webhookId"
  ]);
  const statusSource = firstSafeMetadataString(body, ["status", "state", "result", "outcome"], 64);
  const status = normalizeGoHighLevelStatus(statusSource);
  const providerTimestamp = firstSafeDate(body, [
    "timestamp",
    "event_timestamp",
    "eventTimestamp",
    "event_time",
    "eventTime",
    "occurred_at",
    "occurredAt",
    "created_at",
    "createdAt",
    "updated_at",
    "updatedAt",
    "dateAdded"
  ]);
  const timestamp = providerTimestamp ?? receivedAt;
  const startedAt = firstSafeDate(body, ["started_at", "startedAt", "start_time", "startTime"]);
  const finishedAt = firstSafeDate(body, ["finished_at", "finishedAt", "completed_at", "completedAt", "end_time", "endTime"]);
  const durationMs = firstDurationMs(body);
  const executionId =
    firstSafeMetadataString(body, ["execution_id", "executionId", "run_id", "runId"], 191) ??
    deliveryId ??
    deterministicId({
      provider: PROVIDER,
      sourceIdentity: sourceIdentity({
        sourceId,
        sourceKey
      }),
      eventType: ghlEventType ?? null,
      objectType: objectType ?? null,
      objectId: objectId ?? null,
      workflowId,
      actionId: actionId ?? null,
      status,
      providerTimestamp: providerTimestamp?.toISOString() ?? null
    });
  const errorMessage =
    status === "failed" || status === "timed_out"
      ? safeErrorMessage(firstValue(body, ["error_message", "errorMessage", "error", "failure_reason", "failureReason"]))
      : undefined;
  const environment = firstSafeMetadataString(body, ["environment", "env", "metadata.environment"], 64);

  const normalized: GoHighLevelWorkflowEventPayload = {
    source_type: SOURCE_TYPE,
    ...(sourceId ? { source_id: sourceId } : {}),
    ...(sourceKey ? { source_key: sourceKey } : {}),
    workflow_id: workflowId,
    workflow_name: workflowName,
    status,
    execution_id: executionId,
    timestamp,
    ...(startedAt ? { started_at: startedAt } : {}),
    ...(finishedAt ? { finished_at: finishedAt } : {}),
    ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
    ...(errorMessage ? { error_message: errorMessage } : {}),
    ...(environment ? { environment } : {}),
    metadata: coalesceMetadata([
      ["provider", PROVIDER],
      ["adapter_version", ADAPTER_VERSION],
      ["ghl_event_type", ghlEventType],
      ["location_id", locationId],
      ["workflow_id", workflowId],
      ["action_id", actionId],
      ["object_type", objectType],
      ["object_id", objectId],
      ["pipeline_id", pipelineId],
      ["opportunity_id", opportunityId],
      ["calendar_id", calendarId],
      ["appointment_id", appointmentId],
      ["delivery_id", deliveryId],
      ["status_source", statusSource ?? null]
    ])
  };

  return normalized;
}
