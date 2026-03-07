import type {
  IncidentGuidanceNarrationInput as SharedIncidentGuidanceNarrationInput,
  IncidentNarrationResult as SharedIncidentNarrationResult,
  IncidentType
} from "@synteq/shared";

export type IncidentGuidanceNarrationInput = SharedIncidentGuidanceNarrationInput;
export type IncidentNarrationResult = SharedIncidentNarrationResult;

export interface IncidentNarrator {
  narrate(input: IncidentGuidanceNarrationInput): Promise<IncidentNarrationResult>;
}

function joinTop(items: string[], count = 2) {
  if (items.length === 0) {
    return "";
  }

  return items.slice(0, count).join(" and ");
}

export class TemplateIncidentNarrator implements IncidentNarrator {
  async narrate(input: IncidentGuidanceNarrationInput): Promise<IncidentNarrationResult> {
    const causes = joinTop(input.likely_causes);
    const actions = joinTop(input.recommended_actions);
    const workflowText = input.workflow_id ? ` for workflow ${input.workflow_id}` : "";

    const templates: Record<IncidentType, string> = {
      duplicate_webhook: `Duplicate webhook activity was detected${workflowText}. This likely indicates ${causes}. ${actions}.`,
      retry_storm: `A retry storm was detected${workflowText}. This likely indicates ${causes}. ${actions}.`,
      latency_spike: `Latency spiked${workflowText}. This likely indicates ${causes}. ${actions}.`,
      failure_rate_spike: `Failure rate increased sharply${workflowText}. This likely indicates ${causes}. ${actions}.`,
      missing_heartbeat: `Heartbeat signals are missing${workflowText}. This likely indicates ${causes}. ${actions}.`,
      cost_spike: `Workflow cost increased unexpectedly${workflowText}. This likely indicates ${causes}. ${actions}.`,
      unknown: `An incident was detected${workflowText}, but the dominant cause is unclear. ${actions}.`
    };

    return {
      summary_text: templates[input.incident_type],
      generated_by: "template_v1"
    };
  }
}

// Placeholder implementation for future AI narration integration.
export class AiIncidentNarrator implements IncidentNarrator {
  async narrate(input: IncidentGuidanceNarrationInput): Promise<IncidentNarrationResult> {
    const fallback = new TemplateIncidentNarrator();
    const result = await fallback.narrate(input);
    return {
      ...result,
      generated_by: "ai_stub_v1"
    };
  }
}
