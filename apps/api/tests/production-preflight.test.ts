import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config.js";
import { assertProductionPreflight, validateProductionPreflight } from "../src/preflight/production-preflight.js";

function buildConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    NODE_ENV: "development",
    PORT: 8080,
    DATABASE_URL: "mysql://root:root@localhost:3306/synteq",
    REDIS_URL: "redis://redis:6379",
    REDIS_REQUIRED: true,
    REDIS_KEY_PREFIX: "synteq",
    BIGQUERY_PROJECT_ID: "prod-project",
    BIGQUERY_DATASET: "synteq",
    BIGQUERY_KEY_JSON: undefined,
    BIGQUERY_AGG_LOOKBACK_MINUTES: 15,
    PUBSUB_PROJECT_ID: "prod-project",
    PUBSUB_TOPIC_INGEST: "synteq-ingest",
    PUBSUB_PUSH_SHARED_SECRET: "prod-pubsub-shared-secret-with-32-plus-characters",
    SCHEDULER_SHARED_SECRET: "prod-scheduler-shared-secret-with-32-plus-characters",
    ENABLE_SECRET_MANAGER: true,
    SYNTEQ_API_KEY_SALT: "prod-api-key-salt-with-32-plus-characters",
    INGEST_HMAC_SECRET: "prod-ingest-hmac-secret-with-32-plus-characters",
    INGEST_HMAC_REQUIRED: true,
    STRICT_CORS: false,
    REQUIRE_WEB_BASE_URL: false,
    ENFORCE_PUBSUB_ONLY: false,
    INGEST_SIGNATURE_MAX_SKEW_SEC: 300,
    INGEST_DEDUPE_TTL_SEC: 900,
    INGEST_RATE_LIMIT_PER_MIN: 600,
    MAX_INGEST_BODY_BYTES: 262_144,
    SLACK_DEFAULT_WEBHOOK_URL: undefined,
    JWT_SECRET: "prod-jwt-secret-with-32-plus-characters",
    ACCESS_TOKEN_TTL: "15m",
    REFRESH_TOKEN_TTL: "30d",
    BREVO_API_KEY: "xkeysib-realistic-production-key-value",
    EMAIL_DEV_MODE: false,
    DASHBOARD_ADMIN_EMAIL: "admin@example.com",
    DASHBOARD_ADMIN_PASSWORD: "StrongAdminPassword123!",
    DEFAULT_TENANT_ID: undefined,
    ALLOW_PUBLIC_SIGNUP: true,
    CORS_ORIGIN: "https://app.example.com",
    WEB_BASE_URL: "https://app.example.com",
    INVITE_RATE_LIMIT_PER_HOUR: 20,
    INVITE_PER_EMAIL_PER_DAY: 3,
    AUTH_LOGIN_MAX_ATTEMPTS_PER_IP: 10,
    AUTH_LOGIN_MAX_ATTEMPTS_PER_EMAIL: 5,
    AUTH_LOGIN_WINDOW_SEC: 900,
    AUTH_LOGIN_LOCKOUT_SEC: 900,
    LOGOUT_ALL_ENABLED: true,
    METRICS_CACHE_TTL_SEC: 45,
    INCIDENT_ESCALATION_MINUTES: 20,
    INCIDENT_COOLDOWN_WINDOWS: 3,
    ALERT_DISPATCH_MAX_RETRIES: 3,
    ALERT_DISPATCH_BACKOFF_BASE_SEC: 30,
    FX_RATE_USD: 1,
    FX_RATE_PHP: 56,
    FX_RATE_EUR: 0.92,
    FX_RATE_GBP: 0.79,
    FX_RATE_JPY: 150,
    FX_RATE_AUD: 1.53,
    FX_RATE_CAD: 1.36,
    ...overrides
  };
}

