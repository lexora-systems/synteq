# Synteq Production Upgrade

Synteq is now upgraded from MVP to a production-ready, multi-tenant observability system for workflow execution reliability, anomalies, incidents, and cost monitoring.

## What Changed

### Ingestion Hardening

- API ingestion is now buffered through **Pub/Sub** (`PUBSUB_TOPIC_INGEST`) before BigQuery writes.
- Added idempotency fingerprint per execution:
  - `fingerprint = sha256(tenant_id + workflow_id + minute_bucket + execution_id)`
- Added dedupe guard in subscriber worker (TTL cache) plus BigQuery `insertId` usage.
- Added per-API-key rate limiting (`INGEST_RATE_LIMIT_PER_MIN`).
- Added HMAC signature verification and replay prevention:
  - `X-Synteq-Timestamp`
  - `X-Synteq-Signature: sha256=<hex>`
  - signature payload: `<timestamp>.<rawBody>`
- Added strict payload size protections (`MAX_INGEST_BODY_BYTES`) and sanitation.
- Structured request logging with `request_id`, route, status, and latency.

### Metrics & Aggregation

- Aggregation query upgraded for dedupe and cost metrics:
  - duplicate detection via `ROW_NUMBER() > 1`
  - cost rollups (`sum_cost_usd`, `avg_cost_usd`)
  - token rollups (`sum_token_in`, `sum_token_out`)
- Added sliding windows support (`5m` and `15m`) in metrics API response.
- Added metrics cache (in-memory TTL, default 45s) for dashboard traffic reduction.

### Advanced Anomaly Detection

- Baseline smoothing:
  - rolling 24h baseline
  - same-hour-of-day seasonal baseline (7-day window)
  - weighted baseline blend
- Added EWMA detectors for:
  - `cost_spike`
  - `latency_drift_ewma`
- Added anomaly cooldown to avoid immediate reopen after resolution.
- Added severity escalation to critical when anomaly persists (`INCIDENT_ESCALATION_MINUTES`).
- Added SLA timers on incidents (`sla_due_at`, `sla_breached_at`).

### Incident Management

- Dedup fingerprint now follows:
  - `sha256(tenant + workflow + metric + timeBucket)`
- Added incident pagination (`page`, `page_size`).
- Added SLA breach event generation (`SLA_BREACHED`).

### Security

- Added Secret Manager secret reference support (`sm://projects/.../secrets/.../versions/latest`).
- API server and jobs resolve secrets before initialization.

### Operability

- Added:
  - `/health`
  - `/healthz`
  - `/ready`
  - `/metrics` (Prometheus text)
  - `/metrics/json`
- Added dashboard global error boundary (`app/error.tsx`).

## Repository Map

- `apps/api` Fastify API, queue worker endpoint, anomaly and alert jobs.
- `apps/web` Next.js dashboard with incidents pagination and error boundaries.
- `packages/shared` shared Zod schemas and cross-app types.
- `infra/bigquery` DDL and scheduled aggregation/view SQL.

## Updated API Endpoints

### Ingestion (API key + HMAC)

- `POST /v1/ingest/execution`
- `POST /v1/ingest/heartbeat`

### Internal queue worker (Pub/Sub push)

- `POST /v1/internal/pubsub/ingest`

### Dashboard API (JWT)

- `POST /v1/auth/login`
- `POST /v1/auth/logout`
- `POST /v1/auth/logout-all`
- `POST /v1/auth/refresh`
- `GET /v1/auth/me`
- `POST /v1/auth/change-password`
- `POST /v1/auth/email/verification/request`
- `POST /v1/auth/email/verification/confirm`
- `POST /v1/auth/password-reset/request`
- `POST /v1/auth/password-reset/confirm`
- `POST /v1/workflows/register`
- `GET /v1/metrics/overview?workflow_id=&env=&range=`
- `GET /v1/incidents?status=&workflow_id=&page=&page_size=`
- `POST /v1/incidents/:id/ack`
- `POST /v1/incidents/:id/resolve`
- `GET /v1/team/users`
- `POST /v1/team/invite`
- `POST /v1/team/invite/resend`
- `GET /v1/team/invites`
- `POST /v1/team/invite/:token/accept`
- `POST /v1/team/users/:id/role`
- `POST /v1/team/users/:id/disable`

## Environment Variables (API)

Core:

- `DATABASE_URL`
- `BIGQUERY_PROJECT_ID`
- `BIGQUERY_DATASET` (default: `synteq`)
- `BIGQUERY_KEY_JSON`
- `SYNTEQ_API_KEY_SALT`
- `JWT_SECRET`
- `ACCESS_TOKEN_TTL` (default: `15m`)
- `REFRESH_TOKEN_TTL` (default: `30d`)
- `BREVO_API_KEY`
- `EMAIL_DEV_MODE` (`true|false`)
- `DASHBOARD_ADMIN_EMAIL`
- `DASHBOARD_ADMIN_PASSWORD`

Ingestion security:

- `INGEST_HMAC_SECRET`
- `INGEST_HMAC_REQUIRED` (`true|false`)
- `INGEST_SIGNATURE_MAX_SKEW_SEC`
- `MAX_INGEST_BODY_BYTES`
- `INGEST_RATE_LIMIT_PER_MIN`

Queueing:

- `PUBSUB_PROJECT_ID`
- `PUBSUB_TOPIC_INGEST`
- `PUBSUB_PUSH_SHARED_SECRET`

Ops/perf:

- `WEB_BASE_URL`
- `INVITE_RATE_LIMIT_PER_HOUR`
- `INVITE_PER_EMAIL_PER_DAY`
- `LOGOUT_ALL_ENABLED`
- `METRICS_CACHE_TTL_SEC`
- `INGEST_DEDUPE_TTL_SEC`
- `INCIDENT_ESCALATION_MINUTES`
- `INCIDENT_COOLDOWN_WINDOWS`

