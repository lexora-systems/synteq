import Fastify from "fastify";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifySensible from "@fastify/sensible";
import fastifyRawBody from "fastify-raw-body";
import crypto from "node:crypto";
import { config } from "./config.js";
import { registerAuthAndSecurity } from "./plugins/auth.js";
import authRoutes from "./routes/auth.js";
import ingestRoutes from "./routes/ingest.js";
import workflowRoutes from "./routes/workflows.js";
import metricsRoutes from "./routes/metrics.js";
import incidentsRoutes from "./routes/incidents.js";
import internalRoutes from "./routes/internal.js";
import { runtimeMetrics } from "./lib/runtime-metrics.js";
import { prisma } from "./lib/prisma.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === "production" ? "info" : "debug"
    },
    genReqId: () => crypto.randomUUID()
  });

  await app.register(fastifySensible);
  await app.register(fastifyRawBody, {
    field: "rawBody",
    global: false,
    runFirst: true
  });
  await app.register(fastifyRateLimit, {
    global: false,
    max: 100,
    timeWindow: "1 minute"
  });

  await registerAuthAndSecurity(app);

  app.addHook("onRequest", async (request) => {
    request.log.info(
      {
        request_id: request.id,
        method: request.method,
        url: request.url
      },
      "request.start"
    );
    runtimeMetrics.increment("http_requests_total");
  });

  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      {
        request_id: request.id,
        method: request.method,
        url: request.url,
        status_code: reply.statusCode,
        response_time_ms: reply.elapsedTime
      },
      "request.end"
    );
  });

  app.get("/health", async () => ({ ok: true, service: "synteq-api", ts: new Date().toISOString() }));
  app.get("/healthz", async () => ({ ok: true, service: "synteq-api", ts: new Date().toISOString() }));
  app.get("/ready", async (_, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true, db: "up", ts: new Date().toISOString() };
    } catch (error) {
      reply.code(503);
      return {
        ok: false,
        db: "down",
        error: error instanceof Error ? error.message : "unknown error"
      };
    }
  });
  app.get("/metrics", async (_, reply) => {
    reply.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    return runtimeMetrics.toPrometheusText();
  });
  app.get("/metrics/json", async () => runtimeMetrics.snapshot());

  await app.register(authRoutes, { prefix: "/v1" });
  await app.register(ingestRoutes, { prefix: "/v1" });
  await app.register(workflowRoutes, { prefix: "/v1" });
  await app.register(metricsRoutes, { prefix: "/v1" });
  await app.register(incidentsRoutes, { prefix: "/v1" });
  await app.register(internalRoutes, { prefix: "/v1/internal" });

  app.setErrorHandler((error, request, reply) => {
    const typedError = error as Error & { statusCode?: number };

    if (typedError.name === "ValidationError") {
      reply.code(400).send({
        error: "Bad Request",
        message: typedError.message,
        request_id: request.id
      });
      return;
    }

    request.log.error({ err: error, request_id: request.id }, "Unhandled error");
    reply.code(typedError.statusCode ?? 500).send({
      error: "Internal Server Error",
      message: typedError.message,
      request_id: request.id
    });
  });

  return app;
}
