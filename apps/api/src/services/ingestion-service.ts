import { config } from "../config.js";
import { getBigQueryClient } from "../lib/bigquery.js";
import { runtimeMetrics } from "../lib/runtime-metrics.js";
import type { IngestExecutionInput, IngestHeartbeatInput } from "@synteq/shared";
import {
  buildExecutionFingerprint,
  buildHeartbeatFingerprint,
  minuteBucketIso
} from "../utils/crypto.js";
import { sanitizeErrorMessage, sanitizePayload, sanitizeText } from "../utils/sanitize.js";

const executionTable = "execution_events";
const heartbeatTable = "heartbeats";

export type IngestionMetadata = {
  requestId?: string;
  source?: "api" | "pubsub";
  ingestTs?: Date;
};

export type ExecutionRecord = {
  event_ts: Date;
  ingest_ts: Date;
  tenant_id: string;
  workflow_id: string;
  workflow_slug: string | null;
  environment: string;
  execution_id: string;
  run_id: string | null;
  status: string;
  duration_ms: number | null;
  retry_count: number;
  token_in: number | null;
  token_out: number | null;
  cost_estimate_usd: number | null;
  error_class: string | null;
  error_message: string | null;
  step_name: string | null;
  step_index: number | null;
  payload: string | null;
  fingerprint: string;
  minute_bucket: string;
  source: string;
  request_id: string | null;
};

export type HeartbeatRecord = {
  heartbeat_ts: Date;
  ingest_ts: Date;
  tenant_id: string;
  workflow_id: string;
  workflow_slug: string | null;
  environment: string;
  payload: string | null;
  fingerprint: string;
  minute_bucket: string;
  source: string;
  request_id: string | null;
};

function dataset() {
  return getBigQueryClient().dataset(config.BIGQUERY_DATASET);
}

function normalizeIngestTs(metadata?: IngestionMetadata): Date {
  return metadata?.ingestTs ?? new Date();
}

export function buildExecutionRecord(input: IngestExecutionInput, metadata?: IngestionMetadata): ExecutionRecord {
  const eventTs = input.event_ts instanceof Date ? input.event_ts : new Date(input.event_ts);
  const fingerprint = buildExecutionFingerprint({
    tenantId: input.tenant_id,
    workflowId: input.workflow_id,
    executionId: input.execution_id,
    eventTs
  });

  return {
    event_ts: eventTs,
    ingest_ts: normalizeIngestTs(metadata),
    tenant_id: input.tenant_id,
    workflow_id: input.workflow_id,
    workflow_slug: sanitizeText(input.workflow_slug, 191) ?? null,
    environment: sanitizeText(input.environment, 64) ?? "prod",
    execution_id: sanitizeText(input.execution_id, 191) ?? input.execution_id,
    run_id: sanitizeText(input.run_id, 191) ?? null,
    status: input.status,
    duration_ms: input.duration_ms ?? null,
    retry_count: input.retry_count,
    token_in: input.token_in ?? null,
    token_out: input.token_out ?? null,
    cost_estimate_usd: input.cost_estimate_usd ?? null,
    error_class: sanitizeText(input.error_class, 255) ?? null,
    error_message: sanitizeErrorMessage(input.error_message) ?? null,
    step_name: sanitizeText(input.step_name, 255) ?? null,
    step_index: input.step_index ?? null,
    payload: sanitizePayload(input.payload) ?? null,
    fingerprint,
    minute_bucket: minuteBucketIso(eventTs),
    source: metadata?.source ?? "api",
    request_id: metadata?.requestId ?? null
  };
}

export function buildHeartbeatRecord(input: IngestHeartbeatInput, metadata?: IngestionMetadata): HeartbeatRecord {
  const heartbeatTs = input.heartbeat_ts ?? new Date();
  const fingerprint = buildHeartbeatFingerprint({
    tenantId: input.tenant_id,
    workflowId: input.workflow_id,
    heartbeatTs
  });

  return {
    heartbeat_ts: heartbeatTs,
    ingest_ts: normalizeIngestTs(metadata),
    tenant_id: input.tenant_id,
    workflow_id: input.workflow_id,
    workflow_slug: sanitizeText(input.workflow_slug, 191) ?? null,
    environment: sanitizeText(input.environment, 64) ?? "prod",
    payload: sanitizePayload({
      expected_interval_sec: input.expected_interval_sec,
      payload: input.payload
    }) ?? null,
    fingerprint,
    minute_bucket: minuteBucketIso(heartbeatTs),
    source: metadata?.source ?? "api",
    request_id: metadata?.requestId ?? null
  };
}

export async function writeExecutionRecordToBigQuery(record: ExecutionRecord): Promise<void> {
  await dataset().table(executionTable).insert(
    [
      {
        insertId: record.fingerprint,
        json: record
      }
    ],
    {
      raw: true,
      ignoreUnknownValues: true,
      skipInvalidRows: false
    }
  );

  runtimeMetrics.increment("execution_events_written_total");
}

export async function writeHeartbeatRecordToBigQuery(record: HeartbeatRecord): Promise<void> {
  await dataset().table(heartbeatTable).insert(
    [
      {
        insertId: record.fingerprint,
        json: record
      }
    ],
    {
      raw: true,
      ignoreUnknownValues: true,
      skipInvalidRows: false
    }
  );

  runtimeMetrics.increment("heartbeat_events_written_total");
}

export async function insertExecutionEvent(input: IngestExecutionInput, metadata?: IngestionMetadata): Promise<ExecutionRecord> {
  const record = buildExecutionRecord(input, metadata);
  await writeExecutionRecordToBigQuery(record);
  return record;
}

export async function insertHeartbeat(input: IngestHeartbeatInput, metadata?: IngestionMetadata): Promise<HeartbeatRecord> {
  const record = buildHeartbeatRecord(input, metadata);
  await writeHeartbeatRecordToBigQuery(record);
  return record;
}
