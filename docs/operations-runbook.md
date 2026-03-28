# Synteq Operations Runbook (Pre-Step-7)

This runbook defines the minimum operational contract for safe production execution before Step 7 rollout.

## 1) Secrets Handling Policy

- Keep local key files only under `secrets/` (local machine only).
- Keep real values in local `.env` files or secret manager references (`sm://...`).
- Commit only safe examples (`.env.example`), never real credentials.
- Treat credentials shown in screenshots/chat/history as exposed.

If exposure is suspected:

1. Revoke/rotate the credential in its provider first (GCP, Slack, Brevo, etc.).
2. Update local secret references (`.env`, secret manager references).
3. Run `npm run check:pipeline:readiness` to confirm dependencies are reachable.
4. Run `npm run check:pipeline:freshness` to confirm required jobs are running on cadence.

## 2) Scheduler Contract

Required stage order:

1. `aggregate`
2. `anomaly`
3. `alerts`

Recommended production cadence:

1. `job:aggregate`: every 1 minute
2. `job:anomaly`: every 1-2 minutes
3. `job:alerts`: every 1-2 minutes

Always-on workers:

1. `worker:operational-events`
2. `worker:incident-bridge`

## 3) Operator Checks

Readiness check (dependencies and data-source prerequisites):

```bash
npm run check:pipeline:readiness
```

Freshness check (missed-run/staleness detection):

```bash
npm run check:pipeline:freshness
```

Combined operator check:

```bash
npm run check:pipeline:ops
```

JSON output for automation:

```bash
npm run check:pipeline:freshness -- --json
```

## 4) Freshness Data Source

Freshness is determined from `worker_leases.last_completed_at` for:

- `job:aggregate`
- `job:anomaly`
- `job:alerts`

Threshold overrides (optional):

- `SYNTEQ_PIPELINE_MAX_DELAY_AGGREGATE_MIN` (default `5`)
- `SYNTEQ_PIPELINE_MAX_DELAY_ANOMALY_MIN` (default `7`)
- `SYNTEQ_PIPELINE_MAX_DELAY_ALERTS_MIN` (default `7`)

## 5) Missed-Run Symptoms and First Response

Symptoms:

1. Monitoring trends stop moving while ingestion remains active.
2. Incidents stop opening/resolving despite telemetry flow.
3. Alert delivery lags while incidents remain open.

First response:

1. Run readiness check.
2. Run freshness check and identify stale stage(s).
3. Verify scheduler trigger history for that stage.
4. Inspect job logs and rerun the stale stage manually.

## 6) Cloud Scheduler HTTP Triggers (Minimal Internal Path)

Synteq exposes internal scheduler-only API paths under `/v1/internal/scheduler/*`:

1. `POST /v1/internal/scheduler/aggregate`
2. `POST /v1/internal/scheduler/anomaly`
3. `POST /v1/internal/scheduler/alerts`

These routes are intended for Cloud Scheduler -> Cloud Run authenticated HTTP calls.

### Required auth model

1. Keep Cloud Run invocation authenticated (do **not** enable unauthenticated invocation for scheduler paths).
2. Use Cloud Scheduler HTTP targets with OIDC token injection.
3. Provide header `x-synteq-scheduler-secret` that matches API env var `SCHEDULER_SHARED_SECRET`.
4. Requests must include Cloud Scheduler marker header (`x-cloudscheduler: true`) and bearer auth.

### Service account assumptions

1. Create/use a dedicated scheduler service account (example: `synteq-scheduler@<project>.iam.gserviceaccount.com`).
2. Grant it Cloud Run Invoker on `synteq-api`.

Example:

```bash
gcloud run services add-iam-policy-binding synteq-api \
  --region asia-southeast1 \
  --member="serviceAccount:synteq-scheduler@<project>.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

### Example Cloud Scheduler jobs

Use API base URL as target (`https://<synteq-api-url>`), plus OIDC audience equal to that same base URL.

```bash
gcloud scheduler jobs create http synteq-aggregate \
  --location asia-southeast1 \
  --schedule="*/1 * * * *" \
  --uri="https://<synteq-api-url>/v1/internal/scheduler/aggregate" \
  --http-method=POST \
  --oidc-service-account-email="synteq-scheduler@<project>.iam.gserviceaccount.com" \
  --oidc-token-audience="https://<synteq-api-url>" \
  --headers="x-synteq-scheduler-secret=<SCHEDULER_SHARED_SECRET>,Content-Type=application/json" \
  --message-body='{"trigger_id":"scheduler-aggregate"}'

gcloud scheduler jobs create http synteq-anomaly \
  --location asia-southeast1 \
  --schedule="*/2 * * * *" \
  --uri="https://<synteq-api-url>/v1/internal/scheduler/anomaly" \
  --http-method=POST \
  --oidc-service-account-email="synteq-scheduler@<project>.iam.gserviceaccount.com" \
  --oidc-token-audience="https://<synteq-api-url>" \
  --headers="x-synteq-scheduler-secret=<SCHEDULER_SHARED_SECRET>,Content-Type=application/json" \
  --message-body='{"trigger_id":"scheduler-anomaly"}'

gcloud scheduler jobs create http synteq-alerts \
  --location asia-southeast1 \
  --schedule="*/3 * * * *" \
  --uri="https://<synteq-api-url>/v1/internal/scheduler/alerts" \
  --http-method=POST \
  --oidc-service-account-email="synteq-scheduler@<project>.iam.gserviceaccount.com" \
  --oidc-token-audience="https://<synteq-api-url>" \
  --headers="x-synteq-scheduler-secret=<SCHEDULER_SHARED_SECRET>,Content-Type=application/json" \
  --message-body='{"trigger_id":"scheduler-alerts"}'
```

Recommended order remains:

1. aggregate
2. anomaly
3. alerts
