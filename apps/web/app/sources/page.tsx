import Link from "next/link";
import { revalidatePath } from "next/cache";
import { TopNav } from "../../components/top-nav";
import {
  createGenericWorkflowSource,
  fetchConnectedSources,
  fetchMe,
  isApiContractError,
  isApiRequestError,
  runGenericWorkflowSourceSilentCheck,
  sendGenericWorkflowSourceTestEvent,
  type ConnectedSourceRow,
  type GenericWorkflowSourceType,
  type WorkflowSourceTestStatus
} from "../../lib/api";
import { deriveActivationJourney, resolveActivationJourney, type ActivationJourney } from "../../lib/activation";
import { requireToken } from "../../lib/auth";
import {
  GenericWorkflowSourceOnboarding,
  type GenericWorkflowSourceOnboardingState
} from "../../components/generic-workflow-source-onboarding";

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

type FreshnessState = "Fresh" | "Stale" | "Unknown";
type ConnectedSourcesPayload = Awaited<ReturnType<typeof fetchConnectedSources>>;
type DashboardRole = "owner" | "admin" | "engineer" | "viewer";

const STALE_THRESHOLD_MINUTES = 15;
const unavailableSourcesPayload: ConnectedSourcesPayload = {
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toSafeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toSafeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function roleFromToken(token: string): DashboardRole | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { role?: unknown };
    return payload.role === "owner" || payload.role === "admin" || payload.role === "engineer" || payload.role === "viewer"
      ? payload.role
      : null;
  } catch {
    return null;
  }
}

function fallbackActivationJourney(): ActivationJourney {
  return deriveActivationJourney({
    connectedSources: [],
    githubIntegrations: [],
    totalSignals: 0,
    openIncidents: 0,
    metricsUnavailable: true
  });
}

function logSourcesPageFailure(scope: string, error: unknown) {
  if (isApiRequestError(error)) {
    console.error("sources_page.load_failed", {
      scope,
      path: error.path,
      status: error.status,
      code: error.code,
      kind: error.kind,
      request_id: error.requestId
    });
    return;
  }

  if (isApiContractError(error)) {
    console.error("sources_page.load_failed", {
      scope,
      path: error.path,
      contract: error.contract,
      error_type: error.name
    });
    return;
  }

  console.error("sources_page.load_failed", {
    scope,
    error_type: error instanceof Error ? error.name : "UnknownError"
  });
}

function logSourceShapeWarning(issue: string, source: { id?: unknown; type?: unknown; status?: unknown }) {
  console.warn("sources_page.source_data_shape_invalid", {
    issue,
    source_id: typeof source.id === "string" ? source.id : null,
    source_type: typeof source.type === "string" ? source.type : null,
    source_status: typeof source.status === "string" ? source.status : null
  });
}

function normalizeConnectedSourceRow(value: unknown, index: number): ConnectedSourceRow | null {
  const source = asRecord(value);
  if (!source) {
    console.warn("sources_page.source_data_shape_invalid", {
      issue: "source_not_object",
      source_index: index
    });
    return null;
  }

  const type = source.type === "github_integration" ? "github_integration" : "workflow";
  const status = source.status === "active" ? "active" : "inactive";
  const details = asRecord(source.details);
  if (!details) {
    logSourceShapeWarning("details_not_object", source);
  }

  return {
    id: toSafeString(source.id, `source-${index}`),
    type,
    name: toSafeString(source.name, "Unnamed source"),
    status,
    powers: toSafeString(source.powers, ""),
    details: details ?? {},
    last_activity_at: toNullableString(source.last_activity_at),
    connected_at: toSafeString(source.connected_at, "")
  };
}

