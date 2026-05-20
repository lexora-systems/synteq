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
  type ConnectedSourceRow,
  type GitHubIntegrationRow,
  type OperationalDashboard,
  type OperationalFreshnessState,
  type OperationalHealthState,
  type ReliabilityWindows,
  type TenantSettings,
  type WorkflowRow
} from "../../lib/api";
import { deriveActivationJourney } from "../../lib/activation";
import { requireToken } from "../../lib/auth";
import {
  asRecord,
  logServerLoadFailure,
  safeArray,
  safeBoolean,
  safeDateString,
  safeNullableString,
  safeNumber,
  safeString
} from "../../lib/resilience";

type LoadResult<T> = {
  ok: boolean;
  payload: T;
};

type ConnectedSourcesPayload = Awaited<ReturnType<typeof fetchConnectedSources>>;
type GitHubIntegrationsPayload = Awaited<ReturnType<typeof fetchGitHubIntegrations>>;
type TenantSettingsPayload = Awaited<ReturnType<typeof fetchTenantSettings>>;
type WorkflowsPayload = Awaited<ReturnType<typeof fetchWorkflows>>;

const HEALTH_STATES: OperationalHealthState[] = ["healthy", "degraded", "failing", "unknown"];
const FRESHNESS_STATES: OperationalFreshnessState[] = ["fresh", "stale", "unknown"];
const FALLBACK_CONNECTED_SOURCES: ConnectedSourcesPayload = {
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
};
const FALLBACK_GITHUB_INTEGRATIONS: GitHubIntegrationsPayload = {
  webhook_url: "",
  integrations: []
};
const FALLBACK_TENANT_SETTINGS: TenantSettingsPayload = {
  settings: {
    tenant_id: "unknown",
    default_currency: "USD",
    current_plan: "free",
    effective_plan: "free",
    trial: {
      status: "none",
      available: false,
      active: false,
      consumed: false,
      started_at: null,
      ends_at: null,
      source: null,
      days_remaining: 0
    }
  }
};
const FALLBACK_WORKFLOWS: WorkflowsPayload = {
  workflows: []
};

async function loadOverviewData<T>(
  scope: string,
  loader: () => Promise<unknown>,
  fallback: T,
  normalize: (payload: unknown) => T
): Promise<LoadResult<T>> {
  try {
    return {
      ok: true,
      payload: normalize(await loader())
    };
  } catch (error) {
    logServerLoadFailure("overview", scope, error);
    return {
      ok: false,
      payload: fallback
    };
  }
}

function normalizeHealthState(value: unknown): OperationalHealthState {
  return HEALTH_STATES.includes(value as OperationalHealthState) ? (value as OperationalHealthState) : "unknown";
}

function normalizeFreshnessState(value: unknown): OperationalFreshnessState {
  return FRESHNESS_STATES.includes(value as OperationalFreshnessState) ? (value as OperationalFreshnessState) : "unknown";
}

function normalizeConnectedSource(value: unknown): ConnectedSourceRow | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = safeString(record.id);
  if (!id) {
    return null;
  }

  return {
    id,
    type: record.type === "github_integration" ? "github_integration" : "workflow",
    name: safeString(record.name, "Unknown source"),
    status: record.status === "inactive" ? "inactive" : "active",
    powers: safeString(record.powers, "Operational monitoring"),
    details: asRecord(record.details) ?? {},
    last_activity_at: safeNullableString(record.last_activity_at),
    connected_at: safeDateString(record.connected_at)
  };
}

function normalizeConnectedSourcesPayload(payload: unknown): ConnectedSourcesPayload {
  const record = asRecord(payload);
  if (!record) {
    throw new Error("Malformed connected sources payload");
  }
  const summary = asRecord(record.summary);
  const readiness = asRecord(record.readiness);

  return {
    summary: {
      workflow_sources: safeNumber(summary?.workflow_sources),
      github_sources: safeNumber(summary?.github_sources),
      ingestion_keys_active: safeNumber(summary?.ingestion_keys_active),
      alert_channels_ready: safeNumber(summary?.alert_channels_ready)
    },
    sources: safeArray(record.sources, normalizeConnectedSource),
    readiness: {
      ingestion_api_keys_configured: safeBoolean(readiness?.ingestion_api_keys_configured),
      alert_dispatch_ready: safeBoolean(readiness?.alert_dispatch_ready)
    }
  };
}

function normalizeGitHubIntegration(value: unknown): GitHubIntegrationRow | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = safeString(record.id);
  const webhookId = safeString(record.webhook_id);
  if (!id || !webhookId) {
    return null;
  }

  return {
    id,
    webhook_id: webhookId,
    repository_full_name: safeNullableString(record.repository_full_name),
    is_active: safeBoolean(record.is_active),
    last_delivery_id: safeNullableString(record.last_delivery_id),
    last_seen_at: safeNullableString(record.last_seen_at),
    created_at: safeDateString(record.created_at),
    updated_at: safeDateString(record.updated_at)
  };
}

