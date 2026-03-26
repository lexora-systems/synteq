import { resolveEnvironmentSecrets } from "../lib/secret-manager.js";
import {
  markPipelineStageAttempt,
  markPipelineStageFailure,
  markPipelineStageSuccess,
  type PipelineStageName
} from "./pipeline-freshness-service.js";
import { dispatchPendingAlertEvents } from "./alert-service.js";
import { runAnomalyDetectionJob } from "./anomaly-service.js";
import { runAggregateMetricsRollup } from "./aggregate-metrics-service.js";
import { runWithWorkerLease } from "./worker-lease-service.js";

export type SchedulerTask = "aggregate" | "anomaly" | "alerts";

export type SchedulerTaskResult = {
  task: SchedulerTask;
  stage: PipelineStageName;
  skipped: boolean;
  reason: string | null;
};

type SchedulerTaskDefinition = {
  task: SchedulerTask;
  stage: PipelineStageName;
  workerName: string;
  resolveSecrets: () => Promise<void>;
  run: () => Promise<void>;
};

const TASK_DEFINITIONS: Record<SchedulerTask, SchedulerTaskDefinition> = {
  aggregate: {
    task: "aggregate",
    stage: "aggregate",
    workerName: "job:aggregate",
    resolveSecrets: async () => {
      await resolveEnvironmentSecrets(["BIGQUERY_KEY_JSON"]);
    },
    run: async () => {
      await runAggregateMetricsRollup();
    }
  },
  anomaly: {
    task: "anomaly",
    stage: "anomaly",
    workerName: "job:anomaly",
    resolveSecrets: async () => {
      await resolveEnvironmentSecrets([
        "DATABASE_URL",
        "BIGQUERY_KEY_JSON",
        "SYNTEQ_API_KEY_SALT",
        "JWT_SECRET",
        "SLACK_DEFAULT_WEBHOOK_URL"
      ]);
    },
    run: async () => {
      await runAnomalyDetectionJob();
    }
  },
  alerts: {
    task: "alerts",
    stage: "alerts",
    workerName: "job:alerts",
    resolveSecrets: async () => {
      await resolveEnvironmentSecrets(["DATABASE_URL", "SLACK_DEFAULT_WEBHOOK_URL", "BREVO_API_KEY"]);
    },
    run: async () => {
      await dispatchPendingAlertEvents();
    }
  }
};

export async function runSchedulerTask(task: SchedulerTask): Promise<SchedulerTaskResult> {
  const definition = TASK_DEFINITIONS[task];
  await definition.resolveSecrets();

  const lease = await runWithWorkerLease({
    workerName: definition.workerName,
    run: async () => {
      await markPipelineStageAttempt(definition.stage);
      try {
        await definition.run();
        await markPipelineStageSuccess(definition.stage);
      } catch (error) {
        await markPipelineStageFailure(definition.stage);
        throw error;
      }
    }
  });

  if (lease.skipped) {
    return {
      task: definition.task,
      stage: definition.stage,
      skipped: true,
      reason: "lease_not_acquired"
    };
  }

  return {
    task: definition.task,
    stage: definition.stage,
    skipped: false,
    reason: null
  };
}
