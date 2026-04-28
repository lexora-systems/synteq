import { describe, expect, it } from "vitest";
import { ingestExecutionSchema, ingestOperationalEventsRequestSchema, ingestWorkflowEventSchema } from "@synteq/shared";

describe("ingestion validation", () => {
  it("accepts a valid execution payload", () => {
    const payload = {
      event_ts: new Date().toISOString(),
      tenant_id: "tenant_1",
      workflow_id: "workflow_1",
      environment: "prod",
      execution_id: "exec_1",
      status: "success",
      retry_count: 0
    };

    const parsed = ingestExecutionSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const payload = {
      event_ts: new Date().toISOString(),
      tenant_id: "tenant_1",
      workflow_id: "workflow_1",
      environment: "prod",
      execution_id: "exec_1",
      status: "ok",
      retry_count: 0
    };

    const parsed = ingestExecutionSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it("accepts normalized operational event envelopes", () => {
    const parsed = ingestOperationalEventsRequestSchema.safeParse({
      event: {
        source: "github_actions",
        event_type: "workflow_failed",
        service: "payments-api",
        timestamp: new Date().toISOString(),
        metadata: {
          repository: "acme/payments"
        }
      }
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.events).toHaveLength(1);
    }
  });

  it("accepts generic workflow event payload with source identity and timestamp", () => {
    const parsed = ingestWorkflowEventSchema.safeParse({
      source_type: "n8n",
      source_key: "n8n-orders-prod",
      workflow_id: "wf-orders-sync",
      workflow_name: "Orders Sync",
      status: "success",
      execution_id: "exec-001",
      timestamp: new Date().toISOString(),
      metadata: {
        template: "orders-sync-v1"
      }
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects generic workflow event payload missing source identity", () => {
    const parsed = ingestWorkflowEventSchema.safeParse({
      source_type: "webhook",
      workflow_id: "wf-orders-sync",
      workflow_name: "Orders Sync",
      status: "failed",
      execution_id: "exec-001",
      timestamp: new Date().toISOString()
    });

    expect(parsed.success).toBe(false);
  });
});
