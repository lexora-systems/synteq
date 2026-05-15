# Synteq

## DevOps Risk Intelligence for Automation and Workflow Infrastructure

Synteq is a multi-tenant SaaS platform for monitoring workflow systems, webhook-based automation, CI/CD-style execution signals, and operational events. It helps teams detect failures, latency spikes, retry storms, missing heartbeats, duplicate events, and incident patterns in automation-heavy environments.

Synteq is not a replacement for full-stack observability. It is focused on workflow reliability, operational risk detection, source validation, incident visibility, and trust-safe investigation workflows.

## What Synteq Is

Synteq provides an operator-focused control plane for automation and workflow reliability:

- Ingests execution, heartbeat, workflow, GitHub webhook, and normalized operational event signals.
- Detects workflow failures, timeouts, failure-rate spikes, retry patterns, duplicate-event risk, missing heartbeats, latency risk, and cost-related anomalies.
- Opens, refreshes, acknowledges, and resolves incidents.
- Surfaces incident guidance, sanitized timeline context, operational dashboards, reliability windows, and attention groups.
- Supports source onboarding and validation for GitHub Actions and generic workflow systems such as n8n, Make, Zapier, and custom webhook-based automation.

Current incident guidance is deterministic and template-based. Synteq does not currently ship a production AI RCA copilot or automated remediation system.

## Current Capabilities

Implemented today:

- Multi-tenant SaaS identity, tenant scoping, RBAC, signup, login, refresh-token rotation, invites, team management, and tenant security events.
- Fastify API under `apps/api`.
- Next.js dashboard under `apps/web`.
- Prisma/MySQL state layer for tenants, users, sources, incidents, alerts, findings, idempotency, and worker leases.
- Redis support for shared rate limits, replay protection, dedupe, cache, and auth-abuse controls.
- BigQuery support for execution/heartbeat telemetry, minute rollups, overview metrics, and reliability scan reads.
- Optional Pub/Sub ingestion buffering for execution and heartbeat events.
- GitHub Actions webhook integration using manual webhook setup and `X-Hub-Signature-256` verification.
- Generic workflow source onboarding for `webhook`, `n8n`, `make`, and `zapier`.
- GoHighLevel Phase 1 outbound webhook support through the generic `webhook` source path.
- Generic workflow-event ingestion through `POST /v1/ingest/workflow-event`.
- Source inventory and control-plane setup flows.
- Mutative test-event simulation for generic workflow sources.
- Manual Silent Synthetic Check v1 for generic workflow source readiness validation.
- Incident lifecycle: open, acknowledged, resolved.
- Generic workflow incident create, refresh, reopen, and resolution behavior.
- Missing heartbeat detection.
- Alert policies, alert channels, alert dispatch claim/retry basics, and free/basic email behavior when scheduler and sender infrastructure are configured.
- Operational dashboard: `GET /v1/metrics/operational-dashboard`.
- Incident timeline/RCA foundation: `GET /v1/incidents/:id/timeline`.
- Incident attention groups: `GET /v1/incidents/attention-groups`.
- Reliability windows for `1h`, `24h`, and `7d`: `GET /v1/metrics/reliability-windows`.
- Reliability scan and user-triggered simulation tools.
- Sanitized incident detail views that avoid returning or rendering raw recent event payloads.
- Trust/safety hardening for payload, metadata, secret, token, and webhook exposure risk.

## Supported Source Types

Synteq currently supports these source paths:

- Generic workflow sources:
  - `webhook`
  - `n8n`
  - `make`
  - `zapier`
- GitHub Actions webhooks:
  - `workflow_run`
  - `workflow_job`
- Direct execution ingestion:
  - `POST /v1/ingest/execution`
  - `POST /v1/ingest/heartbeat`
- Normalized operational events:
  - `POST /v1/ingest/events`

Generic n8n, Make, Zapier, and GoHighLevel support is HTTP/event-contract based. Synteq does not yet provide native OAuth/provider-specific setup flows for these providers.

## Guarded Launch Posture

For a guarded early-user launch:

