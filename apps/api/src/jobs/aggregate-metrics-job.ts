import "dotenv/config";
import { resolveEnvironmentSecrets } from "../lib/secret-manager.js";

function buildAggregationQuery(projectId: string, dataset: string, lookbackMinutes: number) {
  return `
DECLARE lookback_minutes INT64 DEFAULT ${lookbackMinutes};

MERGE \`${projectId}.${dataset}.workflow_metrics_minute\` AS target
USING (
  WITH base AS (
    SELECT
      TIMESTAMP_TRUNC(event_ts, MINUTE) AS bucket_ts,
      tenant_id,
      workflow_id,
      environment,
      execution_id,
      status,
      duration_ms,
      retry_count,
      token_in,
      token_out,
      cost_estimate_usd,
      ROW_NUMBER() OVER (
        PARTITION BY tenant_id, workflow_id, environment, TIMESTAMP_TRUNC(event_ts, MINUTE), execution_id
        ORDER BY ingest_ts DESC
      ) AS rn
    FROM \`${projectId}.${dataset}.execution_events\`
    WHERE event_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL lookback_minutes MINUTE)
  ),
  dedup AS (
    SELECT *
    FROM base
    WHERE rn = 1
  ),
  duplicate_events AS (
    SELECT
      bucket_ts,
      tenant_id,
      workflow_id,
      environment,
      COUNTIF(rn > 1) AS duplicate_rows
    FROM base
    GROUP BY bucket_ts, tenant_id, workflow_id, environment
  )
  SELECT
    d.bucket_ts,
    d.tenant_id,
    d.workflow_id,
    d.environment,
    COUNT(*) AS count_total,
    SUM(IF(d.status = 'success', 1, 0)) AS count_success,
    SUM(IF(d.status = 'failed', 1, 0)) AS count_failed,
    SUM(IF(d.status = 'timeout', 1, 0)) AS count_timeout,
    AVG(CAST(d.duration_ms AS FLOAT64)) AS avg_duration_ms,
    APPROX_QUANTILES(CAST(d.duration_ms AS FLOAT64), 100)[OFFSET(50)] AS p50_duration_ms,
    APPROX_QUANTILES(CAST(d.duration_ms AS FLOAT64), 100)[OFFSET(95)] AS p95_duration_ms,
    SAFE_DIVIDE(SUM(IF(d.retry_count > 0, 1, 0)), COUNT(*)) AS retry_rate,
    SAFE_DIVIDE(COALESCE(dup.duplicate_rows, 0), COUNT(*)) AS duplicate_rate,
    SUM(COALESCE(d.token_in, 0)) AS sum_token_in,
    SUM(COALESCE(d.token_out, 0)) AS sum_token_out,
    SUM(COALESCE(d.cost_estimate_usd, 0)) AS sum_cost_usd,
    SAFE_DIVIDE(SUM(COALESCE(d.cost_estimate_usd, 0)), COUNT(*)) AS avg_cost_usd
  FROM dedup d
  LEFT JOIN duplicate_events dup
    ON d.bucket_ts = dup.bucket_ts
   AND d.tenant_id = dup.tenant_id
   AND d.workflow_id = dup.workflow_id
   AND d.environment = dup.environment
  GROUP BY d.bucket_ts, d.tenant_id, d.workflow_id, d.environment, dup.duplicate_rows
) AS src
ON target.bucket_ts = src.bucket_ts
AND target.tenant_id = src.tenant_id
AND target.workflow_id = src.workflow_id
AND target.environment = src.environment
WHEN MATCHED THEN
  UPDATE SET
    count_total = src.count_total,
    count_success = src.count_success,
    count_failed = src.count_failed,
    count_timeout = src.count_timeout,
    avg_duration_ms = src.avg_duration_ms,
    p50_duration_ms = src.p50_duration_ms,
    p95_duration_ms = src.p95_duration_ms,
    retry_rate = src.retry_rate,
    duplicate_rate = src.duplicate_rate,
    sum_token_in = src.sum_token_in,
    sum_token_out = src.sum_token_out,
    sum_cost_usd = src.sum_cost_usd,
    avg_cost_usd = src.avg_cost_usd
WHEN NOT MATCHED THEN
  INSERT (
    bucket_ts,
    tenant_id,
    workflow_id,
    environment,
    count_total,
    count_success,
    count_failed,
    count_timeout,
    avg_duration_ms,
    p50_duration_ms,
    p95_duration_ms,
    retry_rate,
    duplicate_rate,
    sum_token_in,
    sum_token_out,
    sum_cost_usd,
    avg_cost_usd
  )
  VALUES (
    src.bucket_ts,
    src.tenant_id,
    src.workflow_id,
    src.environment,
    src.count_total,
    src.count_success,
    src.count_failed,
    src.count_timeout,
    src.avg_duration_ms,
    src.p50_duration_ms,
    src.p95_duration_ms,
    src.retry_rate,
    src.duplicate_rate,
    src.sum_token_in,
    src.sum_token_out,
    src.sum_cost_usd,
    src.avg_cost_usd
  );
`;
}

async function main() {
  await resolveEnvironmentSecrets(["BIGQUERY_KEY_JSON"]);

  const [{ config }, { getBigQueryClient }] = await Promise.all([
    import("../config.js"),
    import("../lib/bigquery.js")
  ]);

  const query = buildAggregationQuery(
    config.BIGQUERY_PROJECT_ID,
    config.BIGQUERY_DATASET,
    config.BIGQUERY_AGG_LOOKBACK_MINUTES
  );

  const bq = getBigQueryClient();
  await bq.query({
    query,
    useLegacySql: false
  });
  console.log("aggregation job completed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
