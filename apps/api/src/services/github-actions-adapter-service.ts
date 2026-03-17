import { z } from "zod";
import type { IngestOperationalEventInput } from "@synteq/shared";

const repositorySchema = z
  .object({
    full_name: z.string().min(1),
    name: z.string().min(1).optional()
  })
  .passthrough();

const senderSchema = z
  .object({
    login: z.string().min(1).optional()
  })
  .passthrough()
  .optional();

const workflowRunPayloadSchema = z.object({
  action: z.string().min(1),
  repository: repositorySchema,
  sender: senderSchema,
  workflow_run: z
    .object({
      id: z.number().int().nonnegative(),
      workflow_id: z.number().int().nonnegative().optional(),
      run_attempt: z.number().int().positive().optional(),
      name: z.string().min(1).optional(),
      status: z.string().min(1).nullable().optional(),
      conclusion: z.string().min(1).nullable().optional(),
      head_branch: z.string().min(1).nullable().optional(),
      head_sha: z.string().min(1).nullable().optional(),
      event: z.string().min(1).optional(),
      html_url: z.string().url().optional(),
      created_at: z.string().datetime().optional(),
      run_started_at: z.string().datetime().nullable().optional(),
      updated_at: z.string().datetime().nullable().optional()
    })
    .passthrough()
})
  .passthrough();

const workflowJobPayloadSchema = z.object({
  action: z.string().min(1),
  repository: repositorySchema,
  sender: senderSchema,
  workflow_job: z
    .object({
      id: z.number().int().nonnegative(),
      run_id: z.number().int().nonnegative(),
      run_attempt: z.number().int().positive().optional(),
      workflow_name: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
      status: z.string().min(1).nullable().optional(),
      conclusion: z.string().min(1).nullable().optional(),
      head_branch: z.string().min(1).nullable().optional(),
      head_sha: z.string().min(1).nullable().optional(),
      html_url: z.string().url().optional(),
      created_at: z.string().datetime().optional(),
      started_at: z.string().datetime().nullable().optional(),
      completed_at: z.string().datetime().nullable().optional()
    })
    .passthrough()
})
  .passthrough();

const repositoryOnlySchema = z
  .object({
    repository: repositorySchema.optional()
  })
  .passthrough();

export type GitHubWebhookMapResult = {
  supported: boolean;
  repositoryFullName: string | null;
  events: IngestOperationalEventInput[];
  reason?: string;
};

