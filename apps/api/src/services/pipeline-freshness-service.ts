import { prisma } from "../lib/prisma.js";

export const PIPELINE_STAGE_DEFINITIONS = [
  {
    stage: "aggregate",
    workerName: "job:aggregate",
    defaultMaxDelayMinutes: 5,
    envVar: "SYNTEQ_PIPELINE_MAX_DELAY_AGGREGATE_MIN"
  },
  {
    stage: "anomaly",
    workerName: "job:anomaly",
    defaultMaxDelayMinutes: 7,
    envVar: "SYNTEQ_PIPELINE_MAX_DELAY_ANOMALY_MIN"
  },
  {
    stage: "alerts",
    workerName: "job:alerts",
    defaultMaxDelayMinutes: 7,
    envVar: "SYNTEQ_PIPELINE_MAX_DELAY_ALERTS_MIN"
  }
] as const;

export type PipelineStageName = (typeof PIPELINE_STAGE_DEFINITIONS)[number]["stage"];

type StageDefinition = (typeof PIPELINE_STAGE_DEFINITIONS)[number];

type WorkerLeaseSnapshot = {
  worker_name: string;
  last_heartbeat_at: Date | null;
  last_completed_at: Date | null;
};

export type StageFreshness = {
  stage: PipelineStageName;
  workerName: string;
  status: "healthy" | "stale";
  message: string;
  maxDelayMinutes: number;
  lastHeartbeatAt: string | null;
  lastCompletedAt: string | null;
  minutesSinceLastSuccess: number | null;
};

function getStageDefinition(stage: PipelineStageName): StageDefinition {
  const definition = PIPELINE_STAGE_DEFINITIONS.find((item) => item.stage === stage);
  if (!definition) {
    throw new Error(`Unknown pipeline stage: ${stage}`);
  }
  return definition;
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function getPipelineStageThresholdMinutes(stage: PipelineStageName): number {
  const definition = getStageDefinition(stage);
  return toPositiveInt(process.env[definition.envVar], definition.defaultMaxDelayMinutes);
}

function heartbeatUpdateError(stage: PipelineStageName, action: string, error: unknown) {
  console.warn("pipeline-freshness.heartbeat-update-failed", {
    stage,
    action,
    error: error instanceof Error ? error.message : "unknown_error"
  });
}

async function updateStageHeartbeat(stage: PipelineStageName, data: { lastCompletedAt?: Date }, now = new Date()) {
  const definition = getStageDefinition(stage);
  try {
    await prisma.workerLease.upsert({
      where: {
        worker_name: definition.workerName
      },
      create: {
        worker_name: definition.workerName,
        last_heartbeat_at: now,
        last_completed_at: data.lastCompletedAt ?? null
      },
      update: {
        last_heartbeat_at: now,
        ...(data.lastCompletedAt ? { last_completed_at: data.lastCompletedAt } : {})
      }
    });
  } catch (error) {
    heartbeatUpdateError(stage, data.lastCompletedAt ? "success" : "attempt", error);
  }
}

export async function markPipelineStageAttempt(stage: PipelineStageName, now = new Date()) {
  await updateStageHeartbeat(stage, {}, now);
}

export async function markPipelineStageSuccess(stage: PipelineStageName, now = new Date()) {
  await updateStageHeartbeat(stage, { lastCompletedAt: now }, now);
}

export async function markPipelineStageFailure(stage: PipelineStageName) {
  const now = new Date();
  const definition = getStageDefinition(stage);
  try {
    await prisma.workerLease.upsert({
      where: {
        worker_name: definition.workerName
      },
      create: {
        worker_name: definition.workerName,
        last_heartbeat_at: now,
        last_completed_at: null
      },
      update: {
        last_heartbeat_at: now
      }
    });
  } catch (error) {
    heartbeatUpdateError(stage, "failure", error);
  }
}

export async function readPipelineStageSnapshots(): Promise<Map<PipelineStageName, WorkerLeaseSnapshot>> {
  const rows = await prisma.workerLease.findMany({
    where: {
      worker_name: {
        in: PIPELINE_STAGE_DEFINITIONS.map((definition) => definition.workerName)
      }
    },
    select: {
      worker_name: true,
      last_heartbeat_at: true,
      last_completed_at: true
    }
  });

  const snapshots = new Map<PipelineStageName, WorkerLeaseSnapshot>();
  for (const definition of PIPELINE_STAGE_DEFINITIONS) {
    const row = rows.find((item) => item.worker_name === definition.workerName);
    if (row) {
      snapshots.set(definition.stage, row);
    }
  }
  return snapshots;
}

export function evaluatePipelineStageFreshness(input: {
  stage: PipelineStageName;
  maxDelayMinutes: number;
  now: Date;
  snapshot?: WorkerLeaseSnapshot;
}): StageFreshness {
  const definition = getStageDefinition(input.stage);
  const snapshot = input.snapshot;
  const maxDelayMinutes = Math.max(1, input.maxDelayMinutes);

  if (!snapshot) {
    return {
      stage: input.stage,
      workerName: definition.workerName,
      status: "stale",
      message: "no execution metadata recorded yet",
      maxDelayMinutes,
      lastHeartbeatAt: null,
      lastCompletedAt: null,
      minutesSinceLastSuccess: null
    };
  }

  if (!snapshot.last_completed_at) {
    return {
      stage: input.stage,
      workerName: definition.workerName,
      status: "stale",
      message: snapshot.last_heartbeat_at
        ? "attempt seen, but no successful completion recorded yet"
        : "no successful completion recorded yet",
      maxDelayMinutes,
      lastHeartbeatAt: snapshot.last_heartbeat_at?.toISOString() ?? null,
      lastCompletedAt: null,
      minutesSinceLastSuccess: null
    };
  }

  const minutesSinceLastSuccess = (input.now.getTime() - snapshot.last_completed_at.getTime()) / 60_000;
  if (minutesSinceLastSuccess > maxDelayMinutes) {
    return {
      stage: input.stage,
      workerName: definition.workerName,
      status: "stale",
      message: `last successful run ${minutesSinceLastSuccess.toFixed(1)}m ago exceeds ${maxDelayMinutes}m threshold`,
      maxDelayMinutes,
      lastHeartbeatAt: snapshot.last_heartbeat_at?.toISOString() ?? null,
      lastCompletedAt: snapshot.last_completed_at.toISOString(),
      minutesSinceLastSuccess
    };
  }

  return {
    stage: input.stage,
    workerName: definition.workerName,
    status: "healthy",
    message: `last successful run ${minutesSinceLastSuccess.toFixed(1)}m ago`,
    maxDelayMinutes,
    lastHeartbeatAt: snapshot.last_heartbeat_at?.toISOString() ?? null,
    lastCompletedAt: snapshot.last_completed_at.toISOString(),
    minutesSinceLastSuccess
  };
}
