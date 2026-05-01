import Link from "next/link";
import { TopNav } from "../../components/top-nav";
import { ReliabilityTools } from "../../components/reliability-tools";
import {
  fetchConnectedSources,
  fetchGitHubIntegrations,
  fetchOperationalDashboard,
  fetchReliabilityWindows,
  fetchTenantSettings,
  fetchWorkflows,
  type OperationalDashboard,
  type OperationalFreshnessState,
  type OperationalHealthState,
  type ReliabilityWindows
} from "../../lib/api";
import { deriveActivationJourney } from "../../lib/activation";
import { requireToken } from "../../lib/auth";

function formatState(value: string): string {
  return value
    .replace(/_/g, " ")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "No signal";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatRate(value: number | null): string {
  if (value === null) {
    return "No signal";
  }
  return `${(value * 100).toFixed(value === 0 || value === 1 ? 0 : 1)}%`;
}

function healthBadgeClass(state: OperationalHealthState | OperationalFreshnessState): string {
  if (state === "healthy" || state === "fresh") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (state === "degraded" || state === "stale") {
    return "bg-amber-100 text-amber-800";
  }
  if (state === "failing") {
    return "bg-rose-100 text-rose-700";
  }
  return "bg-slate-100 text-slate-700";
}

function StateBadge({ state }: { state: OperationalHealthState | OperationalFreshnessState }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${healthBadgeClass(state)}`}>
      {formatState(state)}
    </span>
  );
}

function MetricTile({
  label,
  value,
  detail,
  state
}: {
  label: string;
  value: string;
  detail: string;
  state?: OperationalHealthState | OperationalFreshnessState;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</p>
        {state ? <StateBadge state={state} /> : null}
      </div>
      <p className="mt-3 text-2xl font-semibold text-ink">{value}</p>
      <p className="mt-2 text-sm text-slate-600">{detail}</p>
    </div>
  );
}

function countRecentEvents(dashboard: OperationalDashboard | null): number {
  if (!dashboard) {
    return 0;
  }
  return dashboard.events.succeeded + dashboard.events.failed + dashboard.events.timedOut + dashboard.events.unknown;
}

function sortWorkflowsForAttention(items: OperationalDashboard["workflows"]["items"]) {
  const priority: Record<OperationalHealthState, number> = {
    failing: 0,
    degraded: 1,
    unknown: 2,
    healthy: 3
  };

  return [...items].sort((left, right) => {
    const stateDelta = priority[left.state] - priority[right.state];
    if (stateDelta !== 0) {
      return stateDelta;
    }
    return right.activeIncidentCount - left.activeIncidentCount;
  });
}

function reliabilityWindowDetail(window: ReliabilityWindows["windows"][number]) {
  if (window.total === 0) {
    return "No events in this window";
  }
  return `${window.failed} failed - ${window.timedOut} timed out - ${window.unknown} unknown`;
}

export default async function OverviewPage() {
  const token = await requireToken();

  const [dashboardResult, reliabilityResult, workflowsPayload, settingsResult, sourcesResult, githubIntegrationsResult] = await Promise.all([
    fetchOperationalDashboard(token)
      .then((payload) => ({ ok: true as const, payload }))
      .catch(() => ({ ok: false as const })),
    fetchReliabilityWindows(token)
      .then((payload) => ({ ok: true as const, payload }))
      .catch(() => ({ ok: false as const })),
    fetchWorkflows(token),
    fetchTenantSettings(token)
      .then((payload) => ({ ok: true as const, payload }))
      .catch(() => ({ ok: false as const })),
    fetchConnectedSources(token)
      .then((payload) => ({ ok: true as const, payload }))
      .catch(() => ({
        ok: false as const,
        payload: {
          summary: {
            workflow_sources: 0,
            github_sources: 0,
            ingestion_keys_active: 0,
            alert_channels_ready: 0
          },
          sources: [],
          readiness: {
            ingestion_api_keys_configured: false,
            alert_dispatch_ready: false
          }
        }
      })),
    fetchGitHubIntegrations(token)
      .then((payload) => ({ ok: true as const, payload }))
      .catch(() => ({
        ok: false as const,
        payload: {
          webhook_url: "",
          integrations: []
        }
      }))
  ]);

  const dashboard = dashboardResult.ok ? dashboardResult.payload : null;
  const reliability = reliabilityResult.ok ? reliabilityResult.payload : null;
  const monitoringDataUnavailable = !dashboard;
  const openIncidents = dashboard?.activeIncidents.total ?? 0;
  const recentEventTotal = countRecentEvents(dashboard);
  const connectedSourcesSummary = sourcesResult.payload.summary;
  const connectedSources = sourcesResult.payload.sources;
  const hasConfiguredSources = connectedSources.length > 0;
  const activationJourney = deriveActivationJourney({
    connectedSources,
    githubIntegrations: githubIntegrationsResult.payload.integrations,
    totalSignals: recentEventTotal,
    openIncidents,
    metricsUnavailable: monitoringDataUnavailable
  });
  const sourceSetupPending = !activationJourney.hasActiveSources;
  const activeConnectedSourceCount = connectedSources.filter(
    (source) => source.status === "active" && (source.type === "workflow" || source.type === "github_integration")
  ).length;
  const connectedButQuiet = activationJourney.hasActiveSources && openIncidents === 0 && !activationJourney.firstSignalReceived;
  const activationIncomplete = !activationJourney.monitoringActive;
  const tenantSettings = settingsResult.ok
    ? settingsResult.payload.settings
    : {
        tenant_id: "unknown",
        default_currency: "USD" as const,
        current_plan: "free" as const,
        effective_plan: "free" as const,
        trial: {
          status: "none" as const,
          available: false,
          active: false,
          consumed: false,
          started_at: null,
          ends_at: null,
          source: null,
          days_remaining: 0
        }
      };
  const trial = tenantSettings.trial;
  const showTrialActive = trial.active;
  const showTrialEnded = !trial.active && trial.consumed && tenantSettings.current_plan === "free";
  const staleOrUnknownSources =
    dashboard?.sources.items.filter((source) => source.state === "stale" || source.state === "unknown").slice(0, 5) ?? [];
  const attentionWorkflows = dashboard
    ? sortWorkflowsForAttention(
        dashboard.workflows.items.filter((workflow) => workflow.state !== "healthy" || workflow.activeIncidentCount > 0)
      ).slice(0, 5)
    : [];

  return (
    <main className="min-h-screen syn-app-shell pb-12">
      <TopNav />
      <section className="mx-auto grid w-full max-w-6xl gap-6 px-4 pt-8">
        <div className="rounded-3xl bg-gradient-to-r from-ink to-ocean p-6 text-white shadow-panel">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-200">Operational Dashboard</p>
              <h2 className="mt-1 text-3xl font-semibold">What is happening right now</h2>
              <p className="mt-2 text-sm text-cyan-100">
                {dashboard ? `Generated ${formatDateTime(dashboard.generatedAt)}` : "Operational dashboard temporarily unavailable"}
              </p>
            </div>
            {dashboard ? <StateBadge state={dashboard.globalState} /> : <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">Unavailable</span>}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/incidents?status=open" className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-ink">
              Open incidents ({openIncidents})
            </Link>
            <Link href="/settings/control-plane" className="rounded-xl border border-cyan-200 px-4 py-2 text-sm font-semibold text-white">
              Control plane
            </Link>
          </div>
        </div>

        {activationIncomplete ? (
          <div className="rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-slate-700 shadow-panel" data-testid="overview-activation-banner">
            <p className="font-semibold text-ink">Activation still in progress</p>
            <p className="mt-1">{activationJourney.primaryAction.helper}</p>
            <a href={activationJourney.primaryAction.href} className="mt-2 inline-flex rounded-lg border border-cyan-300 px-3 py-1.5 text-xs font-semibold text-cyan-800">
              {activationJourney.primaryAction.label}
            </a>
          </div>
        ) : null}

        {sourceSetupPending ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-panel">
            <p className="font-semibold text-ink">{hasConfiguredSources ? "Sources configured but inactive" : "No active source connected yet"}</p>
            <p className="mt-1">
              {hasConfiguredSources
                ? "Synteq is not monitoring because configured sources are inactive."
                : "Connect and activate a source to start monitoring operational signals."}
            </p>
            <Link href="/settings/control-plane" className="mt-2 inline-flex rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700">
              Open control plane
            </Link>
          </div>
        ) : (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-panel">
            <p className="font-semibold">
              Synteq is monitoring {activeConnectedSourceCount} active source{activeConnectedSourceCount === 1 ? "" : "s"}.
            </p>
            <p className="mt-1">
              Watching {connectedSourcesSummary.workflow_sources} workflow signal source{connectedSourcesSummary.workflow_sources === 1 ? "" : "s"} and{" "}
              {connectedSourcesSummary.github_sources} GitHub integration{connectedSourcesSummary.github_sources === 1 ? "" : "s"}.
            </p>
          </div>
        )}

        {showTrialActive ? (
          <div className="flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-panel">
            <p>Pro trial active: {trial.days_remaining} days remaining.</p>
            {trial.started_at ? (
              <p className="text-xs text-emerald-700">Started {new Date(trial.started_at).toLocaleDateString()}</p>
            ) : null}
          </div>
        ) : null}

        {showTrialEnded ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-panel">
            Trial ended. Upgrade to Pro to continue full feature access.
          </div>
        ) : null}

        {monitoringDataUnavailable ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-panel">
            Operational dashboard data is temporarily unavailable. Incidents and source setup remain accessible.
          </div>
        ) : null}

        {dashboard?.globalState === "unknown" ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-panel">
            <p className="font-semibold text-ink">Operational state unknown</p>
            <p className="mt-1">No recent operational signal is available yet. Connect a source or wait for the next event batch.</p>
          </div>
        ) : null}

        {dashboard ? (
          <>
            <div className="grid gap-4 lg:grid-cols-3">
              <MetricTile
                label="Active Incidents"
                value={dashboard.activeIncidents.total.toLocaleString()}
                detail={`Critical ${dashboard.activeIncidents.bySeverity.critical} - High ${dashboard.activeIncidents.bySeverity.high} - Medium ${dashboard.activeIncidents.bySeverity.medium} - Low ${dashboard.activeIncidents.bySeverity.low}`}
                state={dashboard.activeIncidents.total > 0 ? dashboard.globalState : "healthy"}
              />
              <MetricTile
                label="Recently Resolved"
                value={dashboard.recentlyResolved.total.toLocaleString()}
                detail={`Resolved in the last ${dashboard.recentlyResolved.windowHours} hours`}
              />
              <MetricTile
                label="Source Freshness"
                value={`${dashboard.sources.fresh}/${dashboard.sources.total} fresh`}
                detail={`${dashboard.sources.stale} stale - ${dashboard.sources.unknown} unknown`}
                state={dashboard.sources.stale > 0 ? "stale" : dashboard.sources.unknown > 0 ? "unknown" : "fresh"}
              />
              <MetricTile
                label="Workflow Health"
                value={`${dashboard.workflows.healthy}/${dashboard.workflows.total} healthy`}
                detail={`${dashboard.workflows.failing} failing - ${dashboard.workflows.degraded} degraded - ${dashboard.workflows.unknown} unknown`}
                state={dashboard.workflows.failing > 0 ? "failing" : dashboard.workflows.degraded > 0 ? "degraded" : dashboard.workflows.unknown > 0 ? "unknown" : "healthy"}
              />
              <MetricTile
                label="Pipeline Freshness"
                value={formatState(dashboard.pipeline.state)}
                detail={dashboard.pipeline.jobs.map((job) => `${formatState(job.name)}: ${formatState(job.state)}`).join(" - ")}
                state={dashboard.pipeline.state}
              />
              <MetricTile
                label="Recent Events"
                value={recentEventTotal.toLocaleString()}
                detail={`${dashboard.events.succeeded} succeeded - ${dashboard.events.failed} failed - ${dashboard.events.timedOut} timed out - ${dashboard.events.unknown} unknown`}
              />
            </div>

            <section className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Reliability Windows</p>
                  <h3 className="mt-1 text-xl font-semibold text-ink">Recent reliability</h3>
                </div>
                {reliability ? (
                  <p className="text-xs text-slate-500">Generated {formatDateTime(reliability.generatedAt)}</p>
                ) : null}
              </div>
              {reliability ? (
                <>
                  {reliability.windows.every((window) => window.state === "unknown") ? (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-panel">
                      No recent reliability signals are available yet.
                    </div>
                  ) : null}
                  <div className="grid gap-4 md:grid-cols-3">
                    {reliability.windows.map((window) => (
                      <div key={window.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{window.label}</p>
                            <p className="mt-2 text-2xl font-semibold text-ink">{formatRate(window.successRate)}</p>
                          </div>
                          <StateBadge state={window.state} />
                        </div>
                        <p className="mt-2 text-sm text-slate-600">{reliabilityWindowDetail(window)}</p>
                        <p className="mt-2 text-xs text-slate-500">Last signal: {formatDateTime(window.lastSignalAt)}</p>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-panel">
                  Recent reliability data is temporarily unavailable.
                </div>
              )}
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Workflows</p>
                    <h3 className="mt-1 text-xl font-semibold text-ink">Needs attention</h3>
                  </div>
                  <StateBadge state={dashboard.workflows.failing > 0 ? "failing" : dashboard.workflows.degraded > 0 ? "degraded" : dashboard.workflows.unknown > 0 ? "unknown" : "healthy"} />
                </div>
                <div className="mt-4 grid gap-3">
                  {attentionWorkflows.length > 0 ? (
                    attentionWorkflows.map((workflow) => (
                      <div key={workflow.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold text-ink">{workflow.name}</p>
                          <StateBadge state={workflow.state} />
                        </div>
                        <p className="mt-1 text-sm text-slate-600">
                          {workflow.sourceName ?? "source"} - {workflow.environment ?? "default"} - {workflow.activeIncidentCount} active incident{workflow.activeIncidentCount === 1 ? "" : "s"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">Last signal: {formatDateTime(workflow.lastSignalAt)}</p>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                      No workflows are failing or degraded.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Sources</p>
                    <h3 className="mt-1 text-xl font-semibold text-ink">Stale or unknown</h3>
                  </div>
                  <StateBadge state={dashboard.sources.stale > 0 ? "stale" : dashboard.sources.unknown > 0 ? "unknown" : "fresh"} />
                </div>
                <div className="mt-4 grid gap-3">
                  {staleOrUnknownSources.length > 0 ? (
                    staleOrUnknownSources.map((source) => (
                      <div key={source.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold text-ink">{source.name}</p>
                          <StateBadge state={source.state} />
                        </div>
                        <p className="mt-1 text-sm text-slate-600">{formatState(source.type)}</p>
                        <p className="mt-1 text-xs text-slate-500">Last signal: {formatDateTime(source.lastSignalAt)}</p>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                      No stale or unknown sources.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Pipeline Jobs</p>
                  <h3 className="mt-1 text-xl font-semibold text-ink">Scheduler freshness</h3>
                </div>
                <StateBadge state={dashboard.pipeline.state} />
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {dashboard.pipeline.jobs.map((job) => (
                  <div key={job.name} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-ink">{formatState(job.name)}</p>
                      <StateBadge state={job.state} />
                    </div>
                    <p className="mt-2 text-xs text-slate-500">Last seen: {formatDateTime(job.lastSeenAt)}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {connectedButQuiet ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-panel">
            <p className="font-semibold text-ink">Source connected, waiting for first signal batch</p>
            <p className="mt-1">As events arrive, dashboard state and incident pressure will populate automatically.</p>
          </div>
        ) : null}

        {activationJourney.quietMonitoring && !connectedButQuiet ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 shadow-panel">
            <p className="font-semibold">Connected and monitoring</p>
            <p className="mt-1">No active incidents right now. Synteq is connected and receiving operational signals.</p>
          </div>
        ) : null}

        <section id="investigation-tools" className="space-y-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Investigation Tools</p>
            <h3 className="mt-1 text-xl font-semibold text-ink">Investigate and validate risk signals</h3>
            <p className="mt-1 text-sm text-slate-600">
              Reliability windows are based on received operational events. Scheduled synthetic checks are not enabled yet.
            </p>
          </div>
          {workflowsPayload.workflows.length > 0 ? (
            <ReliabilityTools workflows={workflowsPayload.workflows} />
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-panel">
              Register a workflow first, then run a Synteq Reliability Scan and controlled simulations.
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
