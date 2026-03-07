import { describe, expect, it } from "vitest";
import { TemplateIncidentNarrator } from "../src/services/incident-guidance-narrator.js";

describe("incident summary template narrator", () => {
  it("produces non-empty summaries for major incident types", async () => {
    const narrator = new TemplateIncidentNarrator();
    const base = {
      likely_causes: ["upstream dependency degradation"],
      business_impact: "automation delays",
      recommended_actions: ["inspect downstream API health"],
      confidence: "medium" as const,
      evidence: ["metric=failure_rate"],
      workflow_id: "wf-1",
      environment: "prod"
    };

    const types = [
      "duplicate_webhook",
      "retry_storm",
      "latency_spike",
      "failure_rate_spike",
      "missing_heartbeat",
      "cost_spike",
      "unknown"
    ] as const;

    for (const type of types) {
      const narration = await narrator.narrate({
        ...base,
        incident_type: type
      });

      expect(narration.summary_text).toBeTruthy();
      expect(narration.summary_text.length).toBeGreaterThan(20);
    }
  });
});
