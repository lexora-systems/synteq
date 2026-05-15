import { describe, expect, it } from "vitest";
import {
  hasExplicitGoHighLevelProvider,
  normalizeGoHighLevelStatus,
  normalizeGoHighLevelWebhookPayload,
  type GoHighLevelWorkflowEventPayload
} from "../src/services/gohighlevel-adapter-service.js";

function normalize(payload: Record<string, unknown>, receivedAt = new Date("2026-05-14T10:00:00.000Z")) {
  return normalizeGoHighLevelWebhookPayload(payload, {
    receivedAt
  }) as GoHighLevelWorkflowEventPayload;
}

function expectSerializedToExclude(value: unknown, fragments: string[]) {
  const serialized = JSON.stringify(value);
  for (const fragment of fragments) {
    expect(serialized).not.toContain(fragment);
  }
}

describe("GoHighLevel adapter service", () => {
  it.each([
    ["success", "succeeded"],
    ["succeeded", "succeeded"],
    ["completed", "succeeded"],
    ["complete", "succeeded"],
    ["failed", "failed"],
    ["failure", "failed"],
    ["error", "failed"],
    ["timeout", "timed_out"],
    ["timed_out", "timed_out"],
    ["started", "started"],
    ["running", "started"],
    ["in_progress", "started"],
    ["pending", "started"],
    ["unrecognized", "started"]
  ] as const)("maps GHL status %s to %s", (input, expected) => {
    expect(normalizeGoHighLevelStatus(input)).toBe(expected);
  });

  it("detects only explicit GoHighLevel provider markers", () => {
    expect(
      hasExplicitGoHighLevelProvider({
        provider: "gohighlevel"
      })
    ).toBe(true);
    expect(
      hasExplicitGoHighLevelProvider({
        metadata: {
          provider: "ghl"
        }
      })
    ).toBe(true);
    expect(
      hasExplicitGoHighLevelProvider({
        contact: {
          email: "customer@example.invalid"
        }
      })
    ).toBe(false);
  });

  it("maps a completed GHL-style payload to the normalized workflow-event contract", () => {
    const normalized = normalize({
      provider: "gohighlevel",
      source_key: "webhook-ghl-production",
      eventType: "WorkflowCompleted",
      workflowId: "ghl-workflow-1",
      workflowName: "Lead Nurture",
      executionId: "ghl-exec-1",
      status: "completed",
      timestamp: "2026-05-14T09:58:00.000Z",
      locationId: "loc-1",
      opportunityId: "opp-1",
      pipelineId: "pipe-1"
    });

    expect(normalized).toMatchObject({
      source_type: "webhook",
      source_key: "webhook-ghl-production",
      workflow_id: "ghl-workflow-1",
      workflow_name: "Lead Nurture",
      execution_id: "ghl-exec-1",
      status: "succeeded",
      metadata: {
        provider: "gohighlevel",
        adapter_version: "ghl_webhook_v1",
        ghl_event_type: "WorkflowCompleted",
        location_id: "loc-1",
        workflow_id: "ghl-workflow-1",
        opportunity_id: "opp-1",
        pipeline_id: "pipe-1"
      }
    });
    expect(normalized.timestamp.toISOString()).toBe("2026-05-14T09:58:00.000Z");
  });

  it("maps failure, timeout, and running payloads conservatively", () => {
    expect(
      normalize({
        provider: "gohighlevel",
        source_key: "ghl",
        workflowId: "wf-failed",
        eventType: "WorkflowFailed",
        status: "error",
        timestamp: "2026-05-14T09:58:00.000Z",
        error_message: "Remote workflow failed"
      })
    ).toMatchObject({
      status: "failed",
      error_message: "Remote workflow failed"
    });
    expect(
      normalize({
        provider: "gohighlevel",
        source_key: "ghl",
        workflowId: "wf-timeout",
        eventType: "WorkflowTimeout",
        status: "timeout",
        timestamp: "2026-05-14T09:58:00.000Z"
      }).status
    ).toBe("timed_out");
    expect(
      normalize({
        provider: "gohighlevel",
        source_key: "ghl",
        workflowId: "wf-running",
        eventType: "WorkflowStarted",
        status: "pending",
        timestamp: "2026-05-14T09:58:00.000Z"
      }).status
    ).toBe("started");
  });

  it("generates a deterministic non-PII execution id when GHL lacks a delivery id", () => {
    const payload = {
      provider: "gohighlevel",
      source_key: "webhook-ghl-production",
      eventType: "OpportunityStatusChanged",
      workflowId: "opportunity-events",
      status: "completed",
      timestamp: "2026-05-14T09:58:00.000Z",
      opportunityId: "opp-1",
      pipelineId: "pipe-1",
      contact: {
        id: "contact-1",
        email: "customer@example.invalid"
      }
    };

    const first = normalize(payload);
    const second = normalize(payload, new Date("2026-05-14T10:05:00.000Z"));

    expect(first.execution_id).toMatch(/^ghl_[a-f0-9]{32}$/);
    expect(second.execution_id).toBe(first.execution_id);
    expect(first.execution_id).not.toContain("customer");
    expect(first.execution_id).not.toContain("contact-1");
  });

  it("keeps fallback execution ids stable when only receive time is available", () => {
    const payload = {
      provider: "gohighlevel",
      source_key: "webhook-ghl-production",
      eventType: "OpportunityStatusChanged",
      workflowId: "opportunity-events",
      status: "completed",
      opportunityId: "opp-1",
      pipelineId: "pipe-1"
    };

    const first = normalize(payload, new Date("2026-05-14T10:00:00.000Z"));
    const second = normalize(payload, new Date("2026-05-14T10:05:00.000Z"));

    expect(first.execution_id).toBe(second.execution_id);
    expect(first.timestamp.toISOString()).toBe("2026-05-14T10:00:00.000Z");
    expect(second.timestamp.toISOString()).toBe("2026-05-14T10:05:00.000Z");
  });

  it("does not infer Synteq source identity from GHL CRM object fields", () => {
    const normalized = normalize({
      provider: "gohighlevel",
      eventType: "ContactUpdated",
      status: "completed",
      locationId: "loc-1",
      contact: {
        id: "contact-1"
      }
    });

    expect(normalized.source_id).toBeUndefined();
    expect(normalized.source_key).toBeUndefined();
    expect(normalized.metadata).toMatchObject({
      location_id: "loc-1",
      object_type: "contact",
      object_id: "contact-1"
    });
  });

  it("keeps only privacy-safe operational metadata", () => {
    const normalized = normalize({
      provider: "gohighlevel",
      source_key: "webhook-ghl-production",
      eventType: "ContactUpdated",
      workflowId: "contact-events",
      status: "completed",
      timestamp: "2026-05-14T09:58:00.000Z",
      objectType: "contact",
      contact: {
        id: "contact-1",
        name: "Ada Lovelace",
        email: "ada@example.invalid",
        phone: "+1 555 111 2222",
        address: "1 Main St"
      },
      notes: "VIP customer note",
      raw_payload: {
        token: "secret-token"
      },
      metadata: {
        provider: "gohighlevel",
        email: "ada@example.invalid",
        phone: "+1 555 111 2222",
        full_name: "Ada Lovelace",
        notes: "private note",
        token: "secret"
      }
    });

    expect(normalized.metadata).toMatchObject({
      provider: "gohighlevel",
      object_type: "contact",
      object_id: "contact-1"
    });

    expectSerializedToExclude(normalized, [
      "ada@example.invalid",
      "+1 555",
      "Ada Lovelace",
      "VIP customer note",
      "secret-token",
      "raw_payload"
    ]);
  });

  // Official GoHighLevel payload samples are not currently committed; add official fixtures here once available.
  describe("representative non-official GHL payload fixtures", () => {
    it("normalizes the onboarding safe sample payload", () => {
      const normalized = normalize({
        provider: "gohighlevel",
        source_key: "webhook-ghl-production",
        workflowId: "ghl_workflow_123",
        workflowName: "Lead follow-up automation",
        eventType: "workflow.action.completed",
        status: "completed",
        deliveryId: "ghl_delivery_123",
        timestamp: "2026-01-01T10:00:00.000Z",
        locationId: "ghl_location_123",
        actionId: "ghl_action_123",
        objectType: "opportunity",
        objectId: "opp_123",
        pipelineId: "pipeline_123",
        opportunityId: "opp_123"
      });

      expect(normalized).toMatchObject({
        source_type: "webhook",
        source_key: "webhook-ghl-production",
        workflow_id: "ghl_workflow_123",
        workflow_name: "Lead follow-up automation",
        execution_id: "ghl_delivery_123",
        status: "succeeded",
        metadata: {
          provider: "gohighlevel",
          adapter_version: "ghl_webhook_v1",
          ghl_event_type: "workflow.action.completed",
          location_id: "ghl_location_123",
          action_id: "ghl_action_123",
          object_type: "opportunity",
          object_id: "opp_123",
          pipeline_id: "pipeline_123",
          opportunity_id: "opp_123",
          delivery_id: "ghl_delivery_123"
        }
      });
      expect(normalized.timestamp.toISOString()).toBe("2026-01-01T10:00:00.000Z");
      expectSerializedToExclude(normalized, ["email", "phone", "notes", "raw_payload"]);
    });

    it("normalizes a workflow action webhook shape", () => {
      const normalized = normalize({
        metadata: {
          provider: "gohighlevel",
          source_key: "webhook-ghl-production"
        },
        type: "WorkflowAction",
        workflow: {
          id: "wf-123",
          name: "Lead Routing"
        },
        action: {
          id: "act-456",
          name: "Assign Owner"
        },
        eventId: "evt-789",
        result: "success",
        createdAt: "2026-05-14T09:58:00.000Z",
        location: {
          id: "loc-1"
        }
      });

      expect(normalized).toMatchObject({
        source_type: "webhook",
        source_key: "webhook-ghl-production",
        workflow_id: "wf-123",
        workflow_name: "Lead Routing",
        execution_id: "evt-789",
        status: "succeeded",
        metadata: {
          provider: "gohighlevel",
          adapter_version: "ghl_webhook_v1",
          ghl_event_type: "WorkflowAction",
          action_id: "act-456",
          location_id: "loc-1",
          delivery_id: "evt-789"
        }
      });
    });

    it("normalizes contact payloads without storing contact details", () => {
      const normalized = normalize({
        provider: "gohighlevel",
        source_key: "webhook-ghl-production",
        type: "ContactCreate",
        status: "unknown-provider-status",
        contact: {
          id: "contact-1",
          firstName: "Ada",
          lastName: "Lovelace",
          email: "ada@example.invalid",
          phone: "+1 555 111 2222",
          address1: "1 Main St"
        },
        customFields: {
          favorite_product: "private value"
        },
        message: {
          body: "private message body"
        }
      });

      expect(normalized).toMatchObject({
        workflow_name: "GoHighLevel Webhook",
        status: "started",
        metadata: {
          provider: "gohighlevel",
          ghl_event_type: "ContactCreate",
          object_type: "contact",
          object_id: "contact-1"
        }
      });
      expect(normalized.workflow_id).toMatch(/^ghl_[a-f0-9]{32}$/);
      expect(normalized.execution_id).toMatch(/^ghl_[a-f0-9]{32}$/);
      expectSerializedToExclude(normalized, [
        "Ada",
        "Lovelace",
        "ada@example.invalid",
        "+1 555",
        "1 Main St",
        "private value",
        "private message body"
      ]);
    });

    it("normalizes opportunity and pipeline payloads", () => {
      const normalized = normalize({
        metadata: {
          provider: "gohighlevel",
          sourceKey: "webhook-ghl-production"
        },
        eventType: "OpportunityUpdated",
        state: "failure",
        updatedAt: "2026-05-14T09:58:00.000Z",
        opportunity: {
          id: "opp-1"
        },
        pipeline: {
          id: "pipe-1"
        },
        failureReason: "Automation step failed"
      });

      expect(normalized).toMatchObject({
        source_key: "webhook-ghl-production",
        status: "failed",
        error_message: "Automation step failed",
        metadata: {
          provider: "gohighlevel",
          ghl_event_type: "OpportunityUpdated",
          object_type: "opportunity",
          object_id: "opp-1",
          opportunity_id: "opp-1",
          pipeline_id: "pipe-1"
        }
      });
      expect(normalized.timestamp.toISOString()).toBe("2026-05-14T09:58:00.000Z");
    });

    it("normalizes calendar and appointment payloads", () => {
      const normalized = normalize({
        provider: "gohighlevel",
        source_key: "webhook-ghl-production",
        event_type: "AppointmentUpdated",
        status: "complete",
        appointment: {
          id: "appt-1"
        },
        calendar: {
          id: "cal-1"
        }
      });

      expect(normalized).toMatchObject({
        status: "succeeded",
        metadata: {
          provider: "gohighlevel",
          ghl_event_type: "AppointmentUpdated",
          object_type: "appointment",
          object_id: "appt-1",
          appointment_id: "appt-1",
          calendar_id: "cal-1"
        }
      });
    });

    it("handles malformed but plausible large CRM payloads with safe fallbacks", () => {
      const normalized = normalize({
        provider: "gohighlevel",
        source_key: "webhook-ghl-production",
        status: "not-a-synteq-status",
        contact: {
          name: "Ada Lovelace",
          email: "ada@example.invalid",
          phone: "+1 555 111 2222"
        },
        notes: "private note",
        headers: {
          authorization: "Bearer secret-token"
        },
        metadata: {
          provider: "gohighlevel",
          raw_payload: "x".repeat(20_000),
          api_key: "secret-api-key"
        }
      });

      expect(normalized).toMatchObject({
        source_type: "webhook",
        source_key: "webhook-ghl-production",
        workflow_name: "GoHighLevel Webhook",
        status: "started",
        metadata: {
          provider: "gohighlevel",
          adapter_version: "ghl_webhook_v1",
          status_source: "not-a-synteq-status"
        }
      });
      expect(normalized.workflow_id).toMatch(/^ghl_[a-f0-9]{32}$/);
      expect(normalized.execution_id).toMatch(/^ghl_[a-f0-9]{32}$/);
      expect(normalized.timestamp.toISOString()).toBe("2026-05-14T10:00:00.000Z");
      expectSerializedToExclude(normalized, [
        "Ada Lovelace",
        "ada@example.invalid",
        "+1 555",
        "private note",
        "secret-token",
        "secret-api-key",
        "raw_payload",
        "authorization"
      ]);
    });
  });
});
