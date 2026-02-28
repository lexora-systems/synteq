import { ingestExecutionSchema, ingestHeartbeatSchema } from "@synteq/shared";
import type { IngestQueueMessage } from "./ingest-queue-service.js";
import {
  buildExecutionRecord,
  buildHeartbeatRecord,
  writeExecutionRecordToBigQuery,
  writeHeartbeatRecordToBigQuery
} from "./ingestion-service.js";
import { parseWithSchema } from "../utils/validation.js";
import { TtlCache } from "../utils/ttl-cache.js";
import { config } from "../config.js";
import { runtimeMetrics } from "../lib/runtime-metrics.js";

const dedupeCache = new TtlCache<boolean>(200_000);

type WorkerResult = {
  skipped: boolean;
  reason?: string;
};

export async function processQueueMessage(message: IngestQueueMessage): Promise<WorkerResult> {
  if (dedupeCache.has(message.fingerprint)) {
    runtimeMetrics.increment("ingest_worker_duplicate_total");
    return {
      skipped: true,
      reason: "duplicate fingerprint in dedupe cache"
    };
  }

  if (message.type === "execution") {
    const payload = parseWithSchema(ingestExecutionSchema, message.payload);
    const record = buildExecutionRecord(payload, {
      source: "pubsub",
      requestId: message.request_id,
      ingestTs: new Date(message.ingest_ts)
    });

    await writeExecutionRecordToBigQuery(record);
    dedupeCache.set(message.fingerprint, true, config.INGEST_DEDUPE_TTL_SEC);
    runtimeMetrics.increment("ingest_worker_execution_total");
    runtimeMetrics.setGauge("ingest_dedupe_cache_size", dedupeCache.size());
    return { skipped: false };
  }

  const payload = parseWithSchema(ingestHeartbeatSchema, message.payload);
  const record = buildHeartbeatRecord(payload, {
    source: "pubsub",
    requestId: message.request_id,
    ingestTs: new Date(message.ingest_ts)
  });

  await writeHeartbeatRecordToBigQuery(record);
  dedupeCache.set(message.fingerprint, true, config.INGEST_DEDUPE_TTL_SEC);
  runtimeMetrics.increment("ingest_worker_heartbeat_total");
  runtimeMetrics.setGauge("ingest_dedupe_cache_size", dedupeCache.size());
  return { skipped: false };
}