- Set API `ALLOW_PUBLIC_SIGNUP=false` to block self-service workspace creation.
- Set web `NEXT_PUBLIC_ALLOW_PUBLIC_SIGNUP=false` so the signup page shows the guarded early-access message.
- Existing login remains available.
- Invite acceptance remains available through `/invite/:token`.
- Do not add waitlist, CRM, approval, OAuth, or marketplace flows for this launch posture.

Production email delivery must use a verified sender. When `NODE_ENV=production` and `EMAIL_DEV_MODE=false`, configure `BREVO_API_KEY` and `EMAIL_FROM_ADDRESS`. Production preflight fails if `EMAIL_FROM_ADDRESS` is missing or looks local/example/placeholder-grade.

Alert readiness depends on configured scheduler and delivery infrastructure. Only set `SCHEDULER_JOBS_CONFIGURED=true` after aggregate, anomaly, and alert scheduler jobs are deployed and verified. The UI should not imply alert delivery is active when scheduler freshness or email/webhook delivery is not verified.

## Architecture Overview

Repository layout:

- `apps/api`: Fastify API, auth, ingestion routes, source control plane, incidents, metrics, alerts, jobs, workers, and service layer.
- `apps/web`: Next.js dashboard for onboarding, sources, overview, incidents, reliability tools, settings, and control-plane management.
- `packages/shared`: shared Zod schemas and cross-app types.
- `infra/bigquery`: BigQuery DDL, scheduled aggregation SQL, and sliding-window view SQL.
- `docs`: operational runbooks and staging smoke/deploy notes.
- `scripts`: repository-level staging smoke/proof scripts.

Primary data stores and infrastructure:

- MySQL via Prisma for application state.
- BigQuery for execution/heartbeat metrics and rollups.
- Redis for distributed runtime state where configured.
- Pub/Sub for optional ingestion buffering.
- Cloud Scheduler or equivalent for aggregate, anomaly, and alert jobs.

## Core Data Flow

High-level flow:

1. A source sends execution, heartbeat, workflow-event, GitHub webhook, or operational-event telemetry.
2. The API validates auth, tenant/source ownership, HMAC/signature where configured, request size, and schema.
3. Execution/heartbeat telemetry flows to BigQuery directly or through Pub/Sub depending on configuration.
4. Generic workflow events map into normalized operational events and can trigger generic workflow incident logic.
5. GitHub webhook events map into operational events and operational findings.
6. Workers and scheduled jobs derive findings, bridge incidents, aggregate metrics, detect anomalies, and dispatch alerts.
7. The dashboard reads tenant-scoped incidents, attention groups, timelines, dashboard state, source state, and reliability windows.

Phase 1 and Phase 2 read-only surfaces are intentionally derived views. They do not alter incident lifecycle, alert lifecycle, ingestion behavior, or reliability calculations.

## Manual Silent Synthetic Check v1

Phase 2.3 adds Manual Silent Synthetic Check v1:

```http
POST /v1/control-plane/sources/:id/silent-check
```

This endpoint validates readiness for existing generic automation workflow sources. It is designed for n8n, Make, Zapier, and custom webhook-based sources created through the generic workflow-source onboarding path.

The silent check validates:

- Source ownership and tenant scope.
- Source readability/accessibility from the control plane.
- Source activation/readiness state.
- Generic workflow source compatibility.
- Required source identity/configuration fields.
- Safe configuration shape without echoing raw config values.

Response shape:

```json
{
  "sourceId": "wf-source-1",
  "status": "ok",
  "mode": "silent",
  "writesPerformed": false,
  "checkedAt": "2026-05-11T08:15:00.000Z",
  "checks": [
    {
      "key": "source_access",
      "status": "ok",
      "message": "Source belongs to this workspace and is readable."
    }
  ],
  "request_id": "..."
}
```

Silent check guarantees:

- Read-only.
- No-write.
- Ephemeral.
- Isolated from workflow ingestion.
- Isolated from incident lifecycle behavior.
- Isolated from alert dispatch.
- Isolated from BigQuery metrics writes.
- Isolated from Redis/idempotency/queue state.
- No scheduler behavior.
- No synthetic monitor persistence.
- No reliability-window or dashboard pollution.

Important distinction:

- **Run silent check** validates source readiness without operational side effects.
- **Send test event** uses the live workflow-event ingestion path and may create operational events, incidents, alerts, metrics, or reliability-window changes.

