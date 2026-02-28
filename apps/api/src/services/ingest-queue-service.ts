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

function hasPubSubConfigured(): boolean {
  return Boolean(config.PUBSUB_TOPIC_INGEST);
}

export async function enqueueExecutionEvent(input: IngestExecutionInput, requestId: string) {
  const record = buildExecutionRecord(input, { requestId, source: "api" });
  const message: IngestQueueMessage = {
    type: "execution",
    fingerprint: record.fingerprint,
    request_id: requestId,
    ingest_ts: record.ingest_ts.toISOString(),
    payload: input
  };

  if (!hasPubSubConfigured()) {
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
  const record = buildHeartbeatRecord(input, { requestId, source: "api" });
  const message: IngestQueueMessage = {
    type: "heartbeat",
    fingerprint: record.fingerprint,
    request_id: requestId,
    ingest_ts: record.ingest_ts.toISOString(),
    payload: input
  };

  if (!hasPubSubConfigured()) {
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