describe("production preflight", () => {
  it("skips strict enforcement outside production", () => {
    const result = validateProductionPreflight(
      buildConfig({
        NODE_ENV: "development",
        REDIS_REQUIRED: false,
        INGEST_HMAC_REQUIRED: false,
        EMAIL_DEV_MODE: true,
        CORS_ORIGIN: "*",
        PUBSUB_PROJECT_ID: undefined,
        PUBSUB_TOPIC_INGEST: undefined
      })
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails in production and aggregates unsafe settings", () => {
    const result = validateProductionPreflight(
      buildConfig({
        NODE_ENV: "production",
        SCHEDULER_SHARED_SECRET: undefined,
        REDIS_REQUIRED: false,
        REDIS_URL: undefined,
        INGEST_HMAC_REQUIRED: false,
        INGEST_HMAC_SECRET: "dev-only-ingest-hmac-secret",
        CORS_ORIGIN: "*",
        JWT_SECRET: "replace-with-long-random-jwt-secret",
        SYNTEQ_API_KEY_SALT: "replace-with-long-random-salt",
        PUBSUB_PUSH_SHARED_SECRET: "dev-only-pubsub-shared-secret",
        PUBSUB_PROJECT_ID: undefined,
        PUBSUB_TOPIC_INGEST: undefined,
        EMAIL_DEV_MODE: true,
        BREVO_API_KEY: undefined,
        DASHBOARD_ADMIN_PASSWORD: "ChangeMe123!"
      })
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "SCHEDULER_SHARED_SECRET must be set in production.",
        "JWT_SECRET looks placeholder-grade and is not allowed in production.",
        "SYNTEQ_API_KEY_SALT looks placeholder-grade and is not allowed in production."
      ])
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "REDIS_REQUIRED is false in production; Redis outages can fall back to in-memory state.",
        "REDIS_URL is not set in production; distributed limits/dedupe/cache are disabled.",
        "INGEST_HMAC_REQUIRED is false in production; ingestion endpoint accepts unsigned payloads.",
        "EMAIL_DEV_MODE is true in production; emails are logged and not delivered.",
        "CORS_ORIGIN is '*' in production; set explicit origins to reduce cross-origin exposure.",
        "PUBSUB_PROJECT_ID is not set in production.",
        "PUBSUB_TOPIC_INGEST is not set in production; ingestion uses direct BigQuery fallback."
      ])
    );
  });

  it("passes in production with a hardened configuration", () => {
    const config = buildConfig({
      NODE_ENV: "production"
    });

    const result = validateProductionPreflight(config);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(() => assertProductionPreflight(config)).not.toThrow();
  });

  it("throws an actionable startup error on production preflight failure", () => {
    const config = buildConfig({
      NODE_ENV: "production",
      SCHEDULER_SHARED_SECRET: undefined
    });

    expect(() => assertProductionPreflight(config)).toThrowError(/Production preflight failed with/);
    expect(() => assertProductionPreflight(config)).toThrowError(/SCHEDULER_SHARED_SECRET must be set in production/);
  });

  it("emits warnings for deferred production hardening without failing startup", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const config = buildConfig({
      NODE_ENV: "production",
      REDIS_REQUIRED: false,
      REDIS_URL: undefined,
      INGEST_HMAC_REQUIRED: false,
      INGEST_HMAC_SECRET: undefined,
      PUBSUB_PROJECT_ID: undefined,
      PUBSUB_TOPIC_INGEST: undefined
    });

    expect(() => assertProductionPreflight(config)).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("enforces strict phase-3b checks when flags are enabled", () => {
    const result = validateProductionPreflight(
      buildConfig({
        NODE_ENV: "production",
        STRICT_CORS: true,
        CORS_ORIGIN: "*",
        REQUIRE_WEB_BASE_URL: true,
        WEB_BASE_URL: undefined,
        ENFORCE_PUBSUB_ONLY: true,
        PUBSUB_PROJECT_ID: undefined,
        PUBSUB_TOPIC_INGEST: undefined
      })
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "[STRICT_CORS] CORS_ORIGIN is '*' in production; set explicit origins to reduce cross-origin exposure.",
        "[REQUIRE_WEB_BASE_URL] WEB_BASE_URL must be set in production.",
        "[ENFORCE_PUBSUB_ONLY] PUBSUB_PROJECT_ID must be set in production.",
        "[ENFORCE_PUBSUB_ONLY] PUBSUB_TOPIC_INGEST must be set in production."
      ])
    );
  });
});
