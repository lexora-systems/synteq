import "dotenv/config";
import { resolveEnvironmentSecrets } from "../lib/secret-manager.js";

async function main() {
  await resolveEnvironmentSecrets([
    "DATABASE_URL",
    "BIGQUERY_KEY_JSON",
    "SYNTEQ_API_KEY_SALT",
    "JWT_SECRET",
    "SLACK_DEFAULT_WEBHOOK_URL"
  ]);

  const [{ runAnomalyDetectionJob }, { prisma }] = await Promise.all([
    import("../services/anomaly-service.js"),
    import("../lib/prisma.js")
  ]);

  await runAnomalyDetectionJob();
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("anomaly-job failed", error);
  const { prisma } = await import("../lib/prisma.js");
  await prisma.$disconnect();
  process.exit(1);
});
