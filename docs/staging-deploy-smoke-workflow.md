# Staging Deploy Smoke Workflow

Workflow file: `.github/workflows/staging-deploy-smoke.yml`

This workflow is staging-focused and does three things in order:

1. Deploy API and Web to staging (Cloud Run).
2. Run tight post-deploy smoke checks plus pipeline proof triggers.
3. Run pipeline readiness and freshness gates (strict).

If smoke or pipeline checks fail, the workflow fails.

This runbook is for the current Cloud Run API + Cloud Run web staging flow.

## Required GitHub Secrets

Deployment (Cloud Run + Artifact Registry):

- `STAGING_GCP_SA_KEY`
- `STAGING_GCP_PROJECT_ID`
- `STAGING_GCP_REGION`
- `STAGING_GAR_REPOSITORY`
- `STAGING_API_SERVICE`
- `STAGING_WEB_SERVICE`
- `STAGING_API_BASE_URL`

Smoke checks:

- `STAGING_WEB_BASE_URL`
- `STAGING_API_BASE_URL`
- `STAGING_SMOKE_EMAIL`
- `STAGING_SMOKE_PASSWORD`
- `STAGING_SMOKE_TENANT_ID` (optional)
- `STAGING_SMOKE_WORKFLOW_ID` (optional, defaults to first active workflow)
- `STAGING_SCHEDULER_SHARED_SECRET` (required for internal scheduler proof triggers)

Post-deploy pipeline gates:

- `STAGING_DATABASE_URL`
- `STAGING_BIGQUERY_PROJECT_ID` (or fallback to `STAGING_GCP_PROJECT_ID`)
- `STAGING_BIGQUERY_DATASET` (optional, defaults to `synteq`)
- `STAGING_BIGQUERY_KEY_JSON` (optional when runner auth already has BigQuery access)
- `STAGING_REDIS_REQUIRED` (optional, defaults to `false`)
- `STAGING_REDIS_URL` (required when `STAGING_REDIS_REQUIRED=true`)

Optional overrides for config validation defaults:

- `STAGING_SYNTEQ_API_KEY_SALT`
- `STAGING_JWT_SECRET`
- `STAGING_INGEST_HMAC_SECRET`
- `STAGING_DASHBOARD_ADMIN_EMAIL`
- `STAGING_DASHBOARD_ADMIN_PASSWORD`
- `STAGING_CORS_ORIGIN`

## Optional GitHub Variables

- `STAGING_REDIS_KEY_PREFIX` (defaults to `synteq-staging`)

## Assumed Staging Infra

- Cloud Run services exist (or are creatable by deploy credentials).
- Artifact Registry repository exists and is writable.
- Staging API and web URLs are publicly reachable from GitHub runners.
- Staging DB/Redis/BigQuery are reachable from GitHub runners for gate checks.
- Scheduler/jobs are writing freshness timestamps to `worker_leases.last_completed_at`.
- Pipeline freshness gate is strict (stale stages fail the workflow).
