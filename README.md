# Synteq Production Upgrade

Synteq is now upgraded from MVP to a production-ready, multi-tenant observability system for workflow execution reliability, anomalies, incidents, and cost monitoring.

## What Changed

### Ingestion Hardening

- Execution/heartbeat ingestion is buffered through **Pub/Sub** (`PUBSUB_TOPIC_INGEST`) before BigQuery writes, with direct BigQuery fallback when Pub/Sub is not configured.
- Added idempotency fingerprint per execution:
  - `fingerprint = sha256(tenant_id + workflow_id + minute_bucket + execution_id)`
- Added distributed dedupe guard in subscriber worker (Redis TTL keys) plus BigQuery `insertId` usage.
- Added distributed per-API-key/IP rate limiting (`INGEST_RATE_LIMIT_PER_MIN`) via Redis counters.
- Added HMAC signature verification and replay prevention:
  - `X-Synteq-Timestamp`
  - `X-Synteq-Signature: sha256=<hex>`
  - signature payload: `<timestamp>.<rawBody>`
- Added distributed replay protection via Redis `SET NX EX` keys.
- Added strict payload size protections (`MAX_INGEST_BODY_BYTES`) and sanitation.
- Structured request logging with `request_id`, route, status, and latency.

### Metrics & Aggregation

- Aggregation query upgraded for dedupe and cost metrics:
  - duplicate detection via `ROW_NUMBER() > 1`
  - cost rollups (`sum_cost_usd`, `avg_cost_usd`)
  - token rollups (`sum_token_in`, `sum_token_out`)
- Added sliding windows support (`5m` and `15m`) in metrics API response.
- Added metrics cache (Redis TTL, default 45s) for dashboard traffic reduction across replicas.

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
- Added alert dispatch claim semantics (`ALERT_PENDING` -> `ALERT_CLAIMED`) to prevent duplicate sends under parallel workers.
- Added retry/backoff metadata for failed alert dispatch attempts.

### Incident Diagnosis & Recommended Actions

- Synteq now adds a deterministic, rule-based guidance layer after incidents are detected.
- Guidance is generated per incident with:
  - incident type classification
  - likely causes
  - business impact
  - recommended actions
  - confidence level
  - evidence
  - summary text
- Current supported incident guidance types:
  - `duplicate_webhook`
  - `retry_storm`
  - `latency_spike`
  - `failure_rate_spike`
  - `missing_heartbeat`
  - `cost_spike`
  - `unknown`
- Detection remains deterministic and unchanged; guidance consumes incident context on read and does not replace anomaly logic.
- Narration is architecture-ready for AI: current implementation uses template narration, and an AI narrator can be added later behind the same interface without changing detection/guidance core logic.

### Reliability Scan & Simulation Tools

- Synteq now includes a deterministic Reliability Scan that scores workflow reliability from existing telemetry.
- New scan output includes:
  - reliability score (0-100)
  - success rate, duplicate rate, retry rate
  - latency health score
  - anomaly/risk flags
  - estimated monthly risk (USD)
  - deterministic top risks and next steps
- New simulation tools inject synthetic execution events into the existing ingestion pipeline for:
  - webhook failure
  - retry storm
  - latency spike
  - duplicate webhook
- Simulation-generated incidents continue through the normal path:
  - ingest -> metrics -> anomaly -> incident -> guidance
- Incident metadata now includes simulation source signals when synthetic traffic dominates the triggering window.

### Security

- Added Secret Manager secret reference support (`sm://projects/.../secrets/.../versions/latest`).
- API server and jobs resolve secrets before initialization.
- Added Redis-backed login abuse protection with per-IP and per-email lockouts (`AUTH_TEMPORARILY_LOCKED`).
- Added tenant-scoped security events API and dashboard page.

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
- `POST /v1/ingest/events` (normalized operational events, single or batch)
- `POST /v1/integrations/github/webhook` (GitHub Actions webhook adapter)

