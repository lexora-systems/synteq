import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { pubSubPushEnvelopeSchema } from "@synteq/shared";
import { config } from "../config.js";
import { processQueueMessage } from "../services/pubsub-ingest-worker-service.js";
import { runtimeMetrics } from "../lib/runtime-metrics.js";
import type { IngestQueueMessage } from "../services/ingest-queue-service.js";
import { runSchedulerTask, type SchedulerTask } from "../services/scheduler-execution-service.js";
import { consumeRateLimit } from "../services/rate-limit-service.js";

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

const DEV_INTERNAL_SHARED_SECRET = "synteq-dev-internal-secret";
const INTERNAL_SCHEDULER_RATE_LIMIT_PER_MIN = 120;
const INTERNAL_PUBSUB_RATE_LIMIT_PER_MIN = 2000;

function isDevelopmentMode() {
  return config.NODE_ENV === "development";
}

function parseBearerToken(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const match = /^Bearer\s+(\S+)$/i.exec(value.trim());
  return match ? match[1] : null;
}

function isLikelyJwt(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 3) {
    return false;
  }

  return parts.every((part) => part.length >= 10 && /^[A-Za-z0-9_-]+$/.test(part));
}

function routePath(request: FastifyRequest) {
  return request.routeOptions.url ?? request.url;
}

function logInternalAuthFailure(
  request: FastifyRequest,
  reason: string,
  extra?: Record<string, unknown>
) {
  request.log.warn(
    {
      request_id: request.id,
      method: request.method,
      route: routePath(request),
      ip: request.ip,
      forwarded_for: request.headers["x-forwarded-for"] ?? null,
      user_agent: request.headers["user-agent"] ?? null,
      reason,
      ...(extra ?? {})
    },
    "internal.auth.failed"
  );
}

async function enforceInternalRateLimit(input: {
  request: FastifyRequest;
  reply: FastifyReply;
  scope: string;
  maxPerMinute: number;
}) {
  const rate = await consumeRateLimit({
    scope: input.scope,
    key: `${input.request.ip}:${routePath(input.request)}`,
    max: input.maxPerMinute,
    windowSec: 60
  });

  if (rate.allowed) {
    return true;
  }

  runtimeMetrics.increment("internal_rate_limited_total");
  input.reply.header("Retry-After", String(rate.retryAfterSec));
  input.request.log.warn(
    {
      request_id: input.request.id,
      route: routePath(input.request),
      ip: input.request.ip,
      scope: input.scope,
      current: rate.current
    },
    "internal.rate_limited"
  );
  input.reply.code(429).send({
    error: "Rate limit exceeded",
    code: "INTERNAL_RATE_LIMITED"
  });
  return false;
}

const internalRoutes: FastifyPluginAsync = async (app) => {
  app.post("/pubsub/ingest", async (request, reply) => {
    const allowed = await enforceInternalRateLimit({
      request,
      reply,
      scope: "internal_pubsub_ingest",
      maxPerMinute: INTERNAL_PUBSUB_RATE_LIMIT_PER_MIN
    });
    if (!allowed) {
      return;
    }

    const sharedSecret = config.PUBSUB_PUSH_SHARED_SECRET ?? (isDevelopmentMode() ? DEV_INTERNAL_SHARED_SECRET : undefined);
    if (!sharedSecret) {
      runtimeMetrics.increment("pubsub_push_rejected_total");
      logInternalAuthFailure(request, "pubsub_secret_not_configured");
      return reply.code(503).send({
        error: "Pub/Sub push endpoint is not configured",
        code: "PUBSUB_PUSH_NOT_CONFIGURED"
      });
    }

    const provided = request.headers["x-synteq-push-secret"];
    const candidate = Array.isArray(provided) ? provided[0] : provided;
    if (!candidate || candidate !== sharedSecret) {
      runtimeMetrics.increment("pubsub_push_rejected_total");
      logInternalAuthFailure(request, "pubsub_secret_mismatch");
      return reply.code(401).send({ error: "Unauthorized push request" });
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
    const sharedSecret = config.SCHEDULER_SHARED_SECRET ?? (isDevelopmentMode() ? DEV_INTERNAL_SHARED_SECRET : undefined);
    if (!sharedSecret) {
      logInternalAuthFailure(request, "scheduler_secret_not_configured");
      reply.code(503).send({
        error: "Scheduler trigger is not configured",
        code: "SCHEDULER_NOT_CONFIGURED"
      });
      return false;
    }

    const providedSecret = schedulerHeaderValue(request.headers["x-synteq-scheduler-secret"]);
    if (!providedSecret || providedSecret !== sharedSecret) {
      logInternalAuthFailure(request, "scheduler_header_secret_mismatch");
      reply.code(401).send({
        error: "Unauthorized scheduler request",
        code: "SCHEDULER_UNAUTHORIZED"
      });
      return false;
    }

    const authorization = schedulerHeaderValue(request.headers.authorization);
    const bearerToken = parseBearerToken(authorization);
    if (!bearerToken) {
      logInternalAuthFailure(request, "scheduler_bearer_missing");
      reply.code(401).send({
        error: "Missing bearer token",
        code: "SCHEDULER_BEARER_REQUIRED"
      });
      return false;
    }

    const usesLegacySecretBearer = bearerToken === sharedSecret;
    const usesSchedulerOidcBearer = isLikelyJwt(bearerToken);
    if (!usesLegacySecretBearer && !usesSchedulerOidcBearer) {
      logInternalAuthFailure(request, "scheduler_bearer_mismatch");
      reply.code(401).send({
        error: "Unauthorized scheduler bearer token",
        code: "SCHEDULER_BEARER_INVALID"
      });
      return false;
    }

    const cloudSchedulerHeader = schedulerHeaderValue(request.headers["x-cloudscheduler"]);
    if (!cloudSchedulerHeader || cloudSchedulerHeader.toLowerCase() !== "true") {
      logInternalAuthFailure(request, "scheduler_header_missing_or_invalid", {
        x_cloudscheduler: cloudSchedulerHeader ?? null
      });
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
      const allowed = await enforceInternalRateLimit({
        request,
        reply,
        scope: "internal_scheduler",
        maxPerMinute: INTERNAL_SCHEDULER_RATE_LIMIT_PER_MIN
      });
      if (!allowed) {
        return;
      }

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
