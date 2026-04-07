import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hmacSha256 } from "../src/utils/crypto.js";

const consumeRateLimitMock = vi.fn();
const githubIntegrationFindManyMock = vi.fn();
const githubIntegrationUpdateMock = vi.fn();
const ingestOperationalEventsMock = vi.fn();
const redisSetNxMock = vi.fn();

vi.mock("../src/config.js", () => ({
  config: {
    INGEST_RATE_LIMIT_PER_MIN: 600,
    MAX_INGEST_BODY_BYTES: 262_144
  }
}));

vi.mock("../src/services/rate-limit-service.js", () => ({
  consumeRateLimit: consumeRateLimitMock
}));

vi.mock("../src/lib/redis.js", () => ({
  redisKey: (...parts: Array<string | number>) => parts.join(":"),
  redisSetNx: redisSetNxMock
}));

vi.mock("../src/services/operational-event-ingestion-service.js", () => ({
  ingestOperationalEvents: ingestOperationalEventsMock
}));

vi.mock("../src/lib/prisma.js", () => ({
  prisma: {
    gitHubIntegration: {
      findMany: githubIntegrationFindManyMock,
      update: githubIntegrationUpdateMock
    }
  }
}));

function sign(secret: string, payload: Record<string, unknown>) {
  const raw = JSON.stringify(payload);
  return `sha256=${hmacSha256(secret, raw)}`;
}

