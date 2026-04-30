import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runSchedulerTaskMock = vi.fn();
const processQueueMessageMock = vi.fn();
const consumeRateLimitMock = vi.fn();
const configMock: {
  NODE_ENV: string;
  PUBSUB_PUSH_SHARED_SECRET: string | undefined;
  SCHEDULER_SHARED_SECRET: string | undefined;
} = {
  NODE_ENV: "test",
  PUBSUB_PUSH_SHARED_SECRET: "pubsub-test-secret-with-32-characters",
  SCHEDULER_SHARED_SECRET: "scheduler-test-secret-with-32-characters"
};

vi.mock("../src/config.js", () => ({
  config: configMock
}));

vi.mock("../src/services/scheduler-execution-service.js", () => ({
  runSchedulerTask: runSchedulerTaskMock
}));

vi.mock("../src/services/pubsub-ingest-worker-service.js", () => ({
  processQueueMessage: processQueueMessageMock
}));

vi.mock("../src/services/rate-limit-service.js", () => ({
  consumeRateLimit: consumeRateLimitMock
}));

describe("internal scheduler routes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    runSchedulerTaskMock.mockReset();
    processQueueMessageMock.mockReset();
    consumeRateLimitMock.mockReset();
    consumeRateLimitMock.mockResolvedValue({
      allowed: true,
      current: 1,
      retryAfterSec: 60
    });
    configMock.NODE_ENV = "test";
    configMock.PUBSUB_PUSH_SHARED_SECRET = "pubsub-test-secret-with-32-characters";
    configMock.SCHEDULER_SHARED_SECRET = "scheduler-test-secret-with-32-characters";

    app = Fastify();
    const internalRoutes = (await import("../src/routes/internal.js")).default;
    await app.register(internalRoutes, { prefix: "/v1/internal" });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  function schedulerHeaders(overrides?: Record<string, string>) {
    return {
      "x-synteq-scheduler-secret": "scheduler-test-secret-with-32-characters",
      authorization: "Bearer scheduler-test-secret-with-32-characters",
      "x-cloudscheduler": "true",
      ...(overrides ?? {})
    };
  }

  it("rejects requests without scheduler shared secret", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/internal/scheduler/aggregate",
      headers: {
        authorization: "Bearer scheduler-test-secret-with-32-characters",
        "x-cloudscheduler": "true"
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: "SCHEDULER_UNAUTHORIZED"
    });
    expect(runSchedulerTaskMock).not.toHaveBeenCalled();
  });

  it("fails fast when scheduler shared secret is missing outside development", async () => {
    configMock.SCHEDULER_SHARED_SECRET = undefined;
    const response = await app.inject({
      method: "POST",
      url: "/v1/internal/scheduler/aggregate",
      headers: {
        authorization: "Bearer scheduler-test-secret-with-32-characters",
        "x-cloudscheduler": "true"
      }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: "SCHEDULER_NOT_CONFIGURED"
    });
    expect(runSchedulerTaskMock).not.toHaveBeenCalled();
  });

  it("rejects requests without bearer auth header", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/internal/scheduler/anomaly",
      headers: schedulerHeaders({
        authorization: ""
      })
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: "SCHEDULER_BEARER_REQUIRED"
    });
    expect(runSchedulerTaskMock).not.toHaveBeenCalled();
  });

  it("rejects requests with bearer token that is neither shared secret nor JWT", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/internal/scheduler/anomaly",
      headers: schedulerHeaders({
        authorization: "Bearer scheduler-opaque-token"
      })
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: "SCHEDULER_BEARER_INVALID"
    });
    expect(runSchedulerTaskMock).not.toHaveBeenCalled();
  });

  it("accepts JWT bearer token for Cloud Scheduler OIDC mode", async () => {
    runSchedulerTaskMock.mockResolvedValueOnce({
      task: "anomaly",
      stage: "anomaly",
      skipped: false,
      reason: null
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/internal/scheduler/anomaly",
      headers: schedulerHeaders({
        authorization:
          "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50ZXEtc2NoZWR1bGVyIn0.longsignaturevalue12345"
      })
    });

    expect(response.statusCode).toBe(200);
    expect(runSchedulerTaskMock).toHaveBeenCalledWith("anomaly");
    expect(response.json()).toMatchObject({
      ok: true,
      task: "anomaly",
      stage: "anomaly",
      skipped: false,
      reason: null
    });
  });

  it("rejects requests without Cloud Scheduler marker header", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/internal/scheduler/alerts",
      headers: schedulerHeaders({
        "x-cloudscheduler": "false"
      })
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: "SCHEDULER_HEADER_REQUIRED"
    });
    expect(runSchedulerTaskMock).not.toHaveBeenCalled();
  });

  it("rejects malformed trigger payload", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/internal/scheduler/aggregate",
      headers: schedulerHeaders(),
      payload: {
        trigger_id: 123
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "SCHEDULER_BAD_REQUEST"
    });
    expect(runSchedulerTaskMock).not.toHaveBeenCalled();
  });

  it("rate-limits scheduler internal endpoint requests", async () => {
    consumeRateLimitMock.mockResolvedValueOnce({
      allowed: false,
      current: 121,
      retryAfterSec: 30
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/internal/scheduler/aggregate",
      headers: schedulerHeaders()
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      code: "INTERNAL_RATE_LIMITED"
    });
    expect(runSchedulerTaskMock).not.toHaveBeenCalled();
  });

  it("runs scheduler task and returns success payload", async () => {
    runSchedulerTaskMock.mockResolvedValueOnce({
      task: "aggregate",
      stage: "aggregate",
      skipped: false,
      reason: null
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/internal/scheduler/aggregate",
      headers: schedulerHeaders(),
      payload: {
        trigger_id: "aggregate-1"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(runSchedulerTaskMock).toHaveBeenCalledWith("aggregate");
    expect(response.json()).toMatchObject({
      ok: true,
      task: "aggregate",
      stage: "aggregate",
      skipped: false,
      reason: null,
      trigger_id: "aggregate-1"
    });
  });

  it("returns accepted for lease-skipped duplicate trigger", async () => {
    runSchedulerTaskMock.mockResolvedValueOnce({
      task: "alerts",
      stage: "alerts",
      skipped: true,
      reason: "lease_not_acquired"
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/internal/scheduler/alerts",
      headers: schedulerHeaders()
    });

    expect(response.statusCode).toBe(202);
    expect(runSchedulerTaskMock).toHaveBeenCalledWith("alerts");
    expect(response.json()).toMatchObject({
      ok: true,
      skipped: true,
      reason: "lease_not_acquired"
    });
  });

  it("rejects pubsub push requests without the configured push secret", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/internal/pubsub/ingest",
      payload: {}
    });

    expect(response.statusCode).toBe(401);
    expect(processQueueMessageMock).not.toHaveBeenCalled();
  });

  it("fails fast when pubsub push secret is missing outside development", async () => {
    configMock.PUBSUB_PUSH_SHARED_SECRET = undefined;
    const response = await app.inject({
      method: "POST",
      url: "/v1/internal/pubsub/ingest",
      headers: {
        "x-synteq-push-secret": "any"
      },
      payload: {}
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: "PUBSUB_PUSH_NOT_CONFIGURED"
    });
  });
});
