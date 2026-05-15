"use client";

import { useActionState, useMemo, useState } from "react";
import type {
  GenericWorkflowSourceSetup,
  GenericWorkflowSourceType,
  ManualSilentCheckResponse,
  WorkflowSourceTestEventResponse,
  WorkflowSourceTestStatus
} from "../lib/api";

type CreatedWorkflowSourceSetup = GenericWorkflowSourceSetup & {
  ingestion_key: string;
};

export type GenericWorkflowSourceOnboardingState = {
  ok: boolean;
  message: string | null;
  latest_source: CreatedWorkflowSourceSetup | null;
  last_test: WorkflowSourceTestEventResponse | null;
  last_silent_check: ManualSilentCheckResponse | null;
};

type GenericWorkflowSourceAction = (
  state: GenericWorkflowSourceOnboardingState,
  formData: FormData
) => Promise<GenericWorkflowSourceOnboardingState>;

const SOURCE_TYPE_OPTIONS: Array<{ value: GenericWorkflowSourceType; label: string }> = [
  { value: "webhook", label: "Webhook" },
  { value: "n8n", label: "n8n" },
  { value: "make", label: "Make" },
  { value: "zapier", label: "Zapier" }
];

const TEST_STATUSES: Array<{ value: WorkflowSourceTestStatus; label: string }> = [
  { value: "succeeded", label: "Send test success event" },
  { value: "failed", label: "Send test failure event" },
  { value: "timed_out", label: "Send test timeout event" }
];

function goHighLevelSamplePayload(sourceKey = "<your_source_key>") {
  return {
    provider: "gohighlevel",
    source_key: sourceKey,
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
  };
}

