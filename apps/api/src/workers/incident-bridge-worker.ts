import "dotenv/config";
import { resolveEnvironmentSecrets } from "../lib/secret-manager.js";
import { runWithWorkerLease } from "../services/worker-lease-service.js";

const WORKER_NAME = "incident-bridge-worker";

async function main() {
  await resolveEnvironmentSecrets([
    "DATABASE_URL",
    "REDIS_URL",
    "BIGQUERY_KEY_JSON",
    "SYNTEQ_API_KEY_SALT",
    "JWT_SECRET"
  ]);

  const [{ runIncidentBridgeBatch }, { prisma }] = await Promise.all([
    import("../services/incident-bridge-service.js"),
    import("../lib/prisma.js")
  ]);

  const execution = await runWithWorkerLease({
    workerName: WORKER_NAME,
    run: () => runIncidentBridgeBatch()
  });

  if (execution.skipped) {
    console.info("incident-bridge-worker.skipped", {
      worker_name: WORKER_NAME,
      owner_token: execution.ownerToken,
      lease_expires_at: execution.leaseExpiresAt?.toISOString() ?? null,
      held_by_owner_token: execution.heldByOwnerToken
    });
    await prisma.$disconnect();
    return;
  }

  console.info("incident-bridge-worker.completed", execution.result);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("incident-bridge-worker.failed", error);
  const { prisma } = await import("../lib/prisma.js");
  await prisma.$disconnect();
  process.exit(1);
});
