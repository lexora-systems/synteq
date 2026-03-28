import "dotenv/config";
import { resolveEnvironmentSecrets } from "../lib/secret-manager.js";
import { prisma } from "../lib/prisma.js";
import {
  markPipelineStageAttempt,
  markPipelineStageFailure,
  markPipelineStageSuccess
} from "../services/pipeline-freshness-service.js";
import { runAggregateMetricsRollup } from "../services/aggregate-metrics-service.js";

async function main() {
  await resolveEnvironmentSecrets(["BIGQUERY_KEY_JSON"]);
  await markPipelineStageAttempt("aggregate");

  try {
    await runAggregateMetricsRollup();
    console.log("aggregation job completed");
    await markPipelineStageSuccess("aggregate");
  } catch (error) {
    await markPipelineStageFailure("aggregate");
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