function normalizeGitHubIntegrationsPayload(payload: unknown): GitHubIntegrationsPayload {
  const record = asRecord(payload);
  if (!record) {
    throw new Error("Malformed GitHub integrations payload");
  }

  return {
    webhook_url: safeString(record.webhook_url),
    integrations: safeArray(record.integrations, normalizeGitHubIntegration)
  };
}

function normalizeWorkflow(value: unknown): WorkflowRow | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = safeString(record.id);
  if (!id) {
    return null;
  }

  return {
    id,
    slug: safeString(record.slug, id),
    display_name: safeString(record.display_name, "Untitled workflow"),
    environment: safeString(record.environment, "prod"),
    system: safeString(record.system, "workflow")
  };
}

function normalizeWorkflowsPayload(payload: unknown): WorkflowsPayload {
  const record = asRecord(payload);
  if (!record) {
    throw new Error("Malformed workflows payload");
  }

  return {
    workflows: safeArray(record.workflows, normalizeWorkflow)
  };
}

function normalizeTenantSettingsPayload(payload: unknown): TenantSettingsPayload {
  const record = asRecord(payload);
  const settings = asRecord(record?.settings);
  if (!settings) {
    return FALLBACK_TENANT_SETTINGS;
  }
  const trial = asRecord(settings.trial);

  return {
    settings: {
      tenant_id: safeString(settings.tenant_id, FALLBACK_TENANT_SETTINGS.settings.tenant_id),
      default_currency: ["USD", "PHP", "EUR", "GBP", "JPY", "AUD", "CAD"].includes(settings.default_currency as string)
        ? (settings.default_currency as TenantSettings["default_currency"])
        : FALLBACK_TENANT_SETTINGS.settings.default_currency,
      current_plan: ["free", "pro", "enterprise"].includes(settings.current_plan as string)
        ? (settings.current_plan as TenantSettings["current_plan"])
        : FALLBACK_TENANT_SETTINGS.settings.current_plan,
      effective_plan: ["free", "pro", "enterprise"].includes(settings.effective_plan as string)
        ? (settings.effective_plan as TenantSettings["effective_plan"])
        : FALLBACK_TENANT_SETTINGS.settings.effective_plan,
      trial: {
        status: ["none", "active", "expired"].includes(trial?.status as string)
          ? (trial?.status as TenantSettings["trial"]["status"])
          : "none",
        available: safeBoolean(trial?.available),
        active: safeBoolean(trial?.active),
        consumed: safeBoolean(trial?.consumed),
        started_at: safeNullableString(trial?.started_at),
        ends_at: safeNullableString(trial?.ends_at),
        source: ["manual", "auto_ingest", "auto_real_scan", "auto_workflow_connect"].includes(trial?.source as string)
          ? (trial?.source as TenantSettings["trial"]["source"])
          : null,
        days_remaining: safeNumber(trial?.days_remaining)
      }
    }
  };
}

function normalizeDashboard(payload: unknown): OperationalDashboard {
  const record = asRecord(payload);
  if (!record) {
    throw new Error("Malformed operational dashboard payload");
  }
  const activeIncidents = asRecord(record.activeIncidents);
  const bySeverity = asRecord(activeIncidents?.bySeverity);
  const recentlyResolved = asRecord(record.recentlyResolved);
  const sources = asRecord(record.sources);
  const workflows = asRecord(record.workflows);
  const pipeline = asRecord(record.pipeline);
  const events = asRecord(record.events);

  return {
    generatedAt: safeDateString(record.generatedAt),
    globalState: normalizeHealthState(record.globalState),
    activeIncidents: {
      total: safeNumber(activeIncidents?.total),
      bySeverity: {
        critical: safeNumber(bySeverity?.critical),
        high: safeNumber(bySeverity?.high),
        medium: safeNumber(bySeverity?.medium),
        low: safeNumber(bySeverity?.low),
        unknown: safeNumber(bySeverity?.unknown)
      }
    },
    recentlyResolved: {
      total: safeNumber(recentlyResolved?.total),
      windowHours: safeNumber(recentlyResolved?.windowHours, 24)
    },
    sources: {
      total: safeNumber(sources?.total),
      fresh: safeNumber(sources?.fresh),
      stale: safeNumber(sources?.stale),
      unknown: safeNumber(sources?.unknown),
      items: safeArray(sources?.items, (item) => {
        const source = asRecord(item);
        if (!source) {
          return null;
        }
        const id = safeString(source.id);
        return id
          ? {
              id,
              name: safeString(source.name, "Unknown source"),
              type: safeString(source.type, "unknown"),
              state: normalizeFreshnessState(source.state),
              lastSignalAt: safeNullableString(source.lastSignalAt)
            }
          : null;
      })
    },
    workflows: {
      total: safeNumber(workflows?.total),
      healthy: safeNumber(workflows?.healthy),
      degraded: safeNumber(workflows?.degraded),
      failing: safeNumber(workflows?.failing),
      unknown: safeNumber(workflows?.unknown),
      items: safeArray(workflows?.items, (item) => {
        const workflow = asRecord(item);
        if (!workflow) {
          return null;
        }
        const id = safeString(workflow.id);
        return id
          ? {
              id,
              name: safeString(workflow.name, "Untitled workflow"),
              sourceName: safeNullableString(workflow.sourceName) ?? undefined,
              environment: safeNullableString(workflow.environment) ?? undefined,
              state: normalizeHealthState(workflow.state),
              lastSignalAt: safeNullableString(workflow.lastSignalAt),
              activeIncidentCount: safeNumber(workflow.activeIncidentCount)
            }
          : null;
      })
    },
    pipeline: {
      state: normalizeFreshnessState(pipeline?.state),
      jobs: safeArray(pipeline?.jobs, (item) => {
        const job = asRecord(item);
        if (!job) {
          return null;
        }
        const name = safeString(job.name);
        return name
          ? {
              name,
              state: normalizeFreshnessState(job.state),
              lastSeenAt: safeNullableString(job.lastSeenAt)
            }
          : null;
      })
    },
    events: {
      windowHours: safeNumber(events?.windowHours, 24),
      succeeded: safeNumber(events?.succeeded),
      failed: safeNumber(events?.failed),
      timedOut: safeNumber(events?.timedOut),
      unknown: safeNumber(events?.unknown)
    }
  };
}