Secret Manager:

- Any secret value can be provided as `sm://projects/<project>/secrets/<name>/versions/latest`.

## Local Run

1. Install dependencies:

```bash
npm install
```

2. Start local stack:

```bash
docker compose up --build -d
```

3. Generate Prisma client and apply migrations:

```bash
npm run prisma:generate --workspace api
npm run prisma:migrate --workspace api
```

4. Seed base tenant/user/API key:

```bash
npm run seed --workspace api
```

5. Run sample sender (supports HMAC if `INGEST_HMAC_SECRET` is set):

```bash
npm run sample:sender --workspace api
```

## BigQuery Setup

Run these SQL files in order:

1. `infra/bigquery/01_create_tables.sql`
2. `infra/bigquery/02_aggregate_metrics.sql` (scheduled query every minute)
3. `infra/bigquery/03_create_sliding_windows_view.sql`

## Cloud Run + Jobs + Scheduler

### API/Web deploy

Use existing deploy flow; ensure new env vars are present for Pub/Sub + HMAC + cache + cooldown.

### Jobs

- `npm run job:aggregate --workspace api`
- `npm run job:anomaly --workspace api`
- `npm run job:alerts --workspace api`

Schedule all three with Cloud Scheduler (1m or 2m cadence).

## Scaling Notes

- **Ingestion API is decoupled** from BigQuery write latency via Pub/Sub.
- Run multiple API replicas safely; dedupe is protected by fingerprint + downstream dedupe aggregation.
- Keep aggregation and anomaly jobs independent from API scaling.
- For higher throughput, split topics by tenant tier or region.
- Move in-memory dedupe/cache to Redis for cross-instance consistency in large clusters.

## Failure Scenarios & Safeguards

- Pub/Sub unavailable:
  - API falls back to direct BigQuery write and increments fallback metric.
- BigQuery transient errors:
  - Pub/Sub push retries until worker returns 2xx.
- Replay attacks:
  - rejected by timestamp skew + signature replay cache.
- Duplicate ingestion attempts:
  - suppressed by fingerprint cache + BigQuery insertId + dedupe aggregation query.
- Incident storms:
  - cooldown windows and incident dedupe prevent rapid reopen spam.

## Cost Estimation Guidance

Track these fields per execution event:

- `token_in`
- `token_out`
- `cost_estimate_usd`

Use `workflow_metrics_minute` rollups:

- `sum_cost_usd` for total spend
- `avg_cost_usd` for normalized cost per run

Suggested operational budget alarms:

- 5m spend > threshold per tenant
- 15m spend slope increase via EWMA
- daily spend forecast from rolling 24h average

## Monitoring Synteq Itself

Use:

- `/ready` for readiness probes
- `/health` for liveness probes
- `/metrics` for scrape-based monitoring

Key runtime counters:

- `synteq_ingest_queue_publish_total`
- `synteq_ingest_worker_duplicate_total`
- `synteq_metrics_cache_hit_total`
- `synteq_pubsub_push_failed_total`
- `synteq_http_requests_total`

Recommended alerts:

- sustained `pubsub_push_failed_total` increases
- ingestion fallback writes increasing unexpectedly
- SLA breaches (`SLA_BREACHED` incident events)
- anomaly job runtime exceeds scheduler interval

## Tests

Run:

```bash
npm run test --workspace api
```

Covers:

- anomaly math (`z-score`, `poisson`, `EWMA`, smoothed baseline)
- ingestion schema validation
- auth + invite + RBAC baseline tests

## SaaS Identity and Tenant System

Synteq now includes an incremental SaaS identity layer that preserves existing ingestion, anomaly, metrics, and dashboard flows.

### Invite-only model

- Public signup is disabled.
- Tenant `owner`/`admin` users can invite users.
- Invite acceptance endpoint: `POST /v1/team/invite/:token/accept`.
- Only hashed invite tokens are stored in Cloud SQL.

### Roles and RBAC

Supported roles:

- `owner`
- `admin`
- `engineer`
- `viewer`

Role checks are enforced by route middleware and all business queries remain tenant scoped.

### Authentication

- Password hashing uses bcrypt.
- Access token TTL defaults to `15m`.
- Refresh token TTL defaults to `30d`.
- Refresh tokens are rotated on use and stored hashed only.
- Logout revokes refresh tokens.
- Reuse detection is enabled for refresh tokens. If a revoked/expired token is replayed,
  all active refresh tokens for that user are revoked and the API returns `AUTH_REFRESH_REUSE_DETECTED`.

### Tenant safety guardrails

- Synteq prevents tenants from ending up without an owner.
- The last active owner cannot be demoted or disabled (`LAST_OWNER_PROTECTION`).

### Invite abuse prevention

- Invite creation and resend enforce tenant-aware throttling:
  - `INVITE_RATE_LIMIT_PER_HOUR` (default `20`)
  - `INVITE_PER_EMAIL_PER_DAY` (default `3`)
- Rate-limit violations return `INVITE_RATE_LIMITED` and are logged as security events.

### Email service (Brevo + dev stub mode)

Service file: `apps/api/src/services/email-service.ts`

Implemented methods:

- `sendVerificationEmail()`
- `sendPasswordResetEmail()`
- `sendInviteEmail()`
- `sendIncidentAlert()`

When `EMAIL_DEV_MODE=true`, emails are not sent and links are printed to logs for local development.

### Dashboard pages

- `/profile` for account details and password update.
- `/settings/team` for invite + role/disable management (owner/admin).
