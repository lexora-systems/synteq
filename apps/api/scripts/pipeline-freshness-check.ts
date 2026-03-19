import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { resolveEnvironmentSecrets } from "../src/lib/secret-manager.js";
import {
  PIPELINE_STAGE_DEFINITIONS,
  evaluatePipelineStageFreshness,
  getPipelineStageThresholdMinutes,
  readPipelineStageSnapshots
} from "../src/services/pipeline-freshness-service.js";

type FreshnessReport = {
  checked_at: string;
  check_type: "cadence_freshness";
  overall_status: "healthy" | "stale";
  stages: ReturnType<typeof evaluatePipelineStageFreshness>[];
  guidance: string[];
};

function isJsonMode() {
  return process.argv.includes("--json");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "unknown error";
}

function printFailure(error: unknown) {
  const message = errorMessage(error);
  if (message.toLowerCase().includes("can't reach database server")) {
    console.error("Pipeline freshness check failed: MySQL is unreachable. Start the database and retry.");
    return;
  }
  console.error(`Pipeline freshness check failed unexpectedly: ${message}`);
}

function printStage(result: ReturnType<typeof evaluatePipelineStageFreshness>) {
  const symbol = result.status === "healthy" ? "PASS" : "FAIL";
  const completedAt = result.lastCompletedAt ? ` (last_success=${result.lastCompletedAt})` : "";
  console.log(`[${symbol}] ${result.stage}: ${result.message}${completedAt}`);
}

function buildGuidance(stages: ReturnType<typeof evaluatePipelineStageFreshness>[]) {
  const staleStages = stages.filter((stage) => stage.status === "stale").map((stage) => stage.stage);
  if (staleStages.length === 0) {
    return [
      "All required stages are within freshness thresholds.",
      "Keep scheduler cadence stable and continue readiness checks with npm run check:pipeline:health."
    ];
  }

  return [
    `Stale stage(s): ${staleStages.join(", ")}.`,
    "Verify scheduler triggers for aggregate -> anomaly -> alerts are still active.",
    "Run npm run check:pipeline:health to confirm dependency readiness.",
    "Inspect recent job logs and rerun missed stages manually if needed."
  ];
}

async function main() {
  await resolveEnvironmentSecrets(["DATABASE_URL"]);

  const now = new Date();
  const snapshots = await readPipelineStageSnapshots();
  const stages = PIPELINE_STAGE_DEFINITIONS.map((definition) =>
    evaluatePipelineStageFreshness({
      stage: definition.stage,
      maxDelayMinutes: getPipelineStageThresholdMinutes(definition.stage),
      now,
      snapshot: snapshots.get(definition.stage)
    })
  );

  const overallStatus = stages.every((stage) => stage.status === "healthy") ? "healthy" : "stale";
  const report: FreshnessReport = {
    checked_at: now.toISOString(),
    check_type: "cadence_freshness",
    overall_status: overallStatus,
    stages,
    guidance: buildGuidance(stages)
  };

  if (isJsonMode()) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("Synteq pipeline freshness check");
    console.log("Checks stage cadence freshness from recorded successful job runs.");
    console.log("This does not replace pipeline readiness checks.");
    for (const stage of stages) {
      printStage(stage);
    }
    for (const item of report.guidance) {
      console.log(`- ${item}`);
    }
  }

  if (report.overall_status === "stale") {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    printFailure(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