function normalizeConnectedSourcesPayload(value: unknown): ConnectedSourcesPayload {
  const payload = asRecord(value);
  if (!payload) {
    console.warn("sources_page.sources_payload_shape_invalid", { issue: "payload_not_object" });
    return unavailableSourcesPayload;
  }

  const summary = asRecord(payload.summary);
  const readiness = asRecord(payload.readiness);
  const sources = Array.isArray(payload.sources)
    ? payload.sources
        .map((source, index) => normalizeConnectedSourceRow(source, index))
        .filter((source): source is ConnectedSourceRow => Boolean(source))
    : [];

  if (!Array.isArray(payload.sources)) {
    console.warn("sources_page.sources_payload_shape_invalid", { issue: "sources_not_array" });
  }

  return {
    summary: {
      workflow_sources: toSafeNumber(summary?.workflow_sources),
      github_sources: toSafeNumber(summary?.github_sources),
      ingestion_keys_active: toSafeNumber(summary?.ingestion_keys_active),
      alert_channels_ready: toSafeNumber(summary?.alert_channels_ready)
    },
    sources,
    readiness: {
      ingestion_api_keys_configured: readiness?.ingestion_api_keys_configured === true,
      alert_dispatch_ready: readiness?.alert_dispatch_ready === true
    }
  };
}

function classifyFreshness(value: string | null, thresholdMinutes = STALE_THRESHOLD_MINUTES): FreshnessState {
  if (!value) {
    return "Unknown";
  }

  const timestampMs = new Date(value).getTime();
  if (!Number.isFinite(timestampMs)) {
    return "Unknown";
  }

  const ageMs = Date.now() - timestampMs;
  if (ageMs < 0) {
    return "Unknown";
  }

  return ageMs <= thresholdMinutes * 60_000 ? "Fresh" : "Stale";
}

function freshnessClasses(state: FreshnessState): string {
  if (state === "Fresh") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (state === "Stale") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  return "border-slate-200 bg-slate-100 text-slate-600";
}

function toStatusValue(value: number, available: boolean): string {
  return available ? String(value) : "Unavailable";
}

function sourceTypeFromDetails(source: ConnectedSourceRow): string {
  const details = asRecord(source.details);
  if (!details) {
    logSourceShapeWarning("details_not_object", source);
    return "workflow";
  }
  const sourceType = details.source_type;
  return typeof sourceType === "string" && sourceType.trim().length > 0 ? sourceType : "workflow";
}

function toLabel(source: ConnectedSourceRow): string {
  if (source.type === "workflow") {
    const sourceType = sourceTypeFromDetails(source);
    if (sourceType === "workflow") {
      return "Workflow";
    }
    if (sourceType === "n8n") {
      return "n8n workflow";
    }
    if (sourceType === "make") {
      return "Make workflow";
    }
    if (sourceType === "zapier") {
      return "Zapier workflow";
    }
    return "Webhook workflow";
  }
  return "GitHub integration";
}

function accessModel(source: ConnectedSourceRow): string {
  if (source.type === "github_integration") {
    return "Webhook-based, event-based, read-only";
  }
  if (sourceTypeFromDetails(source) !== "workflow") {
    return "API-key authenticated HTTP event ingestion";
  }
  return "Signal-level event ingestion";
}

function signalSummary(source: ConnectedSourceRow): string {
  if (source.type === "github_integration") {
    return "Workflow run/job webhook events";
  }
  if (sourceTypeFromDetails(source) !== "workflow") {
    return "Workflow execution status, timing, environment";
  }
  return "Execution status, retries, latency, heartbeat";
}

function riskSummary(source: ConnectedSourceRow): string {
  if (source.type === "github_integration") {
    return "Failed runs, retry storms, latency drift";
  }
  if (sourceTypeFromDetails(source) !== "workflow") {
    return "Failed, timed out, or delayed workflow executions";
  }
  return "Failure spikes, missing heartbeats, latency/cost spikes";
}

function toWorkflowSourceFailureMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unable to process workflow source action right now.";
  }

  if (error.message.includes("UPGRADE_REQUIRED")) {
    return "Source limit reached for this workspace. Upgrade or deactivate another source before creating a new one.";
  }

  if (error.message.includes("FORBIDDEN_PERMISSION") || error.message.includes("403")) {
    return "Owner/admin role is required to create workflow sources.";
  }

  if (error.message.includes("generic workflow silent checks") || error.message.includes("generic workflow sources")) {
    return "Silent checks are only available for generic workflow sources.";
  }

  if (error.message.includes("404")) {
    return "Workflow source was not found for this workspace.";
  }

  return "Unable to process workflow source action right now.";
}