Example single event payload:

```json
{
  "event": {
    "source": "github_actions",
    "event_type": "workflow_failed",
    "service": "payments-api",
    "environment": "production",
    "timestamp": "2026-03-17T10:00:00Z",
    "severity": "high",
    "correlation_key": "deploy-123",
    "metadata": {
      "repository": "acme/payments",
      "workflow": "deploy-prod"
    }
  }
}
```

Example batch payload:

```json
{
  "events": [
    {
      "source": "ci",
      "event_type": "deployment_started",
      "system": "payments-api",
      "timestamp": "2026-03-17T10:00:00Z",
      "metadata": {
        "pipeline": "deploy-prod"
      }
    }
  ]
}
```

GitHub Actions webhook adapter notes (Step 2 foundation):

- Route: `POST /v1/integrations/github/webhook`
- Security: validates `X-Hub-Signature-256` against tenant integration `webhook_secret`
- Tenant resolution: via `github_integrations.webhook_id` (`X-GitHub-Hook-ID`), not payload tenant fields
- Supported event types:
  - `workflow_run` (`requested`, `in_progress`, `completed`)
  - `workflow_job` (`queued`, `in_progress`, `completed`)
- Unsupported event types are accepted as safe no-op (`202`, `processed=false`)

Durable event idempotency ledger notes (Step 5 foundation):

- Ingestion now records tenant-scoped idempotency entries in `event_idempotency_ledger`.
- Uniqueness key: `(tenant_id, source, idempotency_key)`.
- State machine:
  - `processing` while reservation is active
  - `completed` after `operational_events` persistence succeeds
  - `failed` when persistence fails (retryable)
- Duplicate behavior:
  - completed duplicate -> no new `operational_events` row
  - in-flight duplicate -> skipped no-op
  - batch requests return mixed counters: `ingested`, `duplicates`, `skipped`, `failed`
- GitHub webhooks use durable delivery-aware hints for idempotency keys, so duplicate deliveries remain deduped even after Redis restart/eviction.

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
- `GET /v1/workflows`
- `GET /v1/metrics/overview?workflow_id=&env=&range=`
- `GET /v1/incidents?status=&workflow_id=&page=&page_size=`
- `POST /v1/incidents/:id/ack`
- `POST /v1/incidents/:id/resolve`
- `GET /v1/incidents/:id`
- `POST /v1/scan/run`
- `GET /v1/scan/:workflowId/latest`
- `POST /v1/simulate/webhook-failure`
- `POST /v1/simulate/retry-storm`
- `POST /v1/simulate/latency-spike`
- `POST /v1/simulate/duplicate-webhook`
- `GET /v1/settings/tenant`
- `PATCH /v1/settings/tenant`
- `GET /v1/team/users`
- `POST /v1/team/invite`
- `POST /v1/team/invite/resend`
- `GET /v1/team/invites`
- `POST /v1/team/invite/:token/accept`
- `POST /v1/team/users/:id/role`
- `POST /v1/team/users/:id/disable`
- `GET /v1/security-events?type=&from=&to=&page=&limit=`

## Environment Variables (API)

Core:

