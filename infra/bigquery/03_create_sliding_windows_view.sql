-- Replace YOUR_PROJECT_ID before execution.
-- Sliding windows view used by dashboards/jobs.
CREATE OR REPLACE VIEW `YOUR_PROJECT_ID.synteq.workflow_metrics_sliding` AS
WITH base AS (
  SELECT *
  FROM `YOUR_PROJECT_ID.synteq.workflow_metrics_minute`
  WHERE bucket_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 15 MINUTE)
),
windowed AS (
  SELECT
    tenant_id,
    workflow_id,
    environment,
    '5m' AS window,
    SUM(count_total) AS count_total,
    SUM(count_failed) AS count_failed,
    AVG(p95_duration_ms) AS p95_duration_ms,
    SUM(sum_cost_usd) AS sum_cost_usd,
    AVG(avg_cost_usd) AS avg_cost_usd,
    MAX(bucket_ts) AS last_bucket
  FROM base
  WHERE bucket_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 5 MINUTE)
  GROUP BY tenant_id, workflow_id, environment

  UNION ALL

  SELECT
    tenant_id,
    workflow_id,
    environment,
    '15m' AS window,
    SUM(count_total) AS count_total,
    SUM(count_failed) AS count_failed,
    AVG(p95_duration_ms) AS p95_duration_ms,
    SUM(sum_cost_usd) AS sum_cost_usd,
    AVG(avg_cost_usd) AS avg_cost_usd,
    MAX(bucket_ts) AS last_bucket
  FROM base
  GROUP BY tenant_id, workflow_id, environment
)
SELECT * FROM windowed;
