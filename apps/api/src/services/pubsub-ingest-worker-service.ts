import { ingestExecutionSchema, ingestHeartbeatSchema } from "@synteq/shared";
import type { IngestQueueMessage } from "./ingest-queue-service.js";
import {
  buildExecutionRecord,
  buildHeartbeatRecord,
  writeExecutionRecordToBigQuery,
  writeHeartbeatRecordToBigQuery
} from "./ingestion-service.js";
import { parseWithSchema } from "../utils/validation.js";
import { config } from "../config.js";
import { runtimeMetrics } from "../lib/runtime-metrics.js";
import { redisDelete, redisKey, redisSetNx } from "../lib/redis.js";
import { assertWorkflowSourceOwnership, isIngestSourceOwnershipError } from "./ingest-source-ownership-service.js";

type WorkerResult = {
  skipped: boolean;
  reason?: string;
};

export async function processQueueMessage(message: IngestQueueMessage): Promise<WorkerResult> {
  const dedupeKey = redisKey("ingest", "dedupe", message.fingerprint);
  const claimed = await redisSetNx(dedupeKey, message.request_id, config.INGEST_DEDUPE_TTL_SEC);
  if (!claimed) {
    runtimeMetrics.increment("ingest_worker_duplicate_total");
    return {
      skipped: true,
      reason: "duplicate fingerprint in distributed dedupe cache"
    };
  }

  if (message.type === "execution") {
    const payload = parseWithSchema(ingestExecutionSchema, message.payload);
    try {
      await assertWorkflowSourceOwnership({
        tenantId: payload.tenant_id,
        workflowId: payload.workflow_id
      });
    } catch (error) {
      if (isIngestSourceOwnershipError(error)) {
        runtimeMetrics.increment("ingest_worker_unregistered_source_total");
        console.warn("ingest-worker.rejected-unregistered-workflow-source", {
          tenant_id: payload.tenant_id,
          workflow_id: payload.workflow_id,
          code: error.code
        });
        return {
          skipped: true,
          reason: "unregistered workflow source"
        };
      }
      throw error;
    }

    const record = buildExecutionRecord(payload, {
      source: "pubsub",
      requestId: message.request_id,
      ingestTs: new Date(message.ingest_ts),
      fingerprintOverride: message.fingerprint
    });

    try {
      await writeExecutionRecordToBigQuery(record);
      runtimeMetrics.increment("ingest_worker_execution_total");
      return { skipped: false };
    } catch (error) {
      await redisDelete(dedupeKey);
      throw error;
    }
  }

  const payload = parseWithSchema(ingestHeartbeatSchema, message.payload);
  try {
    await assertWorkflowSourceOwnership({
      tenantId: payload.tenant_id,
      workflowId: payload.workflow_id
    });
  } catch (error) {
    if (isIngestSourceOwnershipError(error)) {
      runtimeMetrics.increment("ingest_worker_unregistered_source_total");
      console.warn("ingest-worker.rejected-unregistered-workflow-source", {
        tenant_id: payload.tenant_id,
        workflow_id: payload.workflow_id,
        code: error.code
      });
      return {
        skipped: true,
        reason: "unregistered workflow source"
      };
    }
    throw error;
  }

  const record = buildHeartbeatRecord(payload, {
    source: "pubsub",
    requestId: message.request_id,
    ingestTs: new Date(message.ingest_ts)
  });

  try {
    await writeHeartbeatRecordToBigQuery(record);
    runtimeMetrics.increment("ingest_worker_heartbeat_total");
    return { skipped: false };
  } catch (error) {
    await redisDelete(dedupeKey);
    throw error;
  }
}
