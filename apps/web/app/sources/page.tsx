import Link from "next/link";
import { TopNav } from "../../components/top-nav";
import { fetchConnectedSources } from "../../lib/api";
import { requireToken } from "../../lib/auth";

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function toLabel(type: "workflow" | "github_integration"): string {
  if (type === "workflow") {
    return "Workflow";
  }
  return "GitHub integration";
}

function accessModel(type: "workflow" | "github_integration"): string {
  if (type === "github_integration") {
    return "Webhook-based, event-based, read-only";
  }
  return "Signal-level event ingestion";
}

function signalSummary(type: "workflow" | "github_integration"): string {
  if (type === "github_integration") {
    return "Workflow run/job webhook events";
  }
  return "Execution status, retries, latency, heartbeat";
}

function riskSummary(type: "workflow" | "github_integration"): string {
  if (type === "github_integration") {
    return "Failed runs, retry storms, latency drift";
  }
  return "Failure spikes, missing heartbeats, latency/cost spikes";
}

export default async function ConnectedSourcesPage() {
  const token = await requireToken();
  const payload = await fetchConnectedSources(token);
  const hasSources = payload.sources.length > 0;
  const activeSources = payload.sources.filter((source) => source.status === "active");
  const hasActiveSources = activeSources.length > 0;
  const workflowCount = activeSources.filter((source) => source.type === "workflow").length;
  const githubCount = activeSources.filter((source) => source.type === "github_integration").length;
  const hasInactiveGitHubSources = payload.sources.some(
    (source) => source.type === "github_integration" && source.status !== "active"
  );
  const activeGitHubSources = activeSources.filter((source) => source.type === "github_integration");
  const verifiedGitHubSources = activeGitHubSources.filter((source) => Boolean(source.last_activity_at));
  const latestSourceSignalAt = activeSources.reduce<string | null>((latest, source) => {
    if (!source.last_activity_at) {
      return latest;
    }
    if (!latest) {
      return source.last_activity_at;
    }
    return new Date(source.last_activity_at).getTime() > new Date(latest).getTime() ? source.last_activity_at : latest;
  }, null);
  const latestGitHubSignalAt = activeGitHubSources.reduce<string | null>((latest, source) => {
    if (!source.last_activity_at) {
      return latest;
    }
    if (!latest) {
      return source.last_activity_at;
    }
    return new Date(source.last_activity_at).getTime() > new Date(latest).getTime() ? source.last_activity_at : latest;
  }, null);

  const sourceOperationalStatus =
    !hasSources
      ? "Waiting for first source connection"
      : !hasActiveSources
        ? "Sources configured but inactive"
      : activeGitHubSources.length > 0 && verifiedGitHubSources.length === 0
        ? "Waiting for webhook delivery"
        : latestSourceSignalAt
          ? "Connected and monitoring"
          : "Connected, waiting for first signal";

  const sourceOperationalMessage =
    !hasSources
      ? "Connect GitHub or another source to begin activation."
      : !hasActiveSources
        ? "Sources are configured but currently inactive. Synteq monitoring resumes when at least one source is active."
      : activeGitHubSources.length > 0 && verifiedGitHubSources.length === 0
        ? "GitHub integration is active, but no verified webhook delivery has been received yet."
        : latestSourceSignalAt
          ? "Synteq is ingesting signals. If incidents are empty, the environment may currently be quiet."
          : "Source is connected but no signal has been received yet. Trigger one run/event to validate ingestion.";

  return (
    <main className="min-h-screen syn-app-shell pb-12">
      <TopNav />
      <section className="mx-auto w-full max-w-6xl px-4 pt-8">
        <div className="rounded-2xl bg-white p-6 shadow-panel">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Connected Sources</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">Operational signal connectivity</h2>
          <p className="mt-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-slate-700">
            Immediate value: connected sources let Synteq continuously detect abnormal behavior and alert earlier.
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Connected sources are how Synteq continuously receives operational signals.
          </p>
          <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 md:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">What Synteq receives</p>
              <p className="mt-1">Operational signal metadata, source ownership context, and heartbeat activity used for risk detection.</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">What Synteq does NOT receive</p>
              <p className="mt-1">Source code, full execution logs, artifact contents, or customer secrets by default.</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Control</p>
              <p className="mt-1">Disconnect integrations, rotate/revoke credentials, and disable alerts anytime.</p>
            </div>
          </div>
        </div>

        {!hasActiveSources ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-panel">
            <p className="font-semibold text-ink">{hasSources ? "Sources configured but inactive" : "No active source connected yet"}</p>
            <p className="mt-1">
              {hasSources
                ? "Configured sources are currently inactive, so Synteq is not monitoring live signals right now."
                : "Connect and activate your first source to start live monitoring."}
            </p>
            <p className="mt-1">Synteq is continuously monitoring once active signal flow begins, and you&apos;ll be alerted when risk patterns are detected.</p>
            <div className="mt-3">
              <Link href="/settings/control-plane" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700">
                Open control plane
              </Link>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900 shadow-panel">
            <p className="font-semibold">Synteq is now watching {payload.sources.length} source{payload.sources.length === 1 ? "" : "s"}.</p>
            <p className="mt-1">
              Active signal coverage: {workflowCount} workflow source{workflowCount === 1 ? "" : "s"}, {githubCount} GitHub integration{githubCount === 1 ? "" : "s"}.
            </p>
            <p className="mt-1">
              You&apos;ll be alerted when failure spikes, retry storms, missing heartbeats, or latency-related risks are detected.
            </p>
          </div>
        )}

        <div className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50 p-5 text-sm text-slate-700 shadow-panel" data-testid="sources-operational-state">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-700">Source operational state</p>
          <h3 className="mt-1 text-lg font-semibold text-ink">{sourceOperationalStatus}</h3>
          <p className="mt-1">{sourceOperationalMessage}</p>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            <p>
              Integration status: <strong>{activeSources.length > 0 ? "Active source present" : "No active source"}</strong>
            </p>
            <p>
              Webhook verification: <strong>{verifiedGitHubSources.length > 0 ? "Verified" : githubCount > 0 ? "Pending" : hasInactiveGitHubSources ? "Inactive" : "Not configured"}</strong>
            </p>
            <p>
              Last source signal: <strong>{formatTimestamp(latestSourceSignalAt)}</strong>
            </p>
            <p>
              Last GitHub delivery: <strong>{formatTimestamp(latestGitHubSignalAt)}</strong>
            </p>
            <p>
              Repo scope: <strong>{githubCount > 0 ? "Configured" : hasInactiveGitHubSources ? "Configured (inactive)" : "Not configured"}</strong>
            </p>
            <p>
              Monitoring status: <strong>{latestSourceSignalAt ? "Live" : "Waiting for signal"}</strong>
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl bg-white p-4 shadow-panel">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Workflow sources</p>
            <p className="mt-2 text-2xl font-semibold text-ink">{payload.summary.workflow_sources}</p>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-panel">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">GitHub sources</p>
            <p className="mt-2 text-2xl font-semibold text-ink">{payload.summary.github_sources}</p>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-panel">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Ingestion keys</p>
            <p className="mt-2 text-2xl font-semibold text-ink">{payload.summary.ingestion_keys_active}</p>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-panel">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Alert channels</p>
            <p className="mt-2 text-2xl font-semibold text-ink">{payload.summary.alert_channels_ready}</p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-white p-5 shadow-panel">
          <h3 className="text-lg font-semibold text-ink">Source inventory</h3>
          <p className="mt-1 text-sm text-slate-600">
            Each source provides signals that power continuous risk detection.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[1180px] border-collapse text-sm" data-testid="connected-sources-table">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2">Name</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Access model</th>
                  <th className="py-2">Signals watched</th>
                  <th className="py-2">Risk patterns detected</th>
                  <th className="py-2">Last activity</th>
                  <th className="py-2">Connected</th>
                </tr>
              </thead>
              <tbody>
                {payload.sources.map((source) => (
                  <tr key={`${source.type}-${source.id}`} className="border-b border-slate-100 align-top">
                    <td className="py-3 pr-2 text-ink">{source.name}</td>
                    <td className="py-3 pr-2">{toLabel(source.type)}</td>
                    <td className="py-3 pr-2">{source.status}</td>
                    <td className="py-3 pr-2">{accessModel(source.type)}</td>
                    <td className="py-3 pr-2">{signalSummary(source.type)}</td>
                    <td className="py-3 pr-2">{riskSummary(source.type)}</td>
                    <td className="py-3 pr-2">{formatTimestamp(source.last_activity_at)}</td>
                    <td className="py-3 pr-2">{formatTimestamp(source.connected_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
