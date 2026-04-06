import type { IngestExecutionInput, IngestHeartbeatInput } from "@synteq/shared";
import { config } from "../config.js";
import { getTopic } from "../lib/pubsub.js";
import { runtimeMetrics } from "../lib/runtime-metrics.js";
import {
  buildExecutionRecord,
  buildHeartbeatRecord,
  writeExecutionRecordToBigQuery,
  writeHeartbeatRecordToBigQuery
} from "./ingestion-service.js";

export type IngestQueueMessage = {
  type: "execution" | "heartbeat";
  fingerprint: string;
  request_id: string;
  ingest_ts: string;
  payload: IngestExecutionInput | IngestHeartbeatInput;
};

type EnqueueExecutionOptions = {
  fingerprintOverride?: string;
};

let loggedDeferredPubSubFallback = false;
let loggedEnforcedPubSubOnly = false;

function hasPubSubConfigured(): boolean {
  return Boolean(config.PUBSUB_TOPIC_INGEST);
}

function assertPubSubReadyForEnforcedMode() {
  if (!config.ENFORCE_PUBSUB_ONLY) {
    return;
  }

  if (!loggedEnforcedPubSubOnly) {
    loggedEnforcedPubSubOnly = true;
    console.info({
      event: "hardening_enforced",
      flag: "ENFORCE_PUBSUB_ONLY"
    });
  }

  if (!config.PUBSUB_PROJECT_ID || !config.PUBSUB_TOPIC_INGEST) {
    throw new Error(
      "ENFORCE_PUBSUB_ONLY=true requires PUBSUB_PROJECT_ID and PUBSUB_TOPIC_INGEST for ingestion enqueue."
    );
  }
}

function maybeLogDeferredPubSubFallback() {
  if (config.ENFORCE_PUBSUB_ONLY || loggedDeferredPubSubFallback) {
    return;
  }

  loggedDeferredPubSubFallback = true;
  console.warn({
    event: "hardening_deferred",
    flag: "ENFORCE_PUBSUB_ONLY",
    reason: "pubsub_topic_missing_direct_bigquery_fallback_active"
  });
}

export async function enqueueExecutionEvent(input: IngestExecutionInput, requestId: string, options?: EnqueueExecutionOptions) {
  assertPubSubReadyForEnforcedMode();

  const record = buildExecutionRecord(input, {
    requestId,
    source: "api",
    fingerprintOverride: options?.fingerprintOverride
  });
  const message: IngestQueueMessage = {
    type: "execution",
    fingerprint: record.fingerprint,
    request_id: requestId,
    ingest_ts: record.ingest_ts.toISOString(),
    payload: input
  };

  if (!hasPubSubConfigured()) {
    maybeLogDeferredPubSubFallback();
    await writeExecutionRecordToBigQuery(record);
    runtimeMetrics.increment("ingest_fallback_direct_total");
    return {
      queued: false,
      fingerprint: record.fingerprint
    };
  }

  const topic = getTopic(config.PUBSUB_TOPIC_INGEST!);
  await topic.publishMessage({
    json: message,
    attributes: {
      type: message.type,
      tenant_id: input.tenant_id,
      workflow_id: input.workflow_id,
      request_id: requestId,
      fingerprint: message.fingerprint
    }
  });

  runtimeMetrics.increment("ingest_queue_publish_total");
  return {
    queued: true,
    fingerprint: record.fingerprint
  };
}

export async function enqueueHeartbeatEvent(input: IngestHeartbeatInput, requestId: string) {
  assertPubSubReadyForEnforcedMode();

  const record = buildHeartbeatRecord(input, { requestId, source: "api" });
  const message: IngestQueueMessage = {
    type: "heartbeat",
    fingerprint: record.fingerprint,
    request_id: requestId,
    ingest_ts: record.ingest_ts.toISOString(),
    payload: input
  };

  if (!hasPubSubConfigured()) {
    maybeLogDeferredPubSubFallback();
    await writeHeartbeatRecordToBigQuery(record);
    runtimeMetrics.increment("ingest_fallback_direct_total");
    return {
      queued: false,
      fingerprint: record.fingerprint
    };
  }

  const topic = getTopic(config.PUBSUB_TOPIC_INGEST!);
  await topic.publishMessage({
    json: message,
    attributes: {
      type: message.type,
      tenant_id: input.tenant_id,
      workflow_id: input.workflow_id,
      request_id: requestId,
      fingerprint: message.fingerprint
    }
  });

  runtimeMetrics.increment("ingest_queue_publish_total");
  return {
    queued: true,
    fingerprint: record.fingerprint
  };
}