function isGenericWorkflowSourceType(value: string): value is GenericWorkflowSourceType {
  return ["webhook", "n8n", "make", "zapier"].includes(value);
}

function isWorkflowSourceTestStatus(value: string): value is WorkflowSourceTestStatus {
  return ["succeeded", "failed", "timed_out"].includes(value);
}

async function loadConnectedSourcesStatus(token: string) {
  try {
    return {
      available: true,
      payload: normalizeConnectedSourcesPayload(await fetchConnectedSources(token))
    };
  } catch (error) {
    logSourcesPageFailure("connected_sources", error);
    return {
      available: false,
      payload: unavailableSourcesPayload
    };
  }
}

async function loadActivationJourneyStatus(token: string) {
  try {
    return {
      available: true,
      activationJourney: await resolveActivationJourney(token)
    };
  } catch (error) {
    logSourcesPageFailure("activation_journey", error);
    return {
      available: false,
      activationJourney: fallbackActivationJourney()
    };
  }
}

async function loadCurrentUserRole(token: string) {
  try {
    const me = await fetchMe(token);
    const role = me.user.role;
    if (role === "owner" || role === "admin" || role === "engineer" || role === "viewer") {
      return {
        available: true,
        role
      };
    }
    console.warn("sources_page.user_shape_invalid", { issue: "invalid_role" });
  } catch (error) {
    logSourcesPageFailure("current_user", error);
  }

  return {
    available: false,
    role: roleFromToken(token) ?? "viewer"
  };
}

async function manageGenericWorkflowSourceAction(
  state: GenericWorkflowSourceOnboardingState,
  formData: FormData
): Promise<GenericWorkflowSourceOnboardingState> {
  "use server";

  const token = await requireToken();
  const intent = String(formData.get("intent") ?? "");

  try {
    if (intent === "create") {
      const displayName = String(formData.get("display_name") ?? "").trim();
      const sourceTypeRaw = String(formData.get("source_type") ?? "").trim();
      const environment = String(formData.get("environment") ?? "production").trim() || "production";

      if (!displayName) {
        return {
          ...state,
          ok: false,
          message: "Source name is required.",
          last_test: null,
          last_silent_check: null
        };
      }

      if (!isGenericWorkflowSourceType(sourceTypeRaw)) {
        return {
          ...state,
          ok: false,
          message: "Choose a supported workflow source type.",
          last_test: null,
          last_silent_check: null
        };
      }

      const created = await createGenericWorkflowSource(token, {
        display_name: displayName,
        source_type: sourceTypeRaw,
        environment
      });
      revalidatePath("/sources");

      return {
        ok: true,
        message: `Workflow source "${created.workflow_source.display_name}" created. Copy the key before leaving this page.`,
        latest_source: {
          ...created.workflow_source,
          ingestion_key: created.ingestion_key
        },
        last_test: null,
        last_silent_check: null
      };
    }

    if (intent === "test") {
      const sourceId = String(formData.get("source_id") ?? "").trim();
      const statusRaw = String(formData.get("status") ?? "").trim();

      if (!sourceId || !isWorkflowSourceTestStatus(statusRaw)) {
        return {
          ...state,
          ok: false,
          message: "Choose a valid test event.",
          last_test: null,
          last_silent_check: null
        };
      }

      const result = await sendGenericWorkflowSourceTestEvent(token, sourceId, statusRaw);
      revalidatePath("/sources");

      return {
        ...state,
        ok: result.ok,
        message: result.message,
        last_test: result,
        last_silent_check: null
      };
    }

    if (intent === "silent_check") {
      const sourceId = String(formData.get("source_id") ?? "").trim();

      if (!sourceId) {
        return {
          ...state,
          ok: false,
          message: "Choose a workflow source before running a silent check.",
          last_test: null,
          last_silent_check: null
        };
      }

      const result = await runGenericWorkflowSourceSilentCheck(token, sourceId);

      return {
        ...state,
        ok: result.status !== "failed",
        message:
          result.status === "ok"
            ? "Silent check passed. No operational writes were performed."
            : result.status === "warning"
              ? "Silent check completed with warnings. No operational writes were performed."
              : "Silent check failed. No operational writes were performed.",
        last_silent_check: result
      };
    }

    return {
      ...state,
      ok: false,
      message: "Unknown workflow source action.",
      last_test: null,
      last_silent_check: null
    };
  } catch (error) {
    return {
      ...state,
      ok: false,
      message: toWorkflowSourceFailureMessage(error),
      last_test: null,
      last_silent_check: null
    };
  }
}