function sourceTypeLabel(value: string) {
  return SOURCE_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function silentCheckResultClasses(status: ManualSilentCheckResponse["status"]) {
  if (status === "ok") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }

  if (status === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  return "border-rose-200 bg-rose-50 text-rose-900";
}

export function GenericWorkflowSourceOnboarding({
  canManage,
  action
}: {
  canManage: boolean;
  action: GenericWorkflowSourceAction;
}) {
  const [state, formAction, pending] = useActionState(action, {
    ok: true,
    message: null,
    latest_source: null,
    last_test: null,
    last_silent_check: null
  });
  const [copiedTarget, setCopiedTarget] = useState<string | null>(null);
  const latestSource = state.latest_source;
  const examplePayload = useMemo(() => {
    if (!latestSource) {
      return "";
    }

    return JSON.stringify(
      {
        source_type: latestSource.source_type,
        source_id: latestSource.id,
        workflow_id: "customer-onboarding",
        workflow_name: "Customer Onboarding",
        execution_id: "exec_12345",
        status: "succeeded",
        started_at: "2026-04-28T10:00:00.000Z",
        finished_at: "2026-04-28T10:01:05.000Z",
        duration_ms: 65000,
        environment: latestSource.environment,
        metadata: {
          platform: latestSource.source_type,
          example: true
        }
      },
      null,
      2
    );
  }, [latestSource]);
  const goHighLevelPayload = useMemo(
    () => JSON.stringify(goHighLevelSamplePayload(latestSource?.source_key), null, 2),
    [latestSource?.source_key]
  );

  async function copyText(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedTarget(label);
    setTimeout(() => setCopiedTarget(null), 1200);
  }

  return (
    <div className="grid gap-4">
      {state.message ? (
        <div
          className={`rounded-2xl px-4 py-3 text-sm shadow-panel ${
            state.ok ? "border border-emerald-300/70 bg-emerald-50/95 text-emerald-800" : "border border-amber-300/70 bg-amber-50/95 text-amber-800"
          }`}
          data-testid="generic-workflow-source-feedback"
        >
          {state.message}
        </div>
      ) : null}

      {canManage ? (
        <form action={formAction} className="rounded-2xl bg-white p-5 shadow-panel" data-testid="generic-workflow-source-create-form">
          <input type="hidden" name="intent" value="create" />
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Generic workflow source</p>
          <h3 className="mt-1 text-lg font-semibold text-ink">Create workflow event source</h3>
          <p className="mt-2 text-sm text-slate-600">
            Use this with any automation tool that can send HTTP requests.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            GoHighLevel Phase 1 uses the Webhook source type with <code>provider: "gohighlevel"</code>. Send workflow
            execution signals, not customer records.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_160px_150px_auto]">
            <input
              name="display_name"
              required
              minLength={2}
              maxLength={191}
              placeholder="Customer Onboarding"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              data-testid="generic-source-name-input"
            />
            <select
              name="source_type"
              defaultValue="webhook"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              data-testid="generic-source-type-select"
            >
              {SOURCE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              name="environment"
              defaultValue="production"
              maxLength={64}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              data-testid="generic-source-environment-input"
            />
            <button
              className="rounded-lg bg-ocean px-4 py-2 text-sm font-semibold text-white disabled:opacity-70"
              data-testid="generic-source-create-submit"
              disabled={pending}
            >
              {pending ? "Creating..." : "Create source"}
            </button>
          </div>
        </form>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-panel">
          Owner/admin role is required to create workflow sources and display one-time ingestion keys.
        </div>
      )}

      <div
        className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-panel"
        data-testid="gohighlevel-webhook-guidance"
      >
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">GoHighLevel outbound webhook</p>
        <h3 className="mt-1 text-lg font-semibold text-ink">Use the generic Webhook source</h3>
        <p className="mt-2">
          GoHighLevel is supported through outbound webhooks. The Synteq source type remains <code>webhook</code>; include{" "}
          <code>provider: "gohighlevel"</code> or <code>metadata.provider: "gohighlevel"</code> in the JSON body.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Required headers</p>
            <p className="mt-2 font-mono text-xs text-ink">X-Synteq-Key: &lt;your_ingestion_key&gt;</p>
            <p className="mt-1 font-mono text-xs text-ink">Content-Type: application/json</p>
            <p className="mt-2 text-xs text-slate-500">
              Advanced: if your production environment enforces ingest HMAC, also send <code>X-Synteq-Timestamp</code>{" "}
              and <code>X-Synteq-Signature</code> using the configured ingest HMAC secret.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Privacy boundary</p>
            <p className="mt-2">
              Send workflow execution signals, not customer records. Avoid forwarding names, emails, phone numbers, notes,
              message bodies, or full CRM payloads.
            </p>
            <p className="mt-2 font-semibold text-ink">Designed to monitor systems - not access them.</p>
          </div>
        </div>
      </div>

      <div
        className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-panel"
        data-testid="synthetic-readiness-note"
      >
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Validation mode</p>
        <p className="mt-2">
          Run silent check validates source readiness without writing operational records. Manual test events validate the real ingestion path
          and are not scheduled synthetic monitors.
        </p>
        <p className="mt-1">
          Failed or timed-out test events use the real ingestion path and may create incidents or alert behavior. Use them intentionally
          while setting up or validating a source.
        </p>
      </div>

      {latestSource ? (
        <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-5 shadow-panel" data-testid="generic-source-setup-card">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-700">Setup</p>
          <h3 className="mt-1 text-lg font-semibold text-ink">{latestSource.display_name}</h3>
          <p className="mt-1 text-sm text-slate-700">
            {sourceTypeLabel(latestSource.source_type)} source created. Copy the ingestion key now; Synteq only shows the raw key once.
          </p>

          <div className="mt-4 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-700">Endpoint</p>
              <div className="mt-1 rounded-lg border border-cyan-200 bg-white px-3 py-2 font-mono text-xs text-ink break-all">
                {latestSource.ingest_endpoint_url}
              </div>
              <button
                type="button"
                className="mt-2 rounded-lg border border-cyan-300 px-3 py-1.5 text-xs font-semibold text-cyan-800"
                onClick={() => copyText("endpoint", latestSource.ingest_endpoint_url)}
              >
                Copy endpoint
              </button>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-700">Ingestion key</p>
              <div className="mt-1 rounded-lg border border-cyan-200 bg-white px-3 py-2 font-mono text-xs text-ink break-all">
                {latestSource.ingestion_key}
              </div>
              <button
                type="button"
                className="mt-2 rounded-lg border border-cyan-300 px-3 py-1.5 text-xs font-semibold text-cyan-800"
                onClick={() => copyText("key", latestSource.ingestion_key)}
              >
                Copy key
              </button>
            </div>
            <div>
              <p>
                Source id: <code>{latestSource.id}</code>
              </p>
              <p className="mt-1">
                Source key: <code>{latestSource.source_key}</code>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-cyan-300 px-3 py-1.5 text-xs font-semibold text-cyan-800"
                  onClick={() => copyText("source id", latestSource.id)}
                >
                  Copy source id
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-cyan-300 px-3 py-1.5 text-xs font-semibold text-cyan-800"
                  onClick={() => copyText("source key", latestSource.source_key)}
                >
                  Copy source key
                </button>
              </div>
            </div>
            <div>
              <p>
                Header: <code>X-Synteq-Key</code>
              </p>
              <p className="mt-1">
                Path: <code>{latestSource.ingest_endpoint_path}</code>
              </p>
            </div>
          </div>
          {copiedTarget ? <p className="mt-2 text-xs text-cyan-800">Copied {copiedTarget}.</p> : null}

          <div className="mt-4">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-700">Example JSON payload</p>
            <pre className="mt-2 max-h-[360px] overflow-auto rounded-lg border border-cyan-200 bg-white p-3 text-xs text-slate-800">
              {examplePayload}
            </pre>
            <button
              type="button"
              className="mt-2 rounded-lg border border-cyan-300 px-3 py-1.5 text-xs font-semibold text-cyan-800"
              onClick={() => copyText("payload", examplePayload)}
            >
              Copy payload
            </button>
          </div>

          {latestSource.source_type === "webhook" ? (
            <div className="mt-4" data-testid="gohighlevel-sample-section">
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-700">GoHighLevel safe sample JSON</p>
              <p className="mt-1 text-xs text-slate-600">
                Send workflow execution signals, not customer records. Avoid forwarding names, emails, phone numbers, notes,
                message bodies, or full CRM payloads.
              </p>
              <pre
                className="mt-2 max-h-[360px] overflow-auto rounded-lg border border-cyan-200 bg-white p-3 text-xs text-slate-800"
                data-testid="gohighlevel-sample-payload"
              >
                {goHighLevelPayload}
              </pre>
              <button
                type="button"
                className="mt-2 rounded-lg border border-cyan-300 px-3 py-1.5 text-xs font-semibold text-cyan-800"
                onClick={() => copyText("GoHighLevel payload", goHighLevelPayload)}
              >
                Copy GoHighLevel payload
              </button>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <form action={formAction}>
              <input type="hidden" name="intent" value="silent_check" />
              <input type="hidden" name="source_id" value={latestSource.id} />
              <button
                className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 disabled:opacity-70"
                disabled={pending}
                data-testid="generic-source-silent-check-submit"
              >
                {pending ? "Running silent check..." : "Run silent check"}
              </button>
            </form>
            {TEST_STATUSES.map((status) => (
              <form key={status.value} action={formAction}>
                <input type="hidden" name="intent" value="test" />
                <input type="hidden" name="source_id" value={latestSource.id} />
                <input type="hidden" name="status" value={status.value} />
                <button
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-70"
                  disabled={pending}
                >
                  {status.label}
                </button>
              </form>
            ))}
          </div>

          <p className="mt-2 text-xs text-slate-600">
            Run silent check is dry-run validation only. Send test event uses the live ingestion lifecycle and may create operational signals.
          </p>

          {state.last_silent_check ? (
            <div
              className={`mt-4 rounded-lg border px-3 py-2 text-sm ${silentCheckResultClasses(state.last_silent_check.status)}`}
              data-testid="generic-source-silent-check-result"
            >
              <p className="font-semibold">
                Silent check {state.last_silent_check.status}. No operational writes were performed.
              </p>
              <p className="mt-1 text-xs">
                Checked at {new Date(state.last_silent_check.checkedAt).toLocaleString()} in {state.last_silent_check.mode} mode.
              </p>
              <ul className="mt-2 grid gap-1 text-xs">
                {state.last_silent_check.checks.map((check) => (
                  <li key={check.key}>
                    <strong>{check.status}</strong> {check.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {state.last_test ? (
            <div className="mt-4 rounded-lg border border-cyan-200 bg-white px-3 py-2 text-sm text-slate-700" data-testid="generic-source-test-result">
              <p className="font-semibold text-ink">{state.last_test.message}</p>
              <p className="mt-1">
                Ingested: <strong>{state.last_test.ingest.ingested}</strong>, duplicates:{" "}
                <strong>{state.last_test.ingest.duplicates}</strong>, failed:{" "}
                <strong>{state.last_test.ingest.failed}</strong>
              </p>
              <p className="mt-1 font-mono text-xs">Execution: {state.last_test.event.execution_id}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