## What Is Not Implemented Yet

Synteq does not currently include:

- Full scheduled synthetic monitoring.
- Stored synthetic monitor configuration.
- Synthetic result history.
- SLO/SLA target management. Current SLA behavior is limited to incident lifecycle due/breach fields and events.
- Native OAuth/provider-specific integrations for n8n, Make, or Zapier.
- Automated remediation.
- Production AI RCA copilot.
- Alert suppression/coalescing.
- A full observability replacement for logs, traces, host metrics, APM, or SIEM tooling.

## API Surface

Selected implemented routes:

Ingestion:

- `POST /v1/ingest/execution`
- `POST /v1/ingest/heartbeat`
- `POST /v1/ingest/events`
- `POST /v1/ingest/workflow-event`
- `POST /v1/integrations/github/webhook`

Control plane:

- `GET /v1/control-plane/sources`
- `POST /v1/control-plane/workflow-sources`
- `POST /v1/control-plane/sources/:id/silent-check`
- `POST /v1/control-plane/sources/:id/test-workflow-event`
- `GET /v1/control-plane/api-keys`
- `POST /v1/control-plane/api-keys`
- `POST /v1/control-plane/api-keys/:id/revoke`
- `POST /v1/control-plane/api-keys/:id/rotate`
- `GET /v1/control-plane/github-integrations`
- `POST /v1/control-plane/github-integrations`
- `POST /v1/control-plane/github-integrations/:id/deactivate`
- `POST /v1/control-plane/github-integrations/:id/rotate-secret`
- `GET /v1/control-plane/alert-channels`
- `POST /v1/control-plane/alert-channels`
- `PATCH /v1/control-plane/alert-channels/:id`
- `DELETE /v1/control-plane/alert-channels/:id`
- `GET /v1/control-plane/alert-policies`
- `POST /v1/control-plane/alert-policies`
- `PATCH /v1/control-plane/alert-policies/:id`
- `DELETE /v1/control-plane/alert-policies/:id`

Metrics and reliability:

- `GET /v1/metrics/overview`
- `GET /v1/metrics/operational-dashboard`
- `GET /v1/metrics/reliability-windows`
- `POST /v1/scan/run`
- `GET /v1/scan/:workflowId/latest`
- `POST /v1/simulate/webhook-failure`
- `POST /v1/simulate/retry-storm`
- `POST /v1/simulate/latency-spike`
- `POST /v1/simulate/duplicate-webhook`

Incidents:

- `GET /v1/incidents`
- `GET /v1/incidents/attention-groups`
- `GET /v1/incidents/:id`
- `GET /v1/incidents/:id/timeline`
- `POST /v1/incidents/:id/ack`
- `POST /v1/incidents/:id/resolve`

Internal operations:

- `POST /v1/internal/pubsub/ingest`
- `POST /v1/internal/scheduler/aggregate`
- `POST /v1/internal/scheduler/anomaly`
- `POST /v1/internal/scheduler/alerts`

Health and metrics:

- `GET /health`
- `GET /healthz`
- `GET /ready`
- `GET /metrics`
- `GET /metrics/json`

## Generic Workflow Source Onboarding

Create a generic workflow source:

```http
POST /v1/control-plane/workflow-sources
```

Example body:

```json
{
  "display_name": "Customer Onboarding",
  "source_type": "n8n",
  "environment": "production"
}
```

The response includes:

- Workflow source id.
- Source key.
- `/v1/ingest/workflow-event` endpoint.
- One-time ingestion key for the `X-Synteq-Key` header.

Example generic workflow event:

```json
{
  "source_type": "n8n",
  "source_id": "<source-id>",
  "workflow_id": "customer-onboarding",
  "workflow_name": "Customer Onboarding",
  "status": "succeeded",
  "execution_id": "exec-12345",
  "started_at": "2026-04-28T10:00:00.000Z",
  "finished_at": "2026-04-28T10:01:05.000Z",
  "duration_ms": 65000,
  "environment": "production",
  "metadata": {
    "platform": "n8n",
    "example": true
  }
}
```

