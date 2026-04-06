import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consumeRateLimitMock = vi.fn();
const ingestOperationalEventsMock = vi.fn();
const enqueueExecutionEventMock = vi.fn();
const enqueueHeartbeatEventMock = vi.fn();
const startTrialIfEligibleMock = vi.fn();
const assertOperationalSourceOwnershipMock = vi.fn();
const assertWorkflowSourceOwnershipMock = vi.fn();

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

vi.mock("../src/services/ingest-queue-service.js", () => ({
  enqueueExecutionEvent: enqueueExecutionEventMock,
  enqueueHeartbeatEvent: enqueueHeartbeatEventMock
}));

vi.mock("../src/services/ingest-source-ownership-service.js", () => ({
  assertOperationalSourceOwnership: assertOperationalSourceOwnershipMock,
  assertWorkflowSourceOwnership: assertWorkflowSourceOwnershipMock,
  isIngestSourceOwnershipError: (error: unknown) =>
    Boolean(error && typeof error === "object" && (error as { name?: string }).name === "IngestSourceOwnershipError")
}));

vi.mock("../src/services/tenant-trial-service.js", () => ({
  startTrialIfEligible: startTrialIfEligibleMock
}));

describe("ingest events api", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    consumeRateLimitMock.mockReset();
    ingestOperationalEventsMock.mockReset();
    enqueueExecutionEventMock.mockReset();
    enqueueHeartbeatEventMock.mockReset();
    startTrialIfEligibleMock.mockReset();
    assertOperationalSourceOwnershipMock.mockReset();
    assertWorkflowSourceOwnershipMock.mockReset();

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
    enqueueExecutionEventMock.mockResolvedValue({
      queued: true,
      fingerprint: "execution-fingerprint"
    });
    enqueueHeartbeatEventMock.mockResolvedValue({
      queued: true,
      fingerprint: "heartbeat-fingerprint"
    });
    startTrialIfEligibleMock.mockResolvedValue({
      code: "started"
    });
    assertOperationalSourceOwnershipMock.mockResolvedValue(undefined);
    assertWorkflowSourceOwnershipMock.mockResolvedValue(undefined);

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
        tenantId: "tenant-B",
        sourceOwner: expect.objectContaining({
          kind: "api_key"
        })
      })
    );
    expect(startTrialIfEligibleMock).toHaveBeenCalledWith({
      tenantId: "tenant-B",
      source: "auto_ingest"
    });
  });

  it("rejects unregistered operational source ownership", async () => {
    const ownershipError = Object.assign(new Error("Source is not registered"), {
      name: "IngestSourceOwnershipError",
      code: "INGEST_SOURCE_UNREGISTERED",
      statusCode: 403
    });
    assertOperationalSourceOwnershipMock.mockRejectedValueOnce(ownershipError);

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
          timestamp: "2026-03-17T10:00:00Z"
        }
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: "INGEST_SOURCE_UNREGISTERED"
    });
    expect(ingestOperationalEventsMock).not.toHaveBeenCalled();
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

  it("does not auto-start trial for simulation-tagged operational ingest", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/ingest/events",
      headers: {
        "x-synteq-key": "key-tenant-a"
      },
      payload: {
        events: [
          {
            source: "simulation",
            event_type: "synthetic_probe",
            system: "demo",
            timestamp: "2026-03-17T10:03:00Z",
            metadata: {
              simulation: true
            }
          }
        ]
      }
    });

    expect(startTrialIfEligibleMock).not.toHaveBeenCalled();
  });

  it("accepts execution ingest for registered workflow source", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/ingest/execution",
      headers: {
        "x-synteq-key": "key-tenant-a"
      },
      payload: {
        event_ts: "2026-03-17T10:00:00Z",
        tenant_id: "tenant-A",
        workflow_id: "wf-1",
        workflow_slug: "payments-daily",
        environment: "prod",
        execution_id: "exec-1",
        status: "success",
        retry_count: 0
      }
    });

    expect(response.statusCode).toBe(200);
    expect(assertWorkflowSourceOwnershipMock).toHaveBeenCalledWith({
      tenantId: "tenant-A",
      workflowId: "wf-1"
    });
    expect(enqueueExecutionEventMock).toHaveBeenCalled();
  });

  it("rejects execution ingest for unregistered workflow source", async () => {
    const ownershipError = Object.assign(new Error("Workflow source is not registered for this tenant"), {
      name: "IngestSourceOwnershipError",
      code: "INGEST_SOURCE_UNREGISTERED",
      statusCode: 403
    });
    assertWorkflowSourceOwnershipMock.mockRejectedValueOnce(ownershipError);

    const response = await app.inject({
      method: "POST",
      url: "/v1/ingest/execution",
      headers: {
        "x-synteq-key": "key-tenant-a"
      },
      payload: {
        event_ts: "2026-03-17T10:00:00Z",
        tenant_id: "tenant-A",
        workflow_id: "wf-missing",
        workflow_slug: "missing",
        environment: "prod",
        execution_id: "exec-2",
        status: "failed",
        retry_count: 1
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: "INGEST_SOURCE_UNREGISTERED"
    });
    expect(enqueueExecutionEventMock).not.toHaveBeenCalled();
  });

  it("rejects heartbeat ingest for unregistered workflow source", async () => {
    const ownershipError = Object.assign(new Error("Workflow source is not registered for this tenant"), {
      name: "IngestSourceOwnershipError",
      code: "INGEST_SOURCE_UNREGISTERED",
      statusCode: 403
    });
    assertWorkflowSourceOwnershipMock.mockRejectedValueOnce(ownershipError);

    const response = await app.inject({
      method: "POST",
      url: "/v1/ingest/heartbeat",
      headers: {
        "x-synteq-key": "key-tenant-a"
      },
      payload: {
        tenant_id: "tenant-A",
        workflow_id: "wf-missing",
        workflow_slug: "missing",
        environment: "prod",
        heartbeat_ts: "2026-03-17T10:00:00Z",
        expected_interval_sec: 60
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: "INGEST_SOURCE_UNREGISTERED"
    });
    expect(enqueueHeartbeatEventMock).not.toHaveBeenCalled();
  });
});
