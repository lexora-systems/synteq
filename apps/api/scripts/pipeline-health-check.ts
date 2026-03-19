import "dotenv/config";
import { createClient } from "redis";
import { prisma } from "../src/lib/prisma.js";
import { config } from "../src/config.js";
import { getBigQueryClient } from "../src/lib/bigquery.js";

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

const REQUIRED_BIGQUERY_TABLES = ["workflow_metrics_minute", "execution_events", "heartbeats"] as const;

function printResult(result: CheckResult) {
  const symbol = result.ok ? "PASS" : "FAIL";
  console.log(`[${symbol}] ${result.name}: ${result.detail}`);
}

async function checkMySql(): Promise<CheckResult> {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return {
      name: "MySQL",
      ok: true,
      detail: "reachable"
    };
  } catch (error) {
    return {
      name: "MySQL",
      ok: false,
      detail: error instanceof Error ? error.message : "unreachable"
    };
  }
}

async function checkRedis(): Promise<CheckResult> {
  if (!config.REDIS_URL) {
    return {
      name: "Redis",
      ok: true,
      detail: "not configured (skipped)"
    };
  }

  const client = createClient({ url: config.REDIS_URL });
  try {
    await client.connect();
    const pong = await client.ping();
    return {
      name: "Redis",
      ok: pong.toUpperCase() === "PONG",
      detail: pong.toUpperCase() === "PONG" ? "reachable" : `unexpected ping response: ${pong}`
    };
  } catch (error) {
    return {
      name: "Redis",
      ok: false,
      detail: error instanceof Error ? error.message : "unreachable"
    };
  } finally {
    if (client.isOpen) {
      await client.quit().catch(() => undefined);
    }
  }
}

async function checkBigQueryAuth(): Promise<CheckResult> {
  try {
    const bq = getBigQueryClient();
    await bq.query({
      query: "SELECT 1 AS ok",
      useLegacySql: false
    });
    return {
      name: "BigQuery auth",
      ok: true,
      detail: "reachable"
    };
  } catch (error) {
    return {
      name: "BigQuery auth",
      ok: false,
      detail: error instanceof Error ? error.message : "auth/query failed"
    };
  }
}

async function checkBigQueryTables(): Promise<CheckResult> {
  try {
    const bq = getBigQueryClient();
    const [rows] = await bq.query({
      query: `
        SELECT table_name
        FROM \`${config.BIGQUERY_PROJECT_ID}.${config.BIGQUERY_DATASET}.INFORMATION_SCHEMA.TABLES\`
        WHERE table_name IN UNNEST(@requiredTables)
      `,
      params: {
        requiredTables: [...REQUIRED_BIGQUERY_TABLES]
      },
      useLegacySql: false
    });
    const found = new Set((rows as Array<{ table_name?: string }>).map((row) => row.table_name ?? "").filter(Boolean));
    const missing = REQUIRED_BIGQUERY_TABLES.filter((name) => !found.has(name));
    if (missing.length > 0) {
      return {
        name: "BigQuery tables",
        ok: false,
        detail: `missing ${missing.join(", ")} in ${config.BIGQUERY_PROJECT_ID}.${config.BIGQUERY_DATASET}`
      };
    }
    return {
      name: "BigQuery tables",
      ok: true,
      detail: `required tables present in ${config.BIGQUERY_PROJECT_ID}.${config.BIGQUERY_DATASET}`
    };
  } catch (error) {
    return {
      name: "BigQuery tables",
      ok: false,
      detail: error instanceof Error ? error.message : "table check failed"
    };
  }
}

async function main() {
  console.log("Synteq pipeline health check");
  console.log(`Target BigQuery dataset: ${config.BIGQUERY_PROJECT_ID}.${config.BIGQUERY_DATASET}`);

  const results = await Promise.all([checkMySql(), checkRedis(), checkBigQueryAuth(), checkBigQueryTables()]);
  for (const result of results) {
    printResult(result);
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.error(`Pipeline health check failed (${failed.length} check${failed.length > 1 ? "s" : ""}).`);
    process.exitCode = 1;
  } else {
    console.log("Pipeline health check passed.");
  }
}

main()
  .catch((error) => {
    console.error("Pipeline health check failed unexpectedly:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
