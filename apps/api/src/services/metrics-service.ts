import { config } from "../config.js";
import { getBigQueryClient } from "../lib/bigquery.js";
import { runtimeMetrics } from "../lib/runtime-metrics.js";
import { getRangeMinutes } from "../utils/range.js";
import { TtlCache } from "../utils/ttl-cache.js";

const overviewCache = new TtlCache<{
  summary: Record<string, unknown> | null;
  series: Array<Record<string, unknown>>;
  windows: Record<string, unknown>;
}>(5_000);

function cacheKey(params: {
  tenantId: string;
  workflowId?: string;
  env?: string;
  range: "15m" | "1h" | "6h" | "24h" | "7d";
}) {
  return `${params.tenantId}|${params.workflowId ?? "*"}|${params.env ?? "*"}|${params.range}`;
}

export async function getOverviewMetrics(params: {
  tenantId: string;
  workflowId?: string;
  env?: string;
  range: "15m" | "1h" | "6h" | "24h" | "7d";
}) {
  const key = cacheKey(params);
  const cached = overviewCache.get(key);
  if (cached) {
    runtimeMetrics.increment("metrics_cache_hit_total");
    return cached;
  }

  runtimeMetrics.increment("metrics_cache_miss_total");
  const bq = getBigQueryClient();
  const minutes = getRangeMinutes(params.range);

  const where: string[] = [
    "tenant_id = @tenantId",
    "bucket_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @rangeMinute MINUTE)"
  ];
  const queryParams: Record<string, unknown> = {
    tenantId: params.tenantId,
    rangeMinute: minutes
  };

  if (params.workflowId) {
    where.push("workflow_id = @workflowId");
    queryParams.workflowId = params.workflowId;
  }

  if (params.env) {
    where.push("environment = @env");
    queryParams.env = params.env;
  }

  const whereSql = where.join(" AND ");

  const [summaryRows] = await bq.query({
    query: `
      SELECT
        COALESCE(SUM(count_total), 0) AS count_total,
        COALESCE(SUM(count_success), 0) AS count_success,
        COALESCE(SUM(count_failed), 0) AS count_failed,
        COALESCE(SUM(count_timeout), 0) AS count_timeout,
        COALESCE(AVG(avg_duration_ms), 0) AS avg_duration_ms,
        COALESCE(AVG(p95_duration_ms), 0) AS p95_duration_ms,
        COALESCE(SUM(retry_rate * count_total) / NULLIF(SUM(count_total), 0), 0) AS retry_rate,
        COALESCE(SUM(duplicate_rate * count_total) / NULLIF(SUM(count_total), 0), 0) AS duplicate_rate,
        COALESCE(SUM(sum_token_in), 0) AS sum_token_in,
        COALESCE(SUM(sum_token_out), 0) AS sum_token_out,
        COALESCE(SUM(sum_cost_usd), 0) AS sum_cost_usd,
        COALESCE(AVG(avg_cost_usd), 0) AS avg_cost_usd,
        MAX(bucket_ts) AS last_bucket
      FROM \`${config.BIGQUERY_PROJECT_ID}.${config.BIGQUERY_DATASET}.workflow_metrics_minute\`
      WHERE ${whereSql}
    `,
    params: queryParams,
    useLegacySql: false
  });

  const [seriesRows] = await bq.query({
    query: `
      SELECT
        bucket_ts,
        SUM(count_total) AS count_total,
        SUM(count_success) AS count_success,
        SUM(count_failed) AS count_failed,
        SUM(count_timeout) AS count_timeout,
        AVG(avg_duration_ms) AS avg_duration_ms,
        AVG(p95_duration_ms) AS p95_duration_ms,
        SUM(retry_rate * count_total) / NULLIF(SUM(count_total), 0) AS retry_rate,
        SUM(duplicate_rate * count_total) / NULLIF(SUM(count_total), 0) AS duplicate_rate,
        SUM(sum_token_in) AS sum_token_in,
        SUM(sum_token_out) AS sum_token_out,
        SUM(sum_cost_usd) AS sum_cost_usd,
        AVG(avg_cost_usd) AS avg_cost_usd
      FROM \`${config.BIGQUERY_PROJECT_ID}.${config.BIGQUERY_DATASET}.workflow_metrics_minute\`
      WHERE ${whereSql}
      GROUP BY bucket_ts
      ORDER BY bucket_ts ASC
    `,
    params: queryParams,
    useLegacySql: false
  });

  const [windowRows] = await bq.query({
    query: `
      SELECT
        window,
        COALESCE(SUM(count_total), 0) AS count_total,
        COALESCE(SUM(count_failed), 0) AS count_failed,
        COALESCE(AVG(p95_duration_ms), 0) AS p95_duration_ms,
        COALESCE(SUM(sum_cost_usd), 0) AS sum_cost_usd,
        COALESCE(AVG(avg_cost_usd), 0) AS avg_cost_usd
      FROM (
        SELECT '5m' AS window, *
        FROM \`${config.BIGQUERY_PROJECT_ID}.${config.BIGQUERY_DATASET}.workflow_metrics_minute\`
        WHERE tenant_id = @tenantId
          AND bucket_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 5 MINUTE)
          ${params.workflowId ? "AND workflow_id = @workflowId" : ""}
          ${params.env ? "AND environment = @env" : ""}
        UNION ALL
        SELECT '15m' AS window, *
        FROM \`${config.BIGQUERY_PROJECT_ID}.${config.BIGQUERY_DATASET}.workflow_metrics_minute\`
        WHERE tenant_id = @tenantId
          AND bucket_ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 15 MINUTE)
          ${params.workflowId ? "AND workflow_id = @workflowId" : ""}
          ${params.env ? "AND environment = @env" : ""}
      )
      GROUP BY window
    `,
    params: queryParams,
    useLegacySql: false
  });

  const windows = Object.fromEntries(
    (windowRows as Array<{ window: string }>).map((row) => [row.window, row])
  );

  const result = {
    summary: (summaryRows[0] as Record<string, unknown> | undefined) ?? null,
    series: seriesRows as Array<Record<string, unknown>>,
    windows
  };

  overviewCache.set(key, result, config.METRICS_CACHE_TTL_SEC);
  runtimeMetrics.setGauge("metrics_cache_size", overviewCache.size());
  return result;
}