function selectTimestamp(...candidates: Array<string | null | undefined>) {
  for (const value of candidates) {
    if (!value) {
      continue;
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}

function workflowRunEventType(action: string, status?: string | null, conclusion?: string | null) {
  const normalizedAction = action.toLowerCase();
  if (normalizedAction === "requested") {
    return "workflow_requested";
  }
  if (normalizedAction === "in_progress") {
    return "workflow_started";
  }
  if (normalizedAction === "completed") {
    const normalizedConclusion = (conclusion ?? "").toLowerCase();
    if (["failure", "cancelled", "timed_out", "startup_failure", "action_required", "stale"].includes(normalizedConclusion)) {
      return "workflow_failed";
    }

    return "workflow_completed";
  }

  if ((status ?? "").toLowerCase() === "in_progress") {
    return "workflow_started";
  }
  if ((status ?? "").toLowerCase() === "completed") {
    const normalizedConclusion = (conclusion ?? "").toLowerCase();
    if (["failure", "cancelled", "timed_out", "startup_failure", "action_required", "stale"].includes(normalizedConclusion)) {
      return "workflow_failed";
    }

    return "workflow_completed";
  }

  return null;
}

function workflowJobEventType(action: string, status?: string | null, conclusion?: string | null) {
  const normalizedAction = action.toLowerCase();
  if (normalizedAction === "queued") {
    return "job_queued";
  }
  if (normalizedAction === "in_progress") {
    return "job_started";
  }
  if (normalizedAction === "completed") {
    const normalizedConclusion = (conclusion ?? "").toLowerCase();
    if (["failure", "cancelled", "timed_out"].includes(normalizedConclusion)) {
      return "job_failed";
    }

    return "job_completed";
  }

  if ((status ?? "").toLowerCase() === "in_progress") {
    return "job_started";
  }
  if ((status ?? "").toLowerCase() === "completed") {
    const normalizedConclusion = (conclusion ?? "").toLowerCase();
    if (["failure", "cancelled", "timed_out"].includes(normalizedConclusion)) {
      return "job_failed";
    }

    return "job_completed";
  }

  return null;
}

function mapWorkflowRun(payload: unknown): GitHubWebhookMapResult {
  const parsed = workflowRunPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    const error = new Error("Invalid workflow_run webhook payload");
    error.name = "ValidationError";
    throw error;
  }

  const data = parsed.data;
  const eventType = workflowRunEventType(data.action, data.workflow_run.status, data.workflow_run.conclusion);
  if (!eventType) {
    return {
      supported: true,
      repositoryFullName: data.repository.full_name,
      events: [],
      reason: `ignored workflow_run action=${data.action}`
    };
  }

  return {
    supported: true,
    repositoryFullName: data.repository.full_name,
    events: [
      {
        source: "github_actions",
        event_type: eventType,
        service: data.repository.name ?? data.workflow_run.name ?? data.repository.full_name,
        system: data.repository.full_name,
        timestamp: selectTimestamp(
          data.workflow_run.updated_at,
          data.workflow_run.run_started_at,
          data.workflow_run.created_at
        ),
        severity:
          eventType === "workflow_failed"
            ? ["cancelled"].includes((data.workflow_run.conclusion ?? "").toLowerCase())
              ? "medium"
              : "high"
            : eventType === "workflow_completed"
              ? "low"
              : undefined,
        correlation_key: `${data.repository.full_name}:workflow_run:${data.workflow_run.id}`,
        metadata: {
          github_event: "workflow_run",
          action: data.action,
          repository_full_name: data.repository.full_name,
          workflow_name: data.workflow_run.name ?? null,
          workflow_id: data.workflow_run.workflow_id ?? null,
          run_id: data.workflow_run.id,
          run_attempt: data.workflow_run.run_attempt ?? 1,
          status: data.workflow_run.status ?? null,
          conclusion: data.workflow_run.conclusion ?? null,
          branch: data.workflow_run.head_branch ?? null,
          head_sha: data.workflow_run.head_sha ?? null,
          actor: data.sender?.login ?? null,
          html_url: data.workflow_run.html_url ?? null,
          trigger_event: data.workflow_run.event ?? null
        }
      }
    ]
  };
}

function mapWorkflowJob(payload: unknown): GitHubWebhookMapResult {
  const parsed = workflowJobPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    const error = new Error("Invalid workflow_job webhook payload");
    error.name = "ValidationError";
    throw error;
  }

  const data = parsed.data;
  const eventType = workflowJobEventType(data.action, data.workflow_job.status, data.workflow_job.conclusion);
  if (!eventType) {
    return {
      supported: true,
      repositoryFullName: data.repository.full_name,
      events: [],
      reason: `ignored workflow_job action=${data.action}`
    };
  }

  return {
    supported: true,
    repositoryFullName: data.repository.full_name,
    events: [
      {
        source: "github_actions",
        event_type: eventType,
        service: data.repository.name ?? data.workflow_job.name ?? data.repository.full_name,
        system: data.repository.full_name,
        timestamp: selectTimestamp(
          data.workflow_job.completed_at,
          data.workflow_job.started_at,
          data.workflow_job.created_at
        ),
        severity:
          eventType === "job_failed"
            ? ["cancelled"].includes((data.workflow_job.conclusion ?? "").toLowerCase())
              ? "medium"
              : "high"
            : eventType === "job_completed"
              ? "low"
              : undefined,
        correlation_key: `${data.repository.full_name}:workflow_job:${data.workflow_job.id}`,
        metadata: {
          github_event: "workflow_job",
          action: data.action,
          repository_full_name: data.repository.full_name,
          workflow_name: data.workflow_job.workflow_name ?? null,
          job_name: data.workflow_job.name ?? null,
          job_id: data.workflow_job.id,
          run_id: data.workflow_job.run_id,
          run_attempt: data.workflow_job.run_attempt ?? 1,
          status: data.workflow_job.status ?? null,
          conclusion: data.workflow_job.conclusion ?? null,
          branch: data.workflow_job.head_branch ?? null,
          head_sha: data.workflow_job.head_sha ?? null,
          actor: data.sender?.login ?? null,
          html_url: data.workflow_job.html_url ?? null
        }
      }
    ]
  };
}

export function extractGitHubRepositoryFullName(payload: unknown): string | null {
  const parsed = repositoryOnlySchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }

  return parsed.data.repository?.full_name ?? null;
}

export function mapGitHubWebhookToOperationalEvents(input: {
  eventType: string;
  payload: unknown;
}): GitHubWebhookMapResult {
  const normalized = input.eventType.trim().toLowerCase();
  if (normalized === "workflow_run") {
    return mapWorkflowRun(input.payload);
  }

  if (normalized === "workflow_job") {
    return mapWorkflowJob(input.payload);
  }

  return {
    supported: false,
    repositoryFullName: extractGitHubRepositoryFullName(input.payload),
    events: [],
    reason: `unsupported github event type: ${input.eventType}`
  };
}