- `DATABASE_URL`
- `REDIS_URL`
- `REDIS_REQUIRED` (`true|false`)
- `REDIS_KEY_PREFIX`
- `BIGQUERY_PROJECT_ID`
- `BIGQUERY_DATASET` (default: `synteq`)
- `BIGQUERY_KEY_JSON`
- `BIGQUERY_AGG_LOOKBACK_MINUTES`
- `SYNTEQ_API_KEY_SALT`
- `JWT_SECRET`
- `ACCESS_TOKEN_TTL` (default: `15m`)
- `REFRESH_TOKEN_TTL` (default: `30d`)
- `BREVO_API_KEY`
- `EMAIL_DEV_MODE` (`true|false`)
- `ENABLE_SECRET_MANAGER` (`true|false`)
- `DASHBOARD_ADMIN_EMAIL`
- `DASHBOARD_ADMIN_PASSWORD`
- `SLACK_DEFAULT_WEBHOOK_URL`
- `DEFAULT_TENANT_ID`
- `CORS_ORIGIN`

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
- `AUTH_LOGIN_MAX_ATTEMPTS_PER_IP`
- `AUTH_LOGIN_MAX_ATTEMPTS_PER_EMAIL`
- `AUTH_LOGIN_WINDOW_SEC`
- `AUTH_LOGIN_LOCKOUT_SEC`
- `LOGOUT_ALL_ENABLED`
- `METRICS_CACHE_TTL_SEC`
- `INGEST_DEDUPE_TTL_SEC`
- `WORKER_LEASE_DURATION_MS`
- `WORKER_LEASE_RENEW_INTERVAL_MS`
- `INCIDENT_ESCALATION_MINUTES`
- `INCIDENT_COOLDOWN_WINDOWS`
- `ALERT_DISPATCH_MAX_RETRIES`
- `ALERT_DISPATCH_BACKOFF_BASE_SEC`
- `SYNTEQ_PIPELINE_MAX_DELAY_AGGREGATE_MIN` (optional, freshness threshold override)
- `SYNTEQ_PIPELINE_MAX_DELAY_ANOMALY_MIN` (optional, freshness threshold override)
- `SYNTEQ_PIPELINE_MAX_DELAY_ALERTS_MIN` (optional, freshness threshold override)
- `FX_RATE_USD`
- `FX_RATE_PHP`
- `FX_RATE_EUR`
- `FX_RATE_GBP`
- `FX_RATE_JPY`
- `FX_RATE_AUD`
- `FX_RATE_CAD`

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

This starts MySQL + Redis + API + Web.

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

### Secrets Handling Policy (Required)

- Store local credentials under `secrets/` (for example: `secrets/synteq-bq-key.json`).
- Keep real secrets only in local `.env` files or a secret manager reference (`sm://...`).
- Never commit real key material (service-account JSON, private keys, webhook secrets, raw secret exports).
- Commit only safe templates/examples such as `.env.example`.
- Treat credentials pasted into chat, tickets, screenshots, or recordings as potentially exposed and rotate immediately.

Developer checklist:

- Use `secrets/` for local key files and keep that folder local-only.
- Share configuration shape via `.env.example`, never via real `.env` values.
- Validate local setup with readiness/freshness checks instead of sharing real credentials.
- If exposure is suspected:
  - revoke/rotate provider credentials first (GCP, Slack, Brevo, etc.)
  - update local `.env` / secret references
  - rerun `npm run check:pipeline:health` to confirm recovery

Example local API env values:

```env
BIGQUERY_PROJECT_ID=your-gcp-project
BIGQUERY_DATASET=synteq
BIGQUERY_KEY_JSON=C:/path/to/your/local/secrets/synteq-bq-key.json
```

If a credential is exposed, rotate it immediately in the provider console and replace local references.

## BigQuery Setup

Run these SQL files in order:

1. `infra/bigquery/01_create_tables.sql`
2. `infra/bigquery/02_aggregate_metrics.sql` (scheduled query every minute)
3. `infra/bigquery/03_create_sliding_windows_view.sql`

## Cloud Run + Jobs + Scheduler
Detailed operator runbook: `docs/operations-runbook.md`.

### API/Web deploy

Use existing deploy flow; ensure new env vars are present for Pub/Sub + HMAC + Redis + cache + cooldown.

### Jobs

- `npm run job:aggregate --workspace api`
- `npm run job:anomaly --workspace api`
- `npm run job:alerts --workspace api`
- `npm run worker:operational-events --workspace api`
- `npm run worker:incident-bridge --workspace api`

