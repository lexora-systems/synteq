import type { FastifyPluginAsync } from "fastify";
import { ingestExecutionSchema, ingestHeartbeatSchema, ingestOperationalEventsRequestSchema } from "@synteq/shared";
import { parseWithSchema } from "../utils/validation.js";
import { enqueueExecutionEvent, enqueueHeartbeatEvent } from "../services/ingest-queue-service.js";
import { config } from "../config.js";
import { runtimeMetrics } from "../lib/runtime-metrics.js";
import { consumeRateLimit } from "../services/rate-limit-service.js";
import { ingestOperationalEvents } from "../services/operational-event-ingestion-service.js";
import { startTrialIfEligible } from "../services/tenant-trial-service.js";
import {
  assertOperationalSourceOwnership,
  assertWorkflowSourceOwnership,
  isIngestSourceOwnershipError
} from "../services/ingest-source-ownership-service.js";

function getIngestionRateLimitKey(request: { apiKeyId?: string; ip: string }) {
  return request.apiKeyId ? `api_key:${request.apiKeyId}` : `ip:${request.ip}`;
}

function looksSynthetic(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.simulation === true || record.synthetic === true;
}

function isSimulationOperationalIngest(body: { events: Array<Record<string, unknown>> }) {
  if (body.events.length === 0) {
    return false;
  }
  return body.events.every((event) => looksSynthetic(event.metadata) || looksSynthetic(event.attributes));
}

async function tryAutoStartTrialFromIngest(input: {
  tenantId: string;
  request: {
    id: string;
    log: {
      warn: (payload: Record<string, unknown>, message: string) => void;
    };
  };
}) {
  await startTrialIfEligible({
    tenantId: input.tenantId,
    source: "auto_ingest"
  }).catch((error) => {
    input.request.log.warn(
      {
        err: error,
        tenant_id: input.tenantId,
        request_id: input.request.id
      },
      "trial auto-start failed for ingest"
    );
  });
}

const ingestRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/ingest/events",
    {
      preHandler: [app.requireIngestionKey, app.requireIngestionSignature],
      config: {
        rawBody: true
      }
    },
    async (request, reply) => {
      const rate = await consumeRateLimit({
        scope: "ingest_events",
        key: getIngestionRateLimitKey(request),
        max: config.INGEST_RATE_LIMIT_PER_MIN,
        windowSec: 60
      });
      if (!rate.allowed) {
        runtimeMetrics.increment("ingest_rate_limited_total");
        reply.header("Retry-After", String(rate.retryAfterSec));
        return reply.code(429).send({
          error: "Rate limit exceeded",
          code: "INGEST_RATE_LIMITED"
        });
      }

      if (request.rawBody && Buffer.byteLength(request.rawBody, "utf8") > config.MAX_INGEST_BODY_BYTES) {
        runtimeMetrics.increment("ingest_rejected_payload_too_large_total");
        return reply.code(413).send({ error: "Payload too large" });
      }

      if (!request.tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const body = parseWithSchema(ingestOperationalEventsRequestSchema, request.body);
      const simulationOnlyPayload = isSimulationOperationalIngest(body as { events: Array<Record<string, unknown>> });

      try {
        await assertOperationalSourceOwnership({
          tenantId: request.tenantId,
          sourceValues: body.events.map((event) => String(event.source)),
          owner: {
            kind: "api_key",
            apiKeyId: request.apiKeyId ?? null
          }
        });

        const result = await ingestOperationalEvents(body, {
          tenantId: request.tenantId,
          apiKeyId: request.apiKeyId,
          requestId: request.id,
          sourceOwner: {
            kind: "api_key",
            apiKeyId: request.apiKeyId ?? null
          }
        });
        if (result.accepted > 0 && !simulationOnlyPayload) {
          await tryAutoStartTrialFromIngest({
            tenantId: request.tenantId,
            request
          });
        }

        runtimeMetrics.increment("ingest_operational_accepted_total", result.accepted);

        return reply.code(200).send({
          ok: result.failed === 0,
          accepted: result.accepted,
          ingested: result.ingested,
          duplicates: result.duplicates,
          skipped: result.skipped,
          failed: result.failed,
          persisted: result.persisted,
          analysis_handoff: result.analysis_handoff,
          request_id: request.id
        });
      } catch (error) {
        if (isIngestSourceOwnershipError(error)) {
          runtimeMetrics.increment("ingest_rejected_unregistered_source_total");
          request.log.warn(
            {
              request_id: request.id,
              tenant_id: request.tenantId,
              api_key_id: request.apiKeyId ?? null,
              code: error.code,
              details: error.details ?? null
            },
            "Ingestion rejected due to source ownership policy"
          );
          return reply.code(error.statusCode).send({
            error: error.message,
            code: error.code
          });
        }

        runtimeMetrics.increment("ingest_operational_failed_total");
        request.log.error({ err: error, request_id: request.id }, "Failed to ingest operational events");
        return reply.code(500).send({ error: "Failed to ingest events" });
      }
    }
  );

  app.post(
    "/ingest/execution",
    {
      preHandler: [app.requireIngestionKey, app.requireIngestionSignature],
      config: {
        rawBody: true
      }
    },
    async (request, reply) => {
      const rate = await consumeRateLimit({
        scope: "ingest_execution",
        key: getIngestionRateLimitKey(request),
        max: config.INGEST_RATE_LIMIT_PER_MIN,
        windowSec: 60
      });
      if (!rate.allowed) {
        runtimeMetrics.increment("ingest_rate_limited_total");
        reply.header("Retry-After", String(rate.retryAfterSec));
        return reply.code(429).send({
          error: "Rate limit exceeded",
          code: "INGEST_RATE_LIMITED"
        });
      }

      if (request.rawBody && Buffer.byteLength(request.rawBody, "utf8") > config.MAX_INGEST_BODY_BYTES) {
        runtimeMetrics.increment("ingest_rejected_payload_too_large_total");
        return reply.code(413).send({ error: "Payload too large" });
      }

      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const body = parseWithSchema(ingestExecutionSchema, request.body);
      if (body.tenant_id !== tenantId) {
        runtimeMetrics.increment("ingest_rejected_tenant_mismatch_total");
        return reply.code(403).send({ error: "tenant_id mismatch for API key" });
      }

      try {
        await assertWorkflowSourceOwnership({
          tenantId,
          workflowId: body.workflow_id
        });

        const queued = await enqueueExecutionEvent(body, request.id);
        await tryAutoStartTrialFromIngest({
          tenantId,
          request
        });
        runtimeMetrics.increment("ingest_execution_accepted_total");
        return reply.code(200).send({
          ok: true,
          queued: queued.queued,
          fingerprint: queued.fingerprint,
          request_id: request.id
        });
      } catch (error) {
        if (isIngestSourceOwnershipError(error)) {
          runtimeMetrics.increment("ingest_rejected_unregistered_source_total");
          request.log.warn(
            {
              request_id: request.id,
              tenant_id: tenantId,
              api_key_id: request.apiKeyId ?? null,
              code: error.code,
              details: error.details ?? null
            },
            "Execution ingest rejected due to unregistered workflow source"
          );
          return reply.code(error.statusCode).send({
            error: error.message,
            code: error.code
          });
        }

        runtimeMetrics.increment("ingest_execution_failed_total");
        request.log.error({ err: error, request_id: request.id }, "Failed to enqueue execution event");
        return reply.code(500).send({ error: "Failed to enqueue event" });
      }
    }
  );

  app.post(
    "/ingest/heartbeat",
    {
      preHandler: [app.requireIngestionKey, app.requireIngestionSignature],
      config: {
        rawBody: true
      }
    },
    async (request, reply) => {
      const rate = await consumeRateLimit({
        scope: "ingest_heartbeat",
        key: getIngestionRateLimitKey(request),
        max: config.INGEST_RATE_LIMIT_PER_MIN,
        windowSec: 60
      });
      if (!rate.allowed) {
        runtimeMetrics.increment("ingest_rate_limited_total");
        reply.header("Retry-After", String(rate.retryAfterSec));
        return reply.code(429).send({
          error: "Rate limit exceeded",
          code: "INGEST_RATE_LIMITED"
        });
      }

      if (request.rawBody && Buffer.byteLength(request.rawBody, "utf8") > config.MAX_INGEST_BODY_BYTES) {
        runtimeMetrics.increment("ingest_rejected_payload_too_large_total");
        return reply.code(413).send({ error: "Payload too large" });
      }

      const tenantId = request.tenantId;
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const body = parseWithSchema(ingestHeartbeatSchema, request.body);
      if (body.tenant_id !== tenantId) {
        runtimeMetrics.increment("ingest_rejected_tenant_mismatch_total");
        return reply.code(403).send({ error: "tenant_id mismatch for API key" });
      }

      try {
        await assertWorkflowSourceOwnership({
          tenantId,
          workflowId: body.workflow_id
        });

        const queued = await enqueueHeartbeatEvent(body, request.id);
        await tryAutoStartTrialFromIngest({
          tenantId,
          request
        });
        runtimeMetrics.increment("ingest_heartbeat_accepted_total");
        return reply.code(200).send({
          ok: true,
          queued: queued.queued,
          fingerprint: queued.fingerprint,
          request_id: request.id
        });
      } catch (error) {
        if (isIngestSourceOwnershipError(error)) {
          runtimeMetrics.increment("ingest_rejected_unregistered_source_total");
          request.log.warn(
            {
              request_id: request.id,
              tenant_id: tenantId,
              api_key_id: request.apiKeyId ?? null,
              code: error.code,
              details: error.details ?? null
            },
            "Heartbeat ingest rejected due to unregistered workflow source"
          );
          return reply.code(error.statusCode).send({
            error: error.message,
            code: error.code
          });
        }

        runtimeMetrics.increment("ingest_heartbeat_failed_total");
        request.log.error({ err: error, request_id: request.id }, "Failed to enqueue heartbeat event");
        return reply.code(500).send({ error: "Failed to enqueue heartbeat" });
      }
    }
  );
};

export default ingestRoutes;
