"use client";

import { useActionState, useState } from "react";
import type { GitHubIntegrationRow } from "../../lib/api";

export type GitHubIntegrationsActionState = {
  ok: boolean;
  message: string | null;
  webhook_url: string;
  integrations: GitHubIntegrationRow[];
  latest_secret: string | null;
};

type ManageGitHubIntegrationsAction = (
  state: GitHubIntegrationsActionState,
  formData: FormData
) => Promise<GitHubIntegrationsActionState>;

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

export function GitHubIntegrationsManager({
  initialWebhookUrl,
  initialIntegrations,
  canManage,
  action
}: {
  initialWebhookUrl: string;
  initialIntegrations: GitHubIntegrationRow[];
  canManage: boolean;
  action: ManageGitHubIntegrationsAction;
}) {
  const [state, formAction, pending] = useActionState(action, {
    ok: true,
    message: null,
    webhook_url: initialWebhookUrl,
    integrations: initialIntegrations,
    latest_secret: null
  });
  const [copied, setCopied] = useState(false);

  return (
    <div className="grid gap-4">
      {state.message ? (
        <div
          className={`rounded-2xl px-4 py-3 text-sm shadow-panel ${
            state.ok ? "border border-emerald-300/70 bg-emerald-50/95 text-emerald-800" : "border border-amber-300/70 bg-amber-50/95 text-amber-800"
          }`}
          data-testid="github-feedback"
        >
          {state.message}
        </div>
      ) : null}

      <div className="rounded-2xl bg-white p-5 shadow-panel">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Manual setup</p>
        <h3 className="mt-1 text-lg font-semibold text-ink">GitHub webhook endpoint</h3>
        <p className="mt-2 text-sm text-slate-600">
          Minimal access required: Synteq consumes webhook event metadata only. No OAuth repository permissions or source-code access in this flow.
        </p>
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
          {state.webhook_url}
        </div>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>In GitHub, open your repository settings and navigate to Webhooks.</li>
          <li>Create a webhook with the endpoint above and content type set to JSON.</li>
          <li>Paste the generated secret from Synteq into GitHub webhook secret field.</li>
          <li>Enable event types used by Synteq today: workflow job and workflow run events.</li>
        </ol>
        <p className="mt-2 text-xs text-slate-500">
          This MVP is a manual webhook lifecycle. The webhook secret is only used to verify GitHub signatures.
        </p>
      </div>

      {state.latest_secret ? (
        <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 shadow-panel">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-700">Webhook secret</p>
          <p className="mt-1 text-sm text-slate-700">
            Save this secret now. Synteq only returns the raw value at create/rotate time.
          </p>
          <div className="mt-3 rounded-lg border border-cyan-200 bg-white px-3 py-2 font-mono text-sm text-ink" data-testid="github-secret-value">
            {state.latest_secret}
          </div>
          <div className="mt-3">
            <button
              type="button"
              className="rounded-lg border border-cyan-300 px-3 py-1.5 text-xs font-semibold text-cyan-800"
              data-testid="github-copy-secret"
              onClick={async () => {
                await navigator.clipboard.writeText(state.latest_secret ?? "");
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              Copy secret
            </button>
            {copied ? <span className="ml-2 text-xs text-cyan-800">Copied.</span> : null}
          </div>
        </div>
      ) : null}

      {canManage ? (
        <form action={formAction} className="rounded-2xl bg-white p-5 shadow-panel" data-testid="github-create-form">
          <input type="hidden" name="intent" value="create" />
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Create integration</p>
          <h3 className="mt-1 text-lg font-semibold text-ink">Register GitHub webhook integration</h3>
          <p className="mt-2 text-sm text-slate-600">
            Optional repository scope format: <code>owner/repo</code>. Leave empty to accept events from any repository for this webhook id.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
            <input
              name="repository_full_name"
              placeholder="acme/payments-service"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              data-testid="github-repository-input"
            />
            <button
              className="rounded-lg bg-ocean px-4 py-2 text-sm font-semibold text-white disabled:opacity-70"
              data-testid="github-create-submit"
              disabled={pending}
            >
              {pending ? "Creating..." : "Create integration"}
            </button>
          </div>
        </form>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-panel">
          Owner/admin role is required to create, rotate, or deactivate GitHub integrations.
        </div>
      )}

      <div className="rounded-2xl bg-white p-5 shadow-panel">
        <h3 className="text-lg font-semibold text-ink">Integrations</h3>
        <p className="mt-1 text-sm text-slate-600">Rotate secrets or deactivate anytime using the right-side actions.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2">Repository scope</th>
                <th className="py-2">Webhook id</th>
                <th className="py-2">Status</th>
                <th className="py-2">Last seen</th>
                <th className="py-2">Created</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.integrations.map((integration) => (
                <tr key={integration.id} className="border-b border-slate-100 align-top" data-testid={`github-row-${integration.id}`}>
                  <td className="py-3 pr-2 text-ink">{integration.repository_full_name ?? "Any repository"}</td>
                  <td className="py-3 pr-2 font-mono">{integration.webhook_id}</td>
                  <td className="py-3 pr-2">{integration.is_active ? "active" : "inactive"}</td>
                  <td className="py-3 pr-2">{formatTimestamp(integration.last_seen_at)}</td>
                  <td className="py-3 pr-2">{formatTimestamp(integration.created_at)}</td>
                  <td className="py-3 pr-2">
                    {canManage ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <form action={formAction}>
                          <input type="hidden" name="intent" value="rotate" />
                          <input type="hidden" name="id" value={integration.id} />
                          <button
                            className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:pointer-events-none disabled:opacity-50"
                            disabled={pending || !integration.is_active}
                          >
                            Rotate secret
                          </button>
                        </form>
                        <form action={formAction}>
                          <input type="hidden" name="intent" value="deactivate" />
                          <input type="hidden" name="id" value={integration.id} />
                          <button
                            className="rounded-lg border border-rose-300 px-2 py-1 text-xs text-rose-700 disabled:pointer-events-none disabled:opacity-50"
                            data-testid={`github-deactivate-${integration.id}`}
                            disabled={pending || !integration.is_active}
                          >
                            Deactivate
                          </button>
                        </form>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">Read only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
