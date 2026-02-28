import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { pubSubPushEnvelopeSchema } from "@synteq/shared";
import { config } from "../config.js";
import { processQueueMessage } from "../services/pubsub-ingest-worker-service.js";
import { runtimeMetrics } from "../lib/runtime-metrics.js";
import type { IngestQueueMessage } from "../services/ingest-queue-service.js";

const queueMessageSchema = z.object({
  type: z.enum(["execution", "heartbeat"]),
  fingerprint: z.string().min(32).max(128),
  request_id: z.string().min(1),
  ingest_ts: z.string().datetime(),
  payload: z.any()
});

const internalRoutes: FastifyPluginAsync = async (app) => {
  app.post("/pubsub/ingest", async (request, reply) => {
    const sharedSecret = config.PUBSUB_PUSH_SHARED_SECRET;
    if (sharedSecret) {
      const provided = request.headers["x-synteq-push-secret"];
      const candidate = Array.isArray(provided) ? provided[0] : provided;
      if (!candidate || candidate !== sharedSecret) {
        runtimeMetrics.increment("pubsub_push_rejected_total");
        return reply.code(401).send({ error: "Unauthorized push request" });
      }
    }

    const envelope = pubSubPushEnvelopeSchema.safeParse(request.body);
    if (!envelope.success) {
      runtimeMetrics.increment("pubsub_push_bad_payload_total");
      request.log.warn({ issues: envelope.error.issues, request_id: request.id }, "Invalid pubsub push envelope");
      return reply.code(400).send({ error: "Invalid pubsub envelope" });
    }

    const decoded = Buffer.from(envelope.data.message.data, "base64").toString("utf8");
    let messageJson: unknown;
    try {
      messageJson = JSON.parse(decoded);
    } catch (error) {
      runtimeMetrics.increment("pubsub_push_bad_payload_total");
      request.log.warn({ err: error, request_id: request.id }, "Unable to decode pubsub message payload");
      return reply.code(400).send({ error: "Invalid pubsub message encoding" });
    }

    const message = queueMessageSchema.safeParse(messageJson);
    if (!message.success) {
      runtimeMetrics.increment("pubsub_push_bad_payload_total");
      request.log.warn({ issues: message.error.issues, request_id: request.id }, "Invalid pubsub queue message");
      return reply.code(400).send({ error: "Invalid pubsub message schema" });
    }

    try {
      const outcome = await processQueueMessage(message.data as IngestQueueMessage);
      runtimeMetrics.increment("pubsub_push_processed_total");
      return {
        ok: true,
        skipped: outcome.skipped,
        reason: outcome.reason ?? null,
        request_id: request.id
      };
    } catch (error) {
      runtimeMetrics.increment("pubsub_push_failed_total");
      request.log.error({ err: error, request_id: request.id }, "Failed to process pubsub queue message");
      return reply.code(500).send({ error: "Failed to process pubsub message" });
    }
  });
};

export default internalRoutes;
