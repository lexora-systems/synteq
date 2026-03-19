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
