"use client";

import { useActionState, useEffect, useState } from "react";
import type { GitHubIntegrationRow } from "../../lib/api";

type GitHubSecretRevealKind = "created" | "rotated";

export type GitHubIntegrationsActionState = {
  ok: boolean;
  message: string | null;
  webhook_url: string;
  integrations: GitHubIntegrationRow[];
  latest_secret: string | null;
  latest_secret_kind: GitHubSecretRevealKind | null;
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

function toTimestampMs(value: string | null): number {
  if (!value) {
    return Number.NaN;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function GitHubIntegrationsManager({
  initialState,
  canManage,
  action
}: {
  initialState: GitHubIntegrationsActionState;
  canManage: boolean;
  action: ManageGitHubIntegrationsAction;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [copied, setCopied] = useState(false);
  const [copiedWebhookUrl, setCopiedWebhookUrl] = useState(false);
  const activeIntegrations = state.integrations.filter((integration) => integration.is_active);
  const verifiedIntegrations = activeIntegrations.filter(
    (integration) => Boolean(integration.last_seen_at || integration.last_delivery_id)
  );

  useEffect(() => {
    setCopied(false);
    setCopiedWebhookUrl(false);
  }, [state.latest_secret]);

  let latestDeliveryAt: string | null = null;
  let latestDeliveryAtMs = Number.NaN;
  let latestDeliveryId: string | null = null;

  for (const integration of activeIntegrations) {
    const seenAtMs = toTimestampMs(integration.last_seen_at);
    if (!Number.isNaN(seenAtMs) && (Number.isNaN(latestDeliveryAtMs) || seenAtMs > latestDeliveryAtMs)) {
      latestDeliveryAtMs = seenAtMs;
      latestDeliveryAt = integration.last_seen_at;
      latestDeliveryId = integration.last_delivery_id;
    }
  }

  if (!latestDeliveryId) {
    latestDeliveryId = activeIntegrations.find((integration) => Boolean(integration.last_delivery_id))?.last_delivery_id ?? null;
  }

  const operationalStatus =
    state.integrations.length === 0
      ? "No integration configured"
      : activeIntegrations.length === 0
        ? "Integration inactive"
        : verifiedIntegrations.length === 0
          ? "Waiting for webhook delivery"
          : "Connected and monitoring";

  const operationalMessage =
    state.integrations.length === 0
      ? "Create a GitHub integration to start webhook verification."
      : activeIntegrations.length === 0
        ? "Reactivate or create an integration so Synteq can receive deliveries."
        : verifiedIntegrations.length === 0
          ? "Webhook is configured, but Synteq has not received a verified delivery yet."
          : "Synteq is receiving verified webhook deliveries. If incidents are empty, the system may be quiet by design.";
  const rotateFailedWithoutSecret =
    !state.ok && !state.latest_secret && typeof state.message === "string" && /rotate|one-time webhook secret/i.test(state.message);

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

      <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 shadow-panel" data-testid="github-operational-state">
        <p className="text-xs uppercase tracking-[0.2em] text-cyan-700">Operational connection state</p>
        <h3 className="mt-1 text-lg font-semibold text-ink">{operationalStatus}</h3>
        <p className="mt-1 text-sm text-slate-700">{operationalMessage}</p>
        <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-3">
          <p>
            Active integrations: <strong>{activeIntegrations.length}</strong>
          </p>
          <p>
            Webhook verified: <strong>{verifiedIntegrations.length > 0 ? "Yes" : "No"}</strong>
          </p>
          <p>
            Last delivery: <strong>{formatTimestamp(latestDeliveryAt)}</strong>
          </p>
          <p>
            Last delivery id: <strong>{latestDeliveryId ?? "-"}</strong>
          </p>
          <p>
            Repo scope: <strong>{activeIntegrations.length > 0 ? "Configured" : "Not configured"}</strong>
          </p>
          <p>
            Monitoring status: <strong>{verifiedIntegrations.length > 0 ? "Live" : "Pending verification"}</strong>
          </p>
        </div>
      </div>

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

      <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 shadow-panel" data-testid="github-secret-panel">
        <p className="text-xs uppercase tracking-[0.2em] text-cyan-700">
          {state.latest_secret
            ? state.latest_secret_kind === "rotated"
              ? "Rotated webhook secret"
              : "New webhook secret"
            : "One-time webhook secret output"}
        </p>
        {state.latest_secret ? (
          <>
            <p className="mt-1 text-sm text-slate-700">
              Copy this secret now. For security reasons it may not be shown again.
            </p>
            <div
              className="mt-3 rounded-lg border border-cyan-200 bg-white px-3 py-2 font-mono text-xs text-slate-700"
              data-testid="github-secret-webhook-url"
            >
              {state.webhook_url}
            </div>
            <div className="mt-3 rounded-lg border border-cyan-200 bg-white px-3 py-2 font-mono text-sm text-ink" data-testid="github-secret-value">
              {state.latest_secret}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
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
              <button
                type="button"
                className="rounded-lg border border-cyan-300 px-3 py-1.5 text-xs font-semibold text-cyan-800"
                data-testid="github-copy-webhook-url"
                onClick={async () => {
                  await navigator.clipboard.writeText(state.webhook_url);
                  setCopiedWebhookUrl(true);
                  setTimeout(() => setCopiedWebhookUrl(false), 1200);
                }}
              >
                Copy webhook URL
              </button>
              {copied ? <span className="text-xs text-cyan-800">Secret copied.</span> : null}
              {copiedWebhookUrl ? <span className="text-xs text-cyan-800">Webhook URL copied.</span> : null}
            </div>
          </>
        ) : (
          <>
            {rotateFailedWithoutSecret ? (
              <p className="mt-1 text-sm text-rose-700" data-testid="github-secret-rotate-error">
                Rotation did not return a displayable one-time secret. Retry rotate and copy immediately when it appears.
              </p>
            ) : null}
            <p className="mt-1 text-sm text-slate-700" data-testid="github-secret-placeholder">
              After you create or rotate an integration secret, the one-time value will appear here with copy actions.
            </p>
          </>
        )}
      </div>

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
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-2">Repository scope</th>
                <th className="py-2">Webhook id</th>
                <th className="py-2">Status</th>
                <th className="py-2">Last delivery id</th>
                <th className="py-2">Last seen</th>
                <th className="py-2">Created</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.integrations.map((integration) => (
                <tr key={integration.id} className="border-b border-slate-100 align-top" data-testid={`github-row-${integration.id}`}>
                  <td className="py-3 pr-2 text-ink">{integration.repository_full_name ?? "Any repository"}</td>
                  <td className="py-3 pr-2 font-mono text-ink">{integration.webhook_id}</td>
                  <td className="py-3 pr-2 text-ink">{integration.is_active ? "active" : "inactive"}</td>
                  <td className="py-3 pr-2 font-mono text-xs text-ink">{integration.last_delivery_id ?? "-"}</td>
                  <td className="py-3 pr-2 text-ink">{formatTimestamp(integration.last_seen_at)}</td>
                  <td className="py-3 pr-2 text-ink">{formatTimestamp(integration.created_at)}</td>
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
