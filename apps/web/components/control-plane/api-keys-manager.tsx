"use client";

import { useActionState, useState } from "react";
import type { ApiKeyRow } from "../../lib/api";

export type ApiKeysActionState = {
  ok: boolean;
  message: string | null;
  api_keys: ApiKeyRow[];
  latest_secret: string | null;
  latest_secret_name: string | null;
};

type ManageApiKeysAction = (state: ApiKeysActionState, formData: FormData) => Promise<ApiKeysActionState>;

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

export function ApiKeysManager({
  initialApiKeys,
  canManage,
  action
}: {
  initialApiKeys: ApiKeyRow[];
  canManage: boolean;
  action: ManageApiKeysAction;
}) {
  const [state, formAction, pending] = useActionState(action, {
    ok: true,
    message: null,
    api_keys: initialApiKeys,
    latest_secret: null,
    latest_secret_name: null
  });
  const [copied, setCopied] = useState(false);

  return (
    <div className="grid gap-4">
      {state.message ? (
        <div
          className={`rounded-2xl px-4 py-3 text-sm shadow-panel ${
            state.ok ? "border border-emerald-300/70 bg-emerald-50/95 text-emerald-800" : "border border-amber-300/70 bg-amber-50/95 text-amber-800"
          }`}
          data-testid="api-keys-feedback"
        >
          {state.message}
        </div>
      ) : null}

      {state.latest_secret ? (
        <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 shadow-panel">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-700">New Ingestion Key</p>
          <p className="mt-1 text-sm text-slate-700">
            Save this key now. For security, Synteq only shows the raw secret once.
          </p>
          <div className="mt-3 rounded-lg border border-cyan-200 bg-white px-3 py-2 font-mono text-sm text-ink" data-testid="api-key-secret-value">
            {state.latest_secret}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-cyan-300 px-3 py-1.5 text-xs font-semibold text-cyan-800"
              data-testid="api-key-copy-secret"
              onClick={async () => {
                await navigator.clipboard.writeText(state.latest_secret ?? "");
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              Copy key
            </button>
            {copied ? <span className="text-xs text-cyan-800">Copied.</span> : null}
          </div>
        </div>
      ) : null}

      {canManage ? (
        <form action={formAction} className="rounded-2xl bg-white p-5 shadow-panel" data-testid="api-keys-create-form">
          <input type="hidden" name="intent" value="create" />
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Create key</p>
          <h3 className="mt-1 text-lg font-semibold text-ink">Add ingestion API key</h3>
          <p className="mt-2 text-sm text-slate-600">
            Use this key in your pipeline/webhook sender via <code>x-synteq-key</code> to stream execution, heartbeat, and operational event signals.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              name="name"
              required
              minLength={2}
              maxLength={191}
              placeholder="CI Pipeline Ingest Key"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              data-testid="api-key-name-input"
            />
            <button
              className="rounded-lg bg-ocean px-4 py-2 text-sm font-semibold text-white disabled:opacity-70"
              data-testid="api-key-create-submit"
              disabled={pending}
            >
              {pending ? "Creating..." : "Create key"}
            </button>
          </div>
        </form>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-panel">
          Owner/admin role is required to create, rotate, or revoke API keys.
        </div>
      )}

      <div className="rounded-2xl bg-white p-5 shadow-panel">
        <h3 className="text-lg font-semibold text-ink">Existing keys</h3>
        <p className="mt-1 text-sm text-slate-600">Rotate or revoke anytime using the right-side actions.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2">Label</th>
                <th className="py-2">Key preview</th>
                <th className="py-2">Created</th>
                <th className="py-2">Last used</th>
                <th className="py-2">Status</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.api_keys.map((apiKey) => {
                const revoked = Boolean(apiKey.revoked_at);
                return (
                  <tr key={apiKey.id} className="border-b border-slate-100 align-top" data-testid={`api-key-row-${apiKey.id}`}>
                    <td className="py-3 pr-2 text-ink">{apiKey.name}</td>
                    <td className="py-3 pr-2 font-mono">{apiKey.key_preview}</td>
                    <td className="py-3 pr-2">{formatTimestamp(apiKey.created_at)}</td>
                    <td className="py-3 pr-2">{formatTimestamp(apiKey.last_used_at)}</td>
                    <td className="py-3 pr-2">{revoked ? "revoked" : "active"}</td>
                    <td className="py-3 pr-2">
                      {canManage ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <form action={formAction}>
                            <input type="hidden" name="intent" value="rotate" />
                            <input type="hidden" name="id" value={apiKey.id} />
                            <button
                              className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:pointer-events-none disabled:opacity-50"
                              disabled={pending || revoked}
                            >
                              Rotate
                            </button>
                          </form>
                          <form action={formAction}>
                            <input type="hidden" name="intent" value="revoke" />
                            <input type="hidden" name="id" value={apiKey.id} />
                            <button
                              className="rounded-lg border border-rose-300 px-2 py-1 text-xs text-rose-700 disabled:pointer-events-none disabled:opacity-50"
                              data-testid={`api-key-revoke-${apiKey.id}`}
                              disabled={pending || revoked}
                            >
                              Revoke
                            </button>
                          </form>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">Read only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
