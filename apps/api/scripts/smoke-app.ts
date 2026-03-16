import assert from "node:assert/strict";

const defaults: Record<string, string> = {
  NODE_ENV: "test",
  PORT: "8080",
  DATABASE_URL: "mysql://root:root@127.0.0.1:3306/synteq_ci",
  REDIS_REQUIRED: "false",
  REDIS_KEY_PREFIX: "synteq",
  BIGQUERY_PROJECT_ID: "synteq-ci",
  BIGQUERY_DATASET: "synteq",
  SYNTEQ_API_KEY_SALT: "ci-api-key-salt-that-is-long-enough-123456",
  INGEST_HMAC_REQUIRED: "false",
  INGEST_HMAC_SECRET: "ci-ingest-hmac-secret-that-is-long-enough-123456",
  JWT_SECRET: "ci-jwt-secret-that-is-long-enough-123456",
  EMAIL_DEV_MODE: "true",
  DASHBOARD_ADMIN_EMAIL: "admin@synteq.local",
  DASHBOARD_ADMIN_PASSWORD: "SmokeCheckPassword123!",
  CORS_ORIGIN: "http://localhost:3000"
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}

const { buildApp } = await import("../src/app.js");

const app = await buildApp();

try {
  const health = await app.inject({
    method: "GET",
    url: "/health"
  });
  assert.equal(health.statusCode, 200, "/health must return 200");
  assert.equal(health.json().ok, true, "/health response must include ok=true");

  const protectedRoute = await app.inject({
    method: "GET",
    url: "/v1/auth/me"
  });
  assert.equal(protectedRoute.statusCode, 401, "/v1/auth/me must reject anonymous requests");

  console.log("API smoke checks passed: /health and /v1/auth/me");
} finally {
  await app.close();
}