Schedule these jobs/workers with Cloud Scheduler (or equivalent) and keep workers always-on.
Operational events worker is the Step 3 bridge: it consumes normalized `operational_events`, derives deterministic GitHub rule findings, and writes durable `operational_findings` records for future incident correlation.
Incident bridge worker is the Step 4 bridge: it consumes eligible open/resolved `operational_findings`, deduplicates with durable finding->incident links, and opens/refreshes/resolves incidents safely for lifecycle tracking.
Worker lease locking is enabled for `worker:operational-events` and `worker:incident-bridge`:
- each worker acquires a named DB lease in `worker_leases` before processing
- overlap behavior is safe no-op (`skipped`) when an active lease is held by another instance
- leases are renewed on heartbeat while running and released on completion
- crashes rely on `lease_expires_at` expiry for recovery/reclaim

### Always-On Runtime Expectations (Production)

For stable risk detection in production, keep these runtime paths continuously available:

- API service (`/v1` routes)
- MySQL (tenant/auth/workflow/incidents state)
- Redis (shared limits, dedupe, auth abuse state, cache)
- BigQuery dataset access for metrics + scan reads
- Scheduled execution of:
  - aggregate metrics job
  - anomaly detection job
  - alert dispatch job

Recommended scheduler contract:

- `aggregate`: every 1 minute
- `anomaly`: every 1-2 minutes (after aggregate cadence)
- `alerts`: every 1-2 minutes (after anomaly cadence)
- `worker:operational-events`: continuously running service/worker
- `worker:incident-bridge`: continuously running service/worker

Execution dependency order:

- aggregate -> anomaly -> alerts

Minimum healthy pipeline behavior:

- New telemetry arrives through ingestion endpoints.
- Aggregate job completes on schedule.
- Anomaly job evaluates current windows.
- Alert job processes pending dispatch safely.

Missed-run symptoms:

- Dashboard trends stop updating while ingestion is still active.
- Incidents stop opening/resolving despite new telemetry.
- Alert notifications are delayed while incidents remain open.

Operator first checks:

- Run readiness check (`check:pipeline:readiness`) for dependency reachability.
- Run freshness check (`check:pipeline:freshness`) for scheduler/cadence drift.
- Inspect scheduler history for skipped triggers and confirm job logs for latest run timestamps.

### Pipeline Readiness vs Freshness (Operator Checks)

Readiness check (dependency sanity):

```bash
npm run check:pipeline:health
```

`check:pipeline:health` is an alias of:

```bash
npm run check:pipeline:readiness
```

This validates dependency reachability:

- MySQL connectivity
- Redis reachability (when configured)
- BigQuery auth/query access
- Presence of required BigQuery tables used by monitoring

Freshness check (missed-run detection):

```bash
npm run check:pipeline:freshness
```

This validates job cadence/freshness for:

- aggregate (`job:aggregate`)
- anomaly (`job:anomaly`)
- alerts (`job:alerts`)

The freshness check uses recorded successful job run metadata in `worker_leases.last_completed_at` and returns non-zero when any stage is stale.

Machine-readable output:

```bash
npm run check:pipeline:freshness -- --json
```

Combined operator check:

```bash
npm run check:pipeline:ops
```

To manually force pipeline progression in local/dev:

```bash
npm run check:local:pipeline
```

## Scaling Notes

- **Execution/heartbeat ingestion is decoupled** from BigQuery write latency via Pub/Sub (with direct fallback if Pub/Sub is disabled).
- Run multiple API replicas safely; dedupe/replay/rate limits/cache now use Redis shared state.
- Keep aggregation and anomaly jobs independent from API scaling.
- For higher throughput, split topics by tenant tier or region.
- Keep Redis highly available (managed Redis or sentinel/cluster) because auth, replay guard, and dedupe use shared keys.

## Failure Scenarios & Safeguards

- Pub/Sub unavailable:
  - API falls back to direct BigQuery write and increments fallback metric.
