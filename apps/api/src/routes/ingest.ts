import type { FastifyPluginAsync } from "fastify";
import { ingestExecutionSchema, ingestHeartbeatSchema } from "@synteq/shared";
import { parseWithSchema } from "../utils/validation.js";
import { enqueueExecutionEvent, enqueueHeartbeatEvent } from "../services/ingest-queue-service.js";
import { config } from "../config.js";
import { runtimeMetrics } from "../lib/runtime-metrics.js";

function getIngestionRateLimitKey(request: { apiKeyId?: string; ip: string }) {
  return request.apiKeyId ? `api_key:${request.apiKeyId}` : `ip:${request.ip}`;
}

const ingestRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/ingest/execution",
    {
      preHandler: [app.requireIngestionKey, app.requireIngestionSignature],
      config: {
        rateLimit: {
          max: config.INGEST_RATE_LIMIT_PER_MIN,
          timeWindow: "1 minute",
          keyGenerator: getIngestionRateLimitKey
        },
        rawBody: true
      }
    },
    async (request, reply) => {
      if (request.rawBody && Buffer.byteLength(request.rawBody, "utf8") > config.MAX_INGEST_BODY_BYTES) {
        runtimeMetrics.increment("ingest_rejected_payload_too_large_total");
        return reply.code(413).send({ error: "Payload too large" });
      }

      const body = parseWithSchema(ingestExecutionSchema, request.body);
      if (body.tenant_id !== request.tenantId) {
        runtimeMetrics.increment("ingest_rejected_tenant_mismatch_total");
        return reply.code(403).send({ error: "tenant_id mismatch for API key" });
      }

      try {
        const queued = await enqueueExecutionEvent(body, request.id);
        runtimeMetrics.increment("ingest_execution_accepted_total");
        return reply.code(200).send({
          ok: true,
          queued: queued.queued,
          fingerprint: queued.fingerprint,
          request_id: request.id
        });
      } catch (error) {
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
        rateLimit: {
          max: config.INGEST_RATE_LIMIT_PER_MIN,
          timeWindow: "1 minute",
          keyGenerator: getIngestionRateLimitKey
        },
        rawBody: true
      }
    },
    async (request, reply) => {
      if (request.rawBody && Buffer.byteLength(request.rawBody, "utf8") > config.MAX_INGEST_BODY_BYTES) {
        runtimeMetrics.increment("ingest_rejected_payload_too_large_total");
        return reply.code(413).send({ error: "Payload too large" });
      }

      const body = parseWithSchema(ingestHeartbeatSchema, request.body);
      if (body.tenant_id !== request.tenantId) {
        runtimeMetrics.increment("ingest_rejected_tenant_mismatch_total");
        return reply.code(403).send({ error: "tenant_id mismatch for API key" });
      }

      try {
        const queued = await enqueueHeartbeatEvent(body, request.id);
        runtimeMetrics.increment("ingest_heartbeat_accepted_total");
        return reply.code(200).send({
          ok: true,
          queued: queued.queued,
          fingerprint: queued.fingerprint,
          request_id: request.id
        });
      } catch (error) {
        runtimeMetrics.increment("ingest_heartbeat_failed_total");
        request.log.error({ err: error, request_id: request.id }, "Failed to enqueue heartbeat event");
        return reply.code(500).send({ error: "Failed to enqueue heartbeat" });
      }
    }
  );
};

export default ingestRoutes;