For failed or timed-out generic workflow events, Synteq can open or refresh incidents. A later `succeeded` event for the same source/workflow can resolve matching active generic workflow incidents.

### GoHighLevel Phase 1 Outbound Webhooks

GoHighLevel Phase 1 uses outbound webhooks through the existing generic `webhook` source type. Create a generic `webhook` workflow source in Synteq, copy the endpoint and one-time ingestion key, then configure the GoHighLevel workflow action to send JSON to `POST /v1/ingest/workflow-event`.

Required headers:

```http
X-Synteq-Key: <your_ingestion_key>
Content-Type: application/json
```

GHL payloads must include an explicit `provider: "gohighlevel"` marker or `metadata.provider: "gohighlevel"` so Synteq can normalize them safely.

Advanced production hardening can enforce existing ingest HMAC when `INGEST_HMAC_REQUIRED=true`. In that mode, also send `X-Synteq-Timestamp` and `X-Synteq-Signature` using the configured ingest HMAC secret. This phase does not add a new GHL-specific HMAC model.

Safe sample payload:

```json
{
  "provider": "gohighlevel",
  "source_key": "<your_source_key>",
  "workflowId": "ghl_workflow_123",
  "workflowName": "Lead follow-up automation",
  "eventType": "workflow.action.completed",
  "status": "completed",
  "deliveryId": "ghl_delivery_123",
  "timestamp": "2026-01-01T10:00:00.000Z",
  "locationId": "ghl_location_123",
  "actionId": "ghl_action_123",
  "objectType": "opportunity",
  "objectId": "opp_123",
  "pipelineId": "pipeline_123",
  "opportunityId": "opp_123"
}
```

Privacy boundary: Send workflow execution signals, not customer records. Avoid forwarding names, emails, phone numbers, notes, message bodies, custom field values, or full CRM payloads. Synteq is designed to monitor systems - not access them.

Current limitations:

- GHL is not yet a first-class source type.
- No OAuth/API enrichment yet.
- No marketplace app yet.
- The generic `webhook` source path is used.
- Official GHL payload validation should be added once available. Current adapter fixtures are representative and non-official.

Manual GoHighLevel Phase 1 smoke test:

1. Create a generic `webhook` workflow source and copy its `X-Synteq-Key` value.
2. Send a representative GHL success payload with `provider: "gohighlevel"` and operational IDs only.
3. Send a representative failed payload, then resend the same failed payload to confirm duplicate handling.
4. Send a succeeded payload for the same source and workflow to confirm the active incident resolves.
5. Verify operational events, incident open/refresh/resolve behavior, reliability-window counts, and that metadata and incident details contain no contact name, email, phone, notes, raw payload, headers, tokens, API keys, or secrets.

## Simulation and Reliability Tools

Reliability Scan:

- Dashboard: `/overview`
- API: `POST /v1/scan/run`
- API: `GET /v1/scan/:workflowId/latest`

Simulation tools:

- Dashboard: `/overview`
- `POST /v1/simulate/webhook-failure`
- `POST /v1/simulate/retry-storm`
- `POST /v1/simulate/latency-spike`
- `POST /v1/simulate/duplicate-webhook`

Simulations are user-triggered and intentionally mutative. They can affect telemetry, incidents, and metrics because they exercise the real detection pipeline. They are not scheduled synthetic monitors.

## Tech Stack

- Node.js 20+
- TypeScript
- Fastify
- Next.js 15
- React 19
- Prisma
- MySQL
- Redis
- BigQuery
- Pub/Sub
- Zod
- Vitest
- Playwright
- Tailwind CSS
- Docker Compose for local stack support

## Local Development Setup

Install dependencies:

```bash
npm install
```

Bootstrap local database and Prisma:

```bash
npm run local:bootstrap
```

This runs the API workspace `local:bootstrap:db` script, checks database readiness, runs Prisma migrations, and checks migration status.

Start the API:

```bash
npm run dev:api
```

Start the web app:

```bash
npm run dev:web
```

Start the containerized local stack:

```bash
docker compose up --build -d
```

Seed local data:

```bash
npm run seed --workspace api
```

Run the sample sender:

```bash
npm run sample:sender --workspace api
```

## Environment Variables Overview