export default async function ConnectedSourcesPage() {
  const token = await requireToken();
  const [sourcesStatus, activationStatus, userStatus] = await Promise.all([
    loadConnectedSourcesStatus(token),
    loadActivationJourneyStatus(token),
    loadCurrentUserRole(token)
  ]);
  const payload = sourcesStatus.payload;
  const activationJourney = activationStatus.activationJourney;
  const canManageWorkflowSources = ["owner", "admin"].includes(userStatus.role);
  const loadWarnings = [
    !sourcesStatus.available ? "Source inventory is temporarily unavailable." : null,
    !activationStatus.available ? "Activation status is temporarily unavailable." : null,
    !userStatus.available ? "User role details are temporarily unavailable; permissions were inferred from the current session where possible." : null
  ].filter((message): message is string => Boolean(message));
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
  const latestSourceSignalFreshness = classifyFreshness(latestSourceSignalAt);
  const latestGitHubDeliveryFreshness = classifyFreshness(latestGitHubSignalAt);

  const sourceOperationalStatus =
    !sourcesStatus.available
      ? "Source status temporarily unavailable"
      : !hasSources
      ? "Waiting for first source connection"
      : !hasActiveSources
        ? "Sources configured but inactive"
      : activeGitHubSources.length > 0 && !activationJourney.webhookVerified
        ? "Waiting for webhook delivery"
        : activationJourney.monitoringActive
          ? "Connected and monitoring"
          : activationJourney.firstSignalReceived
            ? "Connected and analyzing"
            : "Connected, waiting for first signal";

  const sourceOperationalMessage =
    !sourcesStatus.available
      ? "Synteq could not load current source status. Configuration tools remain available, and this page will refresh once the API responds."
      : !activationStatus.available
        ? "Source inventory loaded, but activation progress is temporarily unavailable."
        : !hasSources
      ? "Connect GitHub or another source to begin activation."
      : !hasActiveSources
        ? "Sources are configured but currently inactive. Synteq monitoring resumes when at least one source is active."
      : activeGitHubSources.length > 0 && !activationJourney.webhookVerified
        ? "GitHub integration is active, but no verified webhook delivery has been received yet."
        : activationJourney.monitoringActive
          ? "Synteq is ingesting and monitoring signals. If incidents are empty, the environment may currently be quiet."
          : activationJourney.firstSignalReceived
            ? "Synteq has begun receiving signals and is continuing to build confidence from recent activity."
            : "Source is connected but no signal has been received yet. Trigger one run/event to validate ingestion.";

  return (
    <main className="min-h-screen syn-app-shell pb-12">
      <TopNav />
      <section className="mx-auto w-full max-w-6xl px-4 pt-8">
        <div className="rounded-2xl bg-white p-6 shadow-panel">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Connected Sources</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">Operational signal connectivity</h2>
          <p className="mt-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-slate-700">
            Connected sources let Synteq detect abnormal behavior and support alerting once delivery infrastructure is configured.
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

        {loadWarnings.length > 0 ? (
          <div
            className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-panel"
            data-testid="sources-load-warning"
          >
            <p className="font-semibold">Some source setup data is temporarily unavailable.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {loadWarnings.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {!hasActiveSources ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-panel">
            <p className="font-semibold text-ink">
              {!sourcesStatus.available ? "Source status temporarily unavailable" : hasSources ? "Sources configured but inactive" : "No active source connected yet"}
            </p>
            <p className="mt-1">
              {!sourcesStatus.available
                ? "Synteq could not load current source status. Retry this page once the API responds."
                : hasSources
                ? "Configured sources are currently inactive, so Synteq is not monitoring live signals right now."
                : "Connect and activate your first source to start live monitoring."}
            </p>
            <p className="mt-1">Monitoring becomes active after real workflow events arrive. Alert delivery depends on configured scheduler/email infrastructure.</p>
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
              Configured alert delivery can notify teams when failure spikes, retry storms, missing heartbeats, or latency-related risks are detected.
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
              <span className={`ml-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${freshnessClasses(latestSourceSignalFreshness)}`}>
                {latestSourceSignalFreshness}
              </span>
            </p>
            <p>
              Last GitHub delivery: <strong>{formatTimestamp(latestGitHubSignalAt)}</strong>
              <span className={`ml-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${freshnessClasses(latestGitHubDeliveryFreshness)}`}>
                {latestGitHubDeliveryFreshness}
              </span>
            </p>
            <p>
              Repo scope: <strong>{githubCount > 0 ? "Configured" : hasInactiveGitHubSources ? "Configured (inactive)" : "Not configured"}</strong>
            </p>
            <p>
              Monitoring status: <strong>{activationJourney.monitoringActive ? "Live" : hasActiveSources ? "Waiting for signal" : "Inactive"}</strong>
            </p>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Fresh/Stale labels use a {STALE_THRESHOLD_MINUTES}-minute recency threshold where timestamp data is available.
            Unknown means freshness is not yet available from current source telemetry.
          </p>
        </div>

        <div className="mt-4">
          <GenericWorkflowSourceOnboarding
            canManage={canManageWorkflowSources}
            action={manageGenericWorkflowSourceAction}
          />
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl bg-white p-4 shadow-panel">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Workflow sources</p>
            <p className="mt-2 text-2xl font-semibold text-ink">{toStatusValue(payload.summary.workflow_sources, sourcesStatus.available)}</p>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-panel">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">GitHub sources</p>
            <p className="mt-2 text-2xl font-semibold text-ink">{toStatusValue(payload.summary.github_sources, sourcesStatus.available)}</p>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-panel">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Ingestion keys</p>
            <p className="mt-2 text-2xl font-semibold text-ink">{toStatusValue(payload.summary.ingestion_keys_active, sourcesStatus.available)}</p>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-panel">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Alert channels</p>
            <p className="mt-2 text-2xl font-semibold text-ink">{toStatusValue(payload.summary.alert_channels_ready, sourcesStatus.available)}</p>
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
                  <th className="py-2 pr-2">Name</th>
                  <th className="py-2 pr-2">Type</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Access model</th>
                  <th className="py-2 pr-2">Signals watched</th>
                  <th className="py-2 pr-2">Risk patterns detected</th>
                  <th className="py-2 pr-2">Last activity</th>
                  <th className="py-2 pr-2">Connected</th>
                </tr>
              </thead>
              <tbody>
                {payload.sources.length > 0 ? (
                  payload.sources.map((source) => (
                    <tr key={`${source.type}-${source.id}`} className="border-b border-slate-100 align-top text-slate-700">
                      <td className="py-3 pr-2">{source.name}</td>
                      <td className="py-3 pr-2">{toLabel(source)}</td>
                      <td className="py-3 pr-2">{source.status}</td>
                      <td className="py-3 pr-2">{accessModel(source)}</td>
                      <td className="py-3 pr-2">{signalSummary(source)}</td>
                      <td className="py-3 pr-2">{riskSummary(source)}</td>
                      <td className="py-3 pr-2">{formatTimestamp(source.last_activity_at)}</td>
                      <td className="py-3 pr-2">{formatTimestamp(source.connected_at)}</td>
                    </tr>
                  ))
                ) : (
                  <tr className="border-b border-slate-100 text-slate-600">
                    <td className="py-4 pr-2" colSpan={8}>
                      {sourcesStatus.available ? "No connected sources yet." : "Source inventory is temporarily unavailable."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
