import { describe, expect, it } from "vitest";
import { mapGitHubWebhookToOperationalEvents } from "../src/services/github-actions-adapter-service.js";

describe("github actions adapter service", () => {
  it("maps workflow_run completed failure into normalized workflow_failed event", () => {
    const result = mapGitHubWebhookToOperationalEvents({
      eventType: "workflow_run",
      payload: {
        action: "completed",
        repository: {
          full_name: "acme/payments",
          name: "payments"
        },
        sender: {
          login: "octocat"
        },
        workflow_run: {
          id: 101,
          workflow_id: 12,
          run_attempt: 2,
          name: "deploy",
          status: "completed",
          conclusion: "failure",
          head_branch: "main",
          head_sha: "abc123",
          html_url: "https://github.com/acme/payments/actions/runs/101",
          created_at: "2026-03-17T10:00:00Z",
          run_started_at: "2026-03-17T10:01:00Z",
          updated_at: "2026-03-17T10:02:00Z"
        }
      }
    });

    expect(result.supported).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      source: "github_actions",
      event_type: "workflow_failed",
      system: "acme/payments",
      service: "payments",
      correlation_key: "acme/payments:workflow_run:101",
      severity: "high"
    });
  });

  it("maps workflow_job in_progress into normalized job_started event", () => {
    const result = mapGitHubWebhookToOperationalEvents({
      eventType: "workflow_job",
      payload: {
        action: "in_progress",
        repository: {
          full_name: "acme/payments",
          name: "payments"
        },
        sender: {
          login: "octocat"
        },
        workflow_job: {
          id: 2001,
          run_id: 101,
          run_attempt: 1,
          workflow_name: "deploy",
          name: "build-and-test",
          status: "in_progress",
          conclusion: null,
          head_branch: "main",
          head_sha: "abc123",
          html_url: "https://github.com/acme/payments/actions/runs/101/job/2001",
          created_at: "2026-03-17T10:01:00Z",
          started_at: "2026-03-17T10:02:00Z"
        }
      }
    });

    expect(result.supported).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      source: "github_actions",
      event_type: "job_started",
      system: "acme/payments",
      service: "payments",
      correlation_key: "acme/payments:workflow_job:2001"
    });
  });

  it("returns no-op for unsupported github event types", () => {
    const result = mapGitHubWebhookToOperationalEvents({
      eventType: "issues",
      payload: {
        action: "opened",
        repository: {
          full_name: "acme/payments"
        }
      }
    });

    expect(result.supported).toBe(false);
    expect(result.events).toHaveLength(0);
    expect(result.reason).toContain("unsupported github event type");
  });
});
