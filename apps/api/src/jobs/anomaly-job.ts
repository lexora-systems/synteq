import "dotenv/config";
import { resolveEnvironmentSecrets } from "../lib/secret-manager.js";
import {
  markPipelineStageAttempt,
  markPipelineStageFailure,
  markPipelineStageSuccess
} from "../services/pipeline-freshness-service.js";

async function main() {
  await resolveEnvironmentSecrets([
    "DATABASE_URL",
    "BIGQUERY_KEY_JSON",
    "SYNTEQ_API_KEY_SALT",
    "JWT_SECRET",
    "SLACK_DEFAULT_WEBHOOK_URL"
  ]);
  await markPipelineStageAttempt("anomaly");

  try {
    const [{ runAnomalyDetectionJob }, { prisma }] = await Promise.all([
      import("../services/anomaly-service.js"),
      import("../lib/prisma.js")
    ]);

    await runAnomalyDetectionJob();
    await markPipelineStageSuccess("anomaly");
    await prisma.$disconnect();
  } catch (error) {
    await markPipelineStageFailure("anomaly");
    throw error;
  }
}

main().catch(async (error) => {
  console.error("anomaly-job failed", error);
  const { prisma } = await import("../lib/prisma.js");
  await prisma.$disconnect();
  process.exit(1);
});