API configuration is validated in `apps/api/src/config.ts`. Main API variables include:

- `NODE_ENV`
- `PORT`
- `DATABASE_URL`
- `REDIS_URL`
- `REDIS_REQUIRED`
- `REDIS_KEY_PREFIX`
- `BIGQUERY_PROJECT_ID`
- `BIGQUERY_DATASET`
- `BIGQUERY_KEY_JSON`
- `BIGQUERY_AGG_LOOKBACK_MINUTES`
- `PUBSUB_PROJECT_ID`
- `PUBSUB_TOPIC_INGEST`
- `PUBSUB_PUSH_SHARED_SECRET`
- `SCHEDULER_SHARED_SECRET`
- `ENABLE_SECRET_MANAGER`
- `SYNTEQ_API_KEY_SALT`
- `INGEST_HMAC_SECRET`
- `INGEST_HMAC_REQUIRED`
- `STRICT_CORS`
- `REQUIRE_WEB_BASE_URL`
- `ENFORCE_PUBSUB_ONLY`
- `INGEST_SIGNATURE_MAX_SKEW_SEC`
- `INGEST_DEDUPE_TTL_SEC`
- `INGEST_RATE_LIMIT_PER_MIN`
- `MAX_INGEST_BODY_BYTES`
- `SLACK_DEFAULT_WEBHOOK_URL`
- `JWT_SECRET`
- `ACCESS_TOKEN_TTL`
- `REFRESH_TOKEN_TTL`
- `BREVO_API_KEY`
- `EMAIL_DEV_MODE`
- `EMAIL_FROM_ADDRESS`
- `EMAIL_FROM_NAME`
- `DASHBOARD_ADMIN_EMAIL`
- `DASHBOARD_ADMIN_PASSWORD`
- `DEFAULT_TENANT_ID`
- `ALLOW_PUBLIC_SIGNUP`
- `SCHEDULER_JOBS_CONFIGURED`
- `CORS_ORIGIN`
- `WEB_BASE_URL`
- `INVITE_RATE_LIMIT_PER_HOUR`
- `INVITE_PER_EMAIL_PER_DAY`
- `AUTH_LOGIN_MAX_ATTEMPTS_PER_IP`
- `AUTH_LOGIN_MAX_ATTEMPTS_PER_EMAIL`
- `AUTH_LOGIN_WINDOW_SEC`
- `AUTH_LOGIN_LOCKOUT_SEC`
- `LOGOUT_ALL_ENABLED`
- `METRICS_CACHE_TTL_SEC`
- `INCIDENT_ESCALATION_MINUTES`
- `INCIDENT_COOLDOWN_WINDOWS`
- `ALERT_DISPATCH_MAX_RETRIES`
- `ALERT_DISPATCH_BACKOFF_BASE_SEC`
- `FX_RATE_USD`
- `FX_RATE_PHP`
- `FX_RATE_EUR`
- `FX_RATE_GBP`
- `FX_RATE_JPY`
- `FX_RATE_AUD`
- `FX_RATE_CAD`

Web API origin resolution:

1. `SYNTEQ_WEB_API_BASE_URL`
2. `API_BASE_URL`
3. `NEXT_PUBLIC_API_BASE_URL`
4. `http://localhost:8080`

Web guarded-launch posture:

- `NEXT_PUBLIC_ALLOW_PUBLIC_SIGNUP=false` mirrors the API signup gate in the UI.
- The API remains authoritative; `ALLOW_PUBLIC_SIGNUP=false` blocks self-service signup even if the web flag is misconfigured.

Example env files:

- `apps/api/.env.example`
- `apps/api/.env.production.example`
- `apps/web/.env.example`

Secret Manager references are supported for secret values using:

```text
sm://projects/<project>/secrets/<name>/versions/latest
```

## Database and Prisma Commands

Generate Prisma client:

```bash
npm run prisma:generate --workspace api
```

Deploy migrations:

```bash
npm run prisma:migrate --workspace api
```

Validate schema:

```bash
npm run check:prisma:validate
```

Check migration status:

```bash
npm run prisma:migrate:status --workspace api
```

BigQuery setup SQL:

