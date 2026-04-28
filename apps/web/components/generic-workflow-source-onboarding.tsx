"use client";

import { useActionState, useMemo, useState } from "react";
import type {
  GenericWorkflowSourceSetup,
  GenericWorkflowSourceType,
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

function sourceTypeLabel(value: string) {
  return SOURCE_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
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
    last_test: null
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

          <div className="mt-4 flex flex-wrap gap-2">
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
