import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consumeRateLimitMock = vi.fn();
const ingestOperationalEventsMock = vi.fn();

vi.mock("../src/config.js", () => ({
  config: {
    INGEST_RATE_LIMIT_PER_MIN: 600,
    MAX_INGEST_BODY_BYTES: 262_144
  }
}));

vi.mock("../src/services/rate-limit-service.js", () => ({
  consumeRateLimit: consumeRateLimitMock
}));

vi.mock("../src/services/operational-event-ingestion-service.js", () => ({
  ingestOperationalEvents: ingestOperationalEventsMock
}));

describe("ingest events api", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    consumeRateLimitMock.mockReset();
    ingestOperationalEventsMock.mockReset();

    consumeRateLimitMock.mockResolvedValue({
      allowed: true,
      current: 1,
      retryAfterSec: 60
    });

    ingestOperationalEventsMock.mockResolvedValue({
      accepted: 1,
      ingested: 1,
      duplicates: 0,
      skipped: 0,
      failed: 0,
      persisted: 1,
      analysis_handoff: {
        mode: "operational_events_table",
        queued: 1,
        next_stage: "pending_worker"
      }
    });

    app = Fastify();
    app.decorate("requireDashboardAuth", async () => undefined);
    app.decorate("requireRoles", () => async () => undefined);
    app.decorate("requirePermissions", () => async () => undefined);
    app.decorate("requireIngestionKey", async (request: any, reply: any) => {
      const raw = request.headers["x-synteq-key"];
      const key = Array.isArray(raw) ? raw[0] : raw;
      if (!key) {
        return reply.code(401).send({ error: "Missing X-Synteq-Key header" });
      }

      const tenantByKey: Record<string, string> = {
        "key-tenant-a": "tenant-A",
        "key-tenant-b": "tenant-B"
      };

      const tenantId = tenantByKey[key];
      if (!tenantId) {
        return reply.code(401).send({ error: "Invalid API key" });
      }

      request.tenantId = tenantId;
      request.apiKeyId = `api-${tenantId.toLowerCase()}`;
    });
    app.decorate("requireIngestionSignature", async () => undefined);

    app.setErrorHandler((error: Error, _request: unknown, reply: any) => {
      if (error.name === "ValidationError") {
        return reply.code(400).send({ error: "Bad Request", message: error.message });
      }

      return reply.code(500).send({ error: "Internal Server Error" });
    });

    const ingestRoutes = (await import("../src/routes/ingest.js")).default;
    await app.register(ingestRoutes, { prefix: "/v1" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("ingests a single event and returns idempotency-aware counters", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/ingest/events",
      headers: {
        "x-synteq-key": "key-tenant-a"
      },
      payload: {
        event: {
          source: "github_actions",
          event_type: "workflow_failed",
          service: "payments-api",
          environment: "Production",
          timestamp: "2026-03-17T10:00:00Z",
          severity: "high",
          correlation_key: "deploy-123",
          metadata: {
            repository: "acme/payments"
          },
          attributes: {
            branch: "main"
          }
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      accepted: 1,
      ingested: 1,
      duplicates: 0,
      skipped: 0,
      failed: 0,
      persisted: 1
    });
  });

  it("associates events to the tenant resolved from ingestion auth", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/ingest/events",
      headers: {
        "x-synteq-key": "key-tenant-b"
      },
      payload: {
        event: {
          source: "ci",
          event_type: "deployment_started",
          system: "billing",
          timestamp: "2026-03-17T10:01:00Z"
        }
      }
    });

    expect(ingestOperationalEventsMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        tenantId: "tenant-B"
      })
    );
  });

  it("enforces ingestion key auth", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/ingest/events",
      payload: {
        event: {
          source: "ci",
          event_type: "deployment_started",
          system: "billing",
          timestamp: "2026-03-17T10:01:00Z"
        }
      }
    });

    expect(response.statusCode).toBe(401);
    expect(ingestOperationalEventsMock).not.toHaveBeenCalled();
  });

  it("rejects malformed payloads", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/ingest/events",
      headers: {
        "x-synteq-key": "key-tenant-a"
      },
      payload: {
        event: {
          event_type: "workflow_failed",
          timestamp: "bad-date"
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(ingestOperationalEventsMock).not.toHaveBeenCalled();
  });

  it("supports small batch ingestion", async () => {
    ingestOperationalEventsMock.mockResolvedValueOnce({
      accepted: 2,
      ingested: 1,
      duplicates: 1,
      skipped: 0,
      failed: 0,
      persisted: 1,
      analysis_handoff: {
        mode: "operational_events_table",
        queued: 1,
        next_stage: "pending_worker"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/ingest/events",
      headers: {
        "x-synteq-key": "key-tenant-a"
      },
      payload: {
        events: [
          {
            source: "github_actions",
            event_type: "workflow_failed",
            service: "payments-api",
            timestamp: "2026-03-17T10:00:00Z"
          },
          {
            source: "github_actions",
            event_type: "workflow_failed",
            service: "payments-api",
            timestamp: "2026-03-17T10:00:00Z"
          }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      accepted: 2,
      ingested: 1,
      duplicates: 1
    });
  });

  it("returns partial-failure counters when some events fail", async () => {
    ingestOperationalEventsMock.mockResolvedValueOnce({
      accepted: 2,
      ingested: 1,
      duplicates: 0,
      skipped: 0,
      failed: 1,
      persisted: 1,
      analysis_handoff: {
        mode: "operational_events_table",
        queued: 1,
        next_stage: "pending_worker"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/ingest/events",
      headers: {
        "x-synteq-key": "key-tenant-a"
      },
      payload: {
        events: [
          {
            source: "webhook",
            event_type: "deployment_failed",
            system: "edge-gateway",
            timestamp: "2026-03-17T10:03:00Z"
          },
          {
            source: "webhook",
            event_type: "deployment_failed",
            system: "edge-gateway",
            timestamp: "2026-03-17T10:04:00Z"
          }
        ]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: false,
      failed: 1,
      ingested: 1
    });
  });
});
