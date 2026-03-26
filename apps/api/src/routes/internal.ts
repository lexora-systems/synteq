import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { pubSubPushEnvelopeSchema } from "@synteq/shared";
import { config } from "../config.js";
import { processQueueMessage } from "../services/pubsub-ingest-worker-service.js";
import { runtimeMetrics } from "../lib/runtime-metrics.js";
import type { IngestQueueMessage } from "../services/ingest-queue-service.js";
import { runSchedulerTask, type SchedulerTask } from "../services/scheduler-execution-service.js";

const queueMessageSchema = z.object({
  type: z.enum(["execution", "heartbeat"]),
  fingerprint: z.string().min(32).max(128),
  request_id: z.string().min(1),
  ingest_ts: z.string().datetime(),
  payload: z.any()
});

const schedulerTriggerBodySchema = z
  .object({
    trigger_id: z.string().min(1).max(128).optional()
  })
  .optional()
  .default({});

function schedulerHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function hasBearerAuthHeader(value: string | undefined) {
  if (!value) {
    return false;
  }
  return /^Bearer\s+\S+/i.test(value.trim());
}

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

  const requireSchedulerTriggerAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    const sharedSecret = config.SCHEDULER_SHARED_SECRET;
    if (!sharedSecret) {
      reply.code(503).send({
        error: "Scheduler trigger is not configured",
        code: "SCHEDULER_NOT_CONFIGURED"
      });
      return false;
    }

    const providedSecret = schedulerHeaderValue(request.headers["x-synteq-scheduler-secret"]);
    if (!providedSecret || providedSecret !== sharedSecret) {
      reply.code(401).send({
        error: "Unauthorized scheduler request",
        code: "SCHEDULER_UNAUTHORIZED"
      });
      return false;
    }

    const authorization = schedulerHeaderValue(request.headers.authorization);
    if (!hasBearerAuthHeader(authorization)) {
      reply.code(401).send({
        error: "Missing bearer token",
        code: "SCHEDULER_BEARER_REQUIRED"
      });
      return false;
    }

    const cloudSchedulerHeader = schedulerHeaderValue(request.headers["x-cloudscheduler"]);
    if (!cloudSchedulerHeader || cloudSchedulerHeader.toLowerCase() !== "true") {
      reply.code(403).send({
        error: "Cloud Scheduler header is required",
        code: "SCHEDULER_HEADER_REQUIRED"
      });
      return false;
    }

    return true;
  };

  const registerSchedulerTaskRoute = (path: string, task: SchedulerTask) => {
    app.post(path, async (request, reply) => {
      const authorized = await requireSchedulerTriggerAuth(request, reply);
      if (!authorized) {
        return;
      }

      const parsed = schedulerTriggerBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Invalid scheduler payload",
          code: "SCHEDULER_BAD_REQUEST"
        });
      }

      const result = await runSchedulerTask(task);
      return reply.code(result.skipped ? 202 : 200).send({
        ok: true,
        task: result.task,
        stage: result.stage,
        skipped: result.skipped,
        reason: result.reason,
        request_id: request.id,
        trigger_id: parsed.data.trigger_id ?? null
      });
    });
  };

  registerSchedulerTaskRoute("/scheduler/aggregate", "aggregate");
  registerSchedulerTaskRoute("/scheduler/anomaly", "anomaly");
  registerSchedulerTaskRoute("/scheduler/alerts", "alerts");
};

export default internalRoutes;