1. `infra/bigquery/01_create_tables.sql`
2. `infra/bigquery/02_aggregate_metrics.sql`
3. `infra/bigquery/03_create_sliding_windows_view.sql`

## Test, Build, and Check Commands

Common checks:

```bash
npm run check:shared
npm run check:api:build
npm run check:prisma:validate
npm run check:web:build
```

API tests:

```bash
npm run check:api:test
npm run test --workspace api
```

Web E2E tests:

```bash
npm run check:web:e2e:install
npm run check:web:e2e
```

Production preflight and smoke:

```bash
npm run check:api:preflight
npm run check:api:smoke
```

Pipeline checks:

```bash
npm run check:pipeline:health
npm run check:pipeline:freshness
npm run check:pipeline:ops
npm run check:local:pipeline
```

Staging checks:

```bash
npm run check:staging:smoke
npm run check:staging:pipeline:proof
```

Full release gate:

```bash
npm run check:release
```

`check:release` expects a reachable database for migration deploy/status checks and a Playwright-capable environment for web E2E.

## Deployment Notes

Detailed operator documentation:

- `docs/operations-runbook.md`
- `docs/staging-deploy-smoke-workflow.md`

Production runtime expectations:

- API service remains available for `/v1` routes.
- MySQL remains available for tenant/auth/source/incident/alert state.
- Redis is configured for production-grade distributed state where required.
- BigQuery dataset and credentials are available for metrics and scan reads.
- Scheduler triggers run:
  - aggregate job
  - anomaly job
  - alert dispatch job
- `SCHEDULER_JOBS_CONFIGURED=true` is set only after those jobs are deployed and verified.
- `EMAIL_DEV_MODE=false` uses a real provider API key and verified `EMAIL_FROM_ADDRESS`.
- Alert delivery is not considered launch-ready until scheduler freshness and email/webhook delivery are verified.
- Operational workers run where enabled:
  - `worker:operational-events`
  - `worker:incident-bridge`

Job commands:

```bash
npm run job:aggregate --workspace api
npm run job:anomaly --workspace api
npm run job:alerts --workspace api
npm run worker:operational-events --workspace api
npm run worker:incident-bridge --workspace api
```

Recommended scheduler order:

```text
aggregate -> anomaly -> alerts
```

## Security and Trust Notes

Synteq is built around tenant isolation and cautious payload handling:

- Dashboard routes use JWT auth and RBAC middleware.
- Ingestion routes use API-key auth and optional/enforced HMAC.
- GitHub webhooks validate `X-Hub-Signature-256`.
- Tenant ownership checks are applied across source, incident, metrics, and control-plane reads.
- Raw recent event payloads are not returned in incident detail responses.
- Incident detail and timeline views use sanitized summaries and safe metadata.
- API keys and GitHub webhook secrets are shown only at create/rotate time.
- Generic workflow silent checks do not echo raw source config, API keys, webhook secrets, tokens, or payloads.
- Secret Manager references are supported for sensitive runtime values.
- Production hardening flags exist for Redis, HMAC, CORS, web base URL, and Pub/Sub-only ingestion.
- Public Privacy Policy, Terms of Service, and Trust pages describe the current monitoring and data-boundary posture.
- Customers should send operational metadata only, not raw CRM/contact/customer payloads.

Local secret handling:

- Store local credentials under `secrets/`.
- Do not commit real `.env` files, service-account JSON, private keys, API keys, or webhook secrets.
- Use `.env.example` files for configuration shape only.
- Rotate provider credentials immediately if exposed in chat, tickets, screenshots, logs, or recordings.

## Roadmap and Next Phases

Likely next areas:

- Hardening source/workflow identity matching across dashboard, reliability, and incident surfaces.
- Shared sanitizer reuse across read models.
- Production smoke coverage for Phase 1 and Phase 2 read-only endpoints.
- Workflow/source-specific reliability window UI expansion.
- Documentation and demo polish.
- Later, if justified by product demand:
  - scheduled synthetic monitoring
  - synthetic monitor configs
  - synthetic result history
  - SLO/SLA target management
  - native provider integrations
  - AI-assisted RCA behind explicit product and safety boundaries

The current safest synthetic capability is Manual Silent Synthetic Check v1, which validates readiness without operational side effects.
