import "dotenv/config";
import { resolveEnvironmentSecrets } from "../lib/secret-manager.js";
import {
  markPipelineStageAttempt,
  markPipelineStageFailure,
  markPipelineStageSuccess
} from "../services/pipeline-freshness-service.js";

async function main() {
  await resolveEnvironmentSecrets(["DATABASE_URL", "SLACK_DEFAULT_WEBHOOK_URL", "BREVO_API_KEY"]);
  await markPipelineStageAttempt("alerts");

  try {
    const [{ dispatchPendingAlertEvents }, { prisma }] = await Promise.all([
      import("../services/alert-service.js"),
      import("../lib/prisma.js")
    ]);

    await dispatchPendingAlertEvents();
    await markPipelineStageSuccess("alerts");
    await prisma.$disconnect();
  } catch (error) {
    await markPipelineStageFailure("alerts");
    throw error;
  }
}

main().catch(async (error) => {
  console.error("alert-dispatch-job failed", error);
  const { prisma } = await import("../lib/prisma.js");
  await prisma.$disconnect();
  process.exit(1);
});
