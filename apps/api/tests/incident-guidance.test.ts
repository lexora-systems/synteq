import { describe, expect, it } from "vitest";
import { generateIncidentGuidance } from "../src/services/incident-guidance-service.js";

function makeIncident(details: Record<string, unknown>, summary: string) {
  const now = new Date();
  return {
    id: "inc-1",
    tenant_id: "tenant-1",
    policy_id: "policy-1",
    workflow_id: "wf-1",
    environment: "prod",
    status: "open",
    severity: "high",
    started_at: now,
    last_seen_at: now,
    resolved_at: null,
    sla_due_at: now,
    sla_breached_at: null,
    fingerprint: "fp-1",
    summary,
    details_json: details,
    created_at: now
  } as any;
}

describe("incident guidance engine", () => {
  it("generates duplicate webhook guidance with expected actions and high confidence", async () => {
    const incident = makeIncident(
      {
        metric: "duplicate_rate",
        duplicate_rate: 0.22,
        observed: 0.22,
        baseline: 0.02,
        z_score: 4.8
      },
      "Duplicate rate spike"
    );

    const guidance = await generateIncidentGuidance({ incident });
    expect(guidance.incident_type).toBe("duplicate_webhook");
    expect(guidance.confidence).toBe("high");
    expect(guidance.likely_causes.join(" ")).toContain("idempotency");
    expect(guidance.recommended_actions.join(" ")).toContain("execution IDs");
  });

  it("generates retry storm guidance with expected actions and high confidence", async () => {
    const incident = makeIncident(
      {
        metric: "retry_rate",
        retry_rate: 0.38,
        failed: 42,
        total: 120,
        observed: 0.38,
        baseline: 0.07
      },
      "Retry storm detected"
    );

    const guidance = await generateIncidentGuidance({ incident });
    expect(guidance.incident_type).toBe("retry_storm");
    expect(guidance.confidence).toBe("high");
    expect(guidance.recommended_actions.join(" ")).toContain("exponential backoff");
  });

  it("uses unknown fallback safely when incident type is unclear", async () => {
    const incident = makeIncident({}, "Unclassified operational issue");
    const guidance = await generateIncidentGuidance({ incident });
    expect(guidance.incident_type).toBe("unknown");
    expect(guidance.confidence).toBe("low");
    expect(guidance.likely_causes[0]).toContain("Unable to determine");
    expect(guidance.recommended_actions.length).toBeGreaterThan(0);
  });
});
