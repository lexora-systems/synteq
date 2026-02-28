-- Replace YOUR_PROJECT_ID before execution.
CREATE SCHEMA IF NOT EXISTS `YOUR_PROJECT_ID.synteq`;

CREATE TABLE IF NOT EXISTS `YOUR_PROJECT_ID.synteq.execution_events` (
  event_ts TIMESTAMP NOT NULL,
  ingest_ts TIMESTAMP,
  tenant_id STRING,
  workflow_id STRING,
  workflow_slug STRING,
  environment STRING,
  execution_id STRING,
  run_id STRING,
  status STRING,
  duration_ms INT64,
  retry_count INT64,
  token_in INT64,
  token_out INT64,
  cost_estimate_usd FLOAT64,
  error_class STRING,
  error_message STRING,
  step_name STRING,
  step_index INT64,
  payload STRING,
  fingerprint STRING,
  minute_bucket TIMESTAMP,
  source STRING,
  request_id STRING
)
PARTITION BY DATE(event_ts)
CLUSTER BY tenant_id, workflow_id, status, fingerprint;

CREATE TABLE IF NOT EXISTS `YOUR_PROJECT_ID.synteq.heartbeats` (
  heartbeat_ts TIMESTAMP NOT NULL,
  ingest_ts TIMESTAMP,
  tenant_id STRING,
  workflow_id STRING,
  workflow_slug STRING,
  environment STRING,
  payload STRING,
  fingerprint STRING,
  minute_bucket TIMESTAMP,
  source STRING,
  request_id STRING
)
PARTITION BY DATE(heartbeat_ts)
CLUSTER BY tenant_id, workflow_id;

CREATE TABLE IF NOT EXISTS `YOUR_PROJECT_ID.synteq.workflow_metrics_minute` (
  bucket_ts TIMESTAMP NOT NULL,
  tenant_id STRING,
  workflow_id STRING,
  environment STRING,
  count_total INT64,
  count_success INT64,
  count_failed INT64,
  count_timeout INT64,
  avg_duration_ms FLOAT64,
  p50_duration_ms FLOAT64,
  p95_duration_ms FLOAT64,
  retry_rate FLOAT64,
  duplicate_rate FLOAT64,
  sum_token_in INT64,
  sum_token_out INT64,
  sum_cost_usd FLOAT64,
  avg_cost_usd FLOAT64
)
PARTITION BY DATE(bucket_ts)
CLUSTER BY tenant_id, workflow_id;