function normalizeReliabilityWindows(payload: unknown): ReliabilityWindows {
  const record = asRecord(payload);
  if (!record) {
    throw new Error("Malformed reliability windows payload");
  }
  const scope = asRecord(record.scope);

  return {
    generatedAt: safeDateString(record.generatedAt),
    scope: {
      tenantId: safeNullableString(scope?.tenantId) ?? undefined,
      workflowId: safeNullableString(scope?.workflowId),
      sourceId: safeNullableString(scope?.sourceId),
      sourceKey: safeNullableString(scope?.sourceKey)
    },
    windows: safeArray(record.windows, (item) => {
      const window = asRecord(item);
      if (!window) {
        return null;
      }
      const label = ["1h", "24h", "7d"].includes(window.label as string) ? (window.label as "1h" | "24h" | "7d") : null;
      return label
        ? {
            label,
            startAt: safeDateString(window.startAt),
            endAt: safeDateString(window.endAt),
            total: safeNumber(window.total),
            succeeded: safeNumber(window.succeeded),
            failed: safeNumber(window.failed),
            timedOut: safeNumber(window.timedOut),
            unknown: safeNumber(window.unknown),
            successRate: typeof window.successRate === "number" ? window.successRate : null,
            failureRate: typeof window.failureRate === "number" ? window.failureRate : null,
            timeoutRate: typeof window.timeoutRate === "number" ? window.timeoutRate : null,
            lastSignalAt: safeNullableString(window.lastSignalAt),
            state: normalizeHealthState(window.state)
          }
        : null;
    })
  };
}

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

  const [dashboardResult, reliabilityResult, workflowsResult, settingsResult, sourcesResult, githubIntegrationsResult] = await Promise.all([
    loadOverviewData("operational_dashboard", () => fetchOperationalDashboard(token), null as OperationalDashboard | null, normalizeDashboard),
    loadOverviewData("reliability_windows", () => fetchReliabilityWindows(token), null as ReliabilityWindows | null, normalizeReliabilityWindows),
    loadOverviewData("workflows", () => fetchWorkflows(token), FALLBACK_WORKFLOWS, normalizeWorkflowsPayload),
    loadOverviewData("tenant_settings", () => fetchTenantSettings(token), FALLBACK_TENANT_SETTINGS, normalizeTenantSettingsPayload),
    loadOverviewData("connected_sources", () => fetchConnectedSources(token), FALLBACK_CONNECTED_SOURCES, normalizeConnectedSourcesPayload),
    loadOverviewData(
      "github_integrations",
      () => fetchGitHubIntegrations(token),
      FALLBACK_GITHUB_INTEGRATIONS,
      normalizeGitHubIntegrationsPayload
    )
  ]);

  const dashboard = dashboardResult.payload;
  const reliability = reliabilityResult.payload;
  const workflowsPayload = workflowsResult.payload;
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
  const tenantSettings = settingsResult.payload.settings;
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
  const unavailableSections = [
    dashboardResult.ok ? null : "operational dashboard",
    reliabilityResult.ok ? null : "reliability windows",
    workflowsResult.ok ? null : "workflows",
    settingsResult.ok ? null : "tenant settings",
    sourcesResult.ok ? null : "sources",
    githubIntegrationsResult.ok ? null : "GitHub integrations"
  ].filter(Boolean);

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

        {unavailableSections.length > 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-panel" data-testid="overview-load-warning">
            Some live data is temporarily unavailable: {unavailableSections.join(", ")}. The rest of the dashboard remains usable.
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
