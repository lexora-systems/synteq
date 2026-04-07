export const operationalEventsRules = {
  workerKey: "operational_events_v1",
  batchSize: 200,
  jobFailedBurstThreshold: 3,
  jobFailedBurstWindowMinutes: 15,
  workflowFailedBurstThreshold: 3,
  workflowFailedBurstWindowMinutes: 20,
  retrySpikeWindowMinutes: 30,
  retrySpikeThreshold: 3,
  retrySpikeRatioThreshold: 0.35,
  retrySpikeMaxEvents: 80,
  durationDriftLookbackMinutes: 12 * 60,
  durationDriftBaselineMinSamples: 3,
  durationDriftBaselineMaxSamples: 25,
  durationDriftRatioThreshold: 2,
  durationDriftAbsoluteDeltaMs: 120_000,
  workflowStuckMinutes: 30,
  jobStuckMinutes: 20,
  maxEvidenceEventIds: 5
} as const;

export type SupportedGitHubEventType =
  | "workflow_requested"
  | "workflow_started"
  | "workflow_completed"
  | "workflow_failed"
  | "job_queued"
  | "job_started"
  | "job_completed"
  | "job_failed";

export function isGitHubWorkflowCorrelation(correlationKey: string) {
  return correlationKey.includes(":workflow_run:");
}

export function isGitHubJobCorrelation(correlationKey: string) {
  return correlationKey.includes(":workflow_job:");
}

export function githubWorkflowStartTypes() {
  return new Set<SupportedGitHubEventType>(["workflow_requested", "workflow_started"]);
}

export function githubWorkflowTerminalTypes() {
  return new Set<SupportedGitHubEventType>(["workflow_completed", "workflow_failed"]);
}

export function githubJobStartTypes() {
  return new Set<SupportedGitHubEventType>(["job_queued", "job_started"]);
}

export function githubJobTerminalTypes() {
  return new Set<SupportedGitHubEventType>(["job_completed", "job_failed"]);
}