- BigQuery transient errors:
  - Pub/Sub push retries until worker returns 2xx.
- Replay attacks:
  - rejected by timestamp skew + Redis replay keys.
- Duplicate ingestion attempts:
  - suppressed by Redis fingerprint dedupe + BigQuery insertId + dedupe aggregation query.
- Incident storms:
  - cooldown windows and incident dedupe prevent rapid reopen spam.
- Parallel alert workers:
  - deduplicated by atomic claim transition on `ALERT_PENDING` events.

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

## Reliability Scan

Dashboard: `/overview` -> "Run a Synteq Reliability Scan"

API:

- `POST /v1/scan/run`
  - body: `{ "workflow_id": "...", "range": "24h|7d|30d" }`
- `GET /v1/scan/:workflowId/latest?range=24h|7d|30d`

Response includes:

- `reliability_score` (0-100)
- `success_rate`
- `duplicate_rate`
- `retry_rate`
- `latency_health_score`
- `anomaly_flags`
- `estimated_monthly_risk_usd`
- `recommendation`
- `top_risks`
- `next_steps`

## Simulation Tools

Dashboard: `/overview` -> "Test Synteq Detection"

API:

- `POST /v1/simulate/webhook-failure`
- `POST /v1/simulate/retry-storm`
- `POST /v1/simulate/latency-spike`
- `POST /v1/simulate/duplicate-webhook`

All simulation endpoints accept:

- `{ "workflow_id": "..." }`

They inject synthetic execution events through existing ingestion semantics and mark payload metadata with simulation context.

## Deterministic Scoring Model

Reliability score is deterministic and non-AI in v1:

- `success_rate = success / total`
- `duplicate_rate = duplicate_events / total`
- `retry_rate = retry_events / total`
- `latency_health_score` derived from p95 vs baseline (or deterministic fallback thresholds)
- `reliability_score = (success_rate * 50) + ((1 - duplicate_rate) * 20) + ((1 - retry_rate) * 15) + ((latency_health_score / 100) * 15)`

Monthly risk estimate is deterministic and uses workload volume with fallback assumptions when tenant business context is not configured.

## Synthetic Event Handling & Caveats

- Synthetic events are explicitly tagged in payload metadata (`simulation=true`, scenario, batch).
- Simulations can influence aggregate metrics by design in v1.
- Incident detection is asynchronous; after simulation, run:
  - `npm run check:local:pipeline`
- For duplicate-webhook simulation, Synteq applies a simulation-only fingerprint override so duplicate execution IDs remain observable while preserving normal ingestion behavior for non-synthetic traffic.

## Multi-Currency Revenue Risk Display

- Synteq keeps internal reliability risk normalization in USD (`estimated_monthly_risk_usd`).
- Tenant settings can choose default display currency:
  - `USD`, `PHP`, `EUR`, `GBP`, `JPY`, `AUD`, `CAD`
- Scan API responses include both base and converted values:
  - `estimated_monthly_risk_usd`
  - `estimated_monthly_risk`
  - `currency`
  - `conversion_rate`
- V1 uses deterministic static FX rates from environment variables (`FX_RATE_*`), not live external FX calls.
- Future enhancement can replace static rates with scheduled live-rate updates while preserving the same response contract.

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

Release gates (same checks used in CI):

```bash
npm run check:release
```

`check:release` expects `DATABASE_URL` to point to a reachable MySQL instance for migration checks.

Covers:

- anomaly math (`z-score`, `poisson`, `EWMA`, smoothed baseline)
- ingestion schema validation
- auth + invite + RBAC baseline tests
- auth abuse lockout tests
- alert idempotency claim tests
- security events API access/isolation tests
- refresh-session API flow tests

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
- Web session continuity is preserved: stale access tokens trigger refresh exchange before redirecting users to login.

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
- `/settings/security` for tenant security event visibility (owner/admin).
- `/incidents/[id]` for incident diagnosis and recommended action guidance.