describe("github webhook api", () => {
  let app: ReturnType<typeof Fastify>;
  const integration = {
    id: "gh-int-1",
    tenant_id: "tenant-A",
    webhook_secret: "github-secret-123",
    repository_full_name: "acme/payments"
  };

  beforeEach(async () => {
    consumeRateLimitMock.mockReset();
    githubIntegrationFindManyMock.mockReset();
    githubIntegrationUpdateMock.mockReset();
    ingestOperationalEventsMock.mockReset();
    redisSetNxMock.mockReset();

    consumeRateLimitMock.mockResolvedValue({
      allowed: true,
      current: 1,
      retryAfterSec: 60
    });
    githubIntegrationFindManyMock.mockImplementation(
      async (query: { where?: { webhook_id?: string; is_active?: boolean } } | undefined) => {
        const where = query?.where;
        if (where?.webhook_id) {
          return where.webhook_id === "hook-1" && where.is_active ? [integration] : [];
        }
        if (where?.is_active) {
          return [integration];
        }
        return [];
      }
    );
    githubIntegrationUpdateMock.mockResolvedValue(undefined);
    redisSetNxMock.mockResolvedValue(true);
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
    app.setErrorHandler((error: Error, _request: unknown, reply: any) => {
      if (error.name === "ValidationError") {
        return reply.code(400).send({ error: "Bad Request", message: error.message });
      }
      return reply.code(500).send({ error: "Internal Server Error", message: error.message });
    });

    const routes = (await import("../src/routes/github-webhook.js")).default;
    await app.register(routes, { prefix: "/v1" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("accepts a valid github webhook signature and ingests mapped events", async () => {
    const payload = {
      action: "in_progress",
      repository: {
        full_name: "acme/payments",
        name: "payments"
      },
      workflow_run: {
        id: 101,
        status: "in_progress",
        conclusion: null,
        created_at: "2026-03-17T10:00:00Z",
        run_started_at: "2026-03-17T10:01:00Z",
        updated_at: "2026-03-17T10:02:00Z"
      },
      sender: {
        login: "octocat"
      }
    };

    const response = await app.inject({
      method: "POST",
      url: "/v1/integrations/github/webhook",
      headers: {
        "x-github-hook-id": "hook-1",
        "x-github-event": "workflow_run",
        "x-github-delivery": "delivery-1",
        "x-hub-signature-256": sign(integration.webhook_secret, payload)
      },
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      processed: true,
      accepted: 1,
      ingested: 1,
      duplicates: 0,
      persisted: 1
    });
    expect(ingestOperationalEventsMock).toHaveBeenCalled();
  });

  it("accepts webhook when provider hook id differs but signature matches integration secret", async () => {
    const payload = {
      action: "completed",
      repository: {
        full_name: "acme/payments",
        name: "payments"
      },
      workflow_run: {
        id: 110,
        status: "completed",
        conclusion: "success",
        created_at: "2026-03-17T10:00:00Z",
        run_started_at: "2026-03-17T10:01:00Z",
        updated_at: "2026-03-17T10:02:00Z"
      }
    };

    const response = await app.inject({
      method: "POST",
      url: "/v1/integrations/github/webhook",
      headers: {
        "x-github-hook-id": "provider-hook-9999",
        "x-github-event": "workflow_run",
        "x-hub-signature-256": sign(integration.webhook_secret, payload)
      },
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(ingestOperationalEventsMock).toHaveBeenCalled();
  });

  it("rejects invalid github webhook signature", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/integrations/github/webhook",
      headers: {
        "x-github-hook-id": "hook-1",
        "x-github-event": "workflow_run",
        "x-hub-signature-256": "sha256=deadbeef"
      },
      payload: {
        action: "requested",
        repository: {
          full_name: "acme/payments"
        },
        workflow_run: {
          id: 1
        }
      }
    });

    expect(response.statusCode).toBe(401);
    expect(ingestOperationalEventsMock).not.toHaveBeenCalled();
  });

  it("rejects unknown webhook identity when signature does not match any integration", async () => {
    const payload = {
      action: "requested",
      repository: {
        full_name: "acme/payments"
      },
      workflow_run: {
        id: 2
      }
    };

    const response = await app.inject({
      method: "POST",
      url: "/v1/integrations/github/webhook",
      headers: {
        "x-github-hook-id": "provider-hook-unknown",
        "x-github-event": "workflow_run",
        "x-hub-signature-256": sign("not-the-integration-secret", payload)
      },
      payload
    });

    expect(response.statusCode).toBe(401);
    expect(ingestOperationalEventsMock).not.toHaveBeenCalled();
  });

  it("rejects cross-tenant spoof when hook id maps to one integration but signature belongs to another", async () => {
    const integrationB = {
      id: "gh-int-2",
      tenant_id: "tenant-B",
      webhook_secret: "github-secret-tenant-b",
      repository_full_name: "beta/payments"
    };
    githubIntegrationFindManyMock.mockImplementationOnce(
      async (query: { where?: { webhook_id?: string; is_active?: boolean } } | undefined) => {
        const where = query?.where;
        if (where?.webhook_id === "hook-2" && where.is_active) {
          return [integrationB];
        }
        return [];
      }
    );

    const payload = {
      action: "completed",
      repository: {
        full_name: "beta/payments",
        name: "payments"
      },
      workflow_run: {
        id: 320,
        status: "completed",
        conclusion: "failure",
        created_at: "2026-03-17T10:00:00Z",
        run_started_at: "2026-03-17T10:01:00Z",
        updated_at: "2026-03-17T10:02:00Z"
      }
    };

    const response = await app.inject({
      method: "POST",
      url: "/v1/integrations/github/webhook",
      headers: {
        "x-github-hook-id": "hook-2",
        "x-github-event": "workflow_run",
        "x-hub-signature-256": sign(integration.webhook_secret, payload)
      },
      payload
    });

    expect(response.statusCode).toBe(401);
    expect(ingestOperationalEventsMock).not.toHaveBeenCalled();
  });

  it("resolves tenant from github integration mapping, not payload", async () => {
    const payload = {
      tenant_id: "tenant-spoofed",
      action: "completed",
      repository: {
        full_name: "acme/payments",
        name: "payments"
      },
      workflow_run: {
        id: 301,
        status: "completed",
        conclusion: "failure",
        created_at: "2026-03-17T10:00:00Z",
        run_started_at: "2026-03-17T10:01:00Z",
        updated_at: "2026-03-17T10:02:00Z"
      }
    };

    const response = await app.inject({
      method: "POST",
      url: "/v1/integrations/github/webhook",
      headers: {
        "x-github-hook-id": "hook-1",
        "x-github-event": "workflow_run",
        "x-github-delivery": "delivery-tenant",
        "x-hub-signature-256": sign(integration.webhook_secret, payload)
      },
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(ingestOperationalEventsMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        tenantId: "tenant-A",
        sourceOwner: expect.objectContaining({
          kind: "github_integration"
        }),
        idempotencyHints: [expect.objectContaining({ namespace: "github_delivery" })]
      })
    );
  });

  it("maps workflow_run payload to normalized workflow events", async () => {
    const payload = {
      action: "completed",
      repository: {
        full_name: "acme/payments",
        name: "payments"
      },
      workflow_run: {
        id: 400,
        status: "completed",
        conclusion: "failure",
        name: "deploy",
        created_at: "2026-03-17T10:00:00Z",
        run_started_at: "2026-03-17T10:01:00Z",
        updated_at: "2026-03-17T10:02:00Z"
      }
    };

    await app.inject({
      method: "POST",
      url: "/v1/integrations/github/webhook",
      headers: {
        "x-github-hook-id": "hook-1",
        "x-github-event": "workflow_run",
        "x-hub-signature-256": sign(integration.webhook_secret, payload)
      },
      payload
    });

    const [firstArg] = ingestOperationalEventsMock.mock.calls[0] as [{ events: Array<{ event_type: string }> }];
    expect(firstArg.events[0].event_type).toBe("workflow_failed");
  });

  it("maps workflow_job payload to normalized job events", async () => {
    const payload = {
      action: "completed",
      repository: {
        full_name: "acme/payments",
        name: "payments"
      },
      workflow_job: {
        id: 500,
        run_id: 400,
        status: "completed",
        conclusion: "failure",
        created_at: "2026-03-17T10:01:00Z",
        started_at: "2026-03-17T10:02:00Z",
        completed_at: "2026-03-17T10:03:00Z"
      }
    };

    await app.inject({
      method: "POST",
      url: "/v1/integrations/github/webhook",
      headers: {
        "x-github-hook-id": "hook-1",
        "x-github-event": "workflow_job",
        "x-hub-signature-256": sign(integration.webhook_secret, payload)
      },
      payload
    });

    const [firstArg] = ingestOperationalEventsMock.mock.calls[0] as [{ events: Array<{ event_type: string }> }];
    expect(firstArg.events[0].event_type).toBe("job_failed");
  });

  it("safely no-ops unsupported github event types", async () => {
    const payload = {
      action: "opened",
      repository: {
        full_name: "acme/payments",
        name: "payments"
      }
    };

    const response = await app.inject({
      method: "POST",
      url: "/v1/integrations/github/webhook",
      headers: {
        "x-github-hook-id": "hook-1",
        "x-github-event": "issues",
        "x-hub-signature-256": sign(integration.webhook_secret, payload)
      },
      payload
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      ok: true,
      processed: false
    });
    expect(ingestOperationalEventsMock).not.toHaveBeenCalled();
  });

  it("treats repeated github delivery id as duplicate no-op fast path", async () => {
    redisSetNxMock.mockResolvedValueOnce(false);
    const payload = {
      action: "completed",
      repository: {
        full_name: "acme/payments",
        name: "payments"
      },
      workflow_run: {
        id: 501,
        status: "completed",
        conclusion: "failure",
        created_at: "2026-03-17T10:01:00Z",
        run_started_at: "2026-03-17T10:02:00Z",
        updated_at: "2026-03-17T10:03:00Z"
      }
    };

    const response = await app.inject({
      method: "POST",
      url: "/v1/integrations/github/webhook",
      headers: {
        "x-github-hook-id": "hook-1",
        "x-github-event": "workflow_run",
        "x-github-delivery": "delivery-dup",
        "x-hub-signature-256": sign(integration.webhook_secret, payload)
      },
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      processed: false,
      duplicate: true
    });
    expect(ingestOperationalEventsMock).not.toHaveBeenCalled();
  });

  it("keeps repository scope enforcement for github integration", async () => {
    const payload = {
      action: "completed",
      repository: {
        full_name: "acme/other-repo",
        name: "other-repo"
      },
      workflow_run: {
        id: 520,
        status: "completed",
        conclusion: "failure",
        created_at: "2026-03-17T10:01:00Z",
        run_started_at: "2026-03-17T10:02:00Z",
        updated_at: "2026-03-17T10:03:00Z"
      }
    };

    const response = await app.inject({
      method: "POST",
      url: "/v1/integrations/github/webhook",
      headers: {
        "x-github-hook-id": "hook-1",
        "x-github-event": "workflow_run",
        "x-hub-signature-256": sign(integration.webhook_secret, payload)
      },
      payload
    });

    expect(response.statusCode).toBe(403);
    expect(ingestOperationalEventsMock).not.toHaveBeenCalled();
  });

  it("keeps github webhook rate limiting behavior", async () => {
    consumeRateLimitMock.mockResolvedValueOnce({
      allowed: false,
      current: 601,
      retryAfterSec: 55
    });

    const payload = {
      action: "requested",
      repository: {
        full_name: "acme/payments",
        name: "payments"
      },
      workflow_run: {
        id: 601
      }
    };

    const response = await app.inject({
      method: "POST",
      url: "/v1/integrations/github/webhook",
      headers: {
        "x-github-hook-id": "hook-1",
        "x-github-event": "workflow_run",
        "x-hub-signature-256": sign(integration.webhook_secret, payload)
      },
      payload
    });

    expect(response.statusCode).toBe(429);
    expect(githubIntegrationFindManyMock).not.toHaveBeenCalled();
    expect(ingestOperationalEventsMock).not.toHaveBeenCalled();
  });
});
