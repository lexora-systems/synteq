import Link from "next/link";
import { TopNav } from "../../../components/top-nav";
import { fetchConnectedSources, isApiRequestError } from "../../../lib/api";
import { requireToken } from "../../../lib/auth";

type DashboardRole = "owner" | "admin" | "engineer" | "viewer";

const unavailableSourcesPayload: Awaited<ReturnType<typeof fetchConnectedSources>> = {
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

function toStatusValue(value: number, available: boolean): string {
  return available ? String(value) : "Unavailable";
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

function logSourcesLoadFailure(error: unknown) {
  if (isApiRequestError(error)) {
    console.error("control_plane.sources_load_failed", {
      path: error.path,
      status: error.status,
      code: error.code,
      kind: error.kind,
      request_id: error.requestId
    });
    return;
  }

  console.error("control_plane.sources_load_failed", {
    error_type: error instanceof Error ? error.name : "UnknownError"
  });
}

async function loadConnectedSourcesStatus(token: string) {
  try {
    return {
      available: true,
      payload: await fetchConnectedSources(token)
    };
  } catch (error) {
    logSourcesLoadFailure(error);
    return {
      available: false,
      payload: unavailableSourcesPayload
    };
  }
}

export default async function ControlPlaneIndexPage() {
  const token = await requireToken();
  const sourcesStatus = await loadConnectedSourcesStatus(token);
  const sourcesPayload = sourcesStatus.payload;
  const canManage = ["owner", "admin"].includes(roleFromToken(token) ?? "viewer");

  return (
    <main className="min-h-screen syn-app-shell pb-12">
      <TopNav />
      <section className="mx-auto w-full max-w-6xl px-4 pt-8">
        <div className="rounded-2xl bg-white p-6 shadow-panel">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Control Plane</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">Continuous signal and alert setup</h2>
          <p className="mt-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-slate-700">
            Immediate value: Synteq continuously detects abnormal behavior and sends proactive alerts so teams can stop constant dashboard checking.
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Connected sources feed Synteq with operational signals using minimal access.
          </p>
          <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 md:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">What Synteq receives</p>
              <p className="mt-1">Operational signal metadata: status, timing, retries, run/job identifiers, and source health context.</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">What Synteq does NOT receive</p>
              <p className="mt-1">Source code, repository contents, artifact contents, full execution logs, or customer secrets by default.</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Access model</p>
              <p className="mt-1">Webhook/API-key authentication for event-level signals. Credentials are used for verification, not analysis input.</p>
            </div>
          </div>
          {!canManage ? (
            <p className="mt-2 text-xs text-slate-500">
              You currently have read-only access. Owner/admin role is required for control-plane mutations.
            </p>
          ) : null}
        </div>

        {!sourcesStatus.available ? (
          <div
            className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-panel"
            data-testid="control-plane-status-warning"
          >
            Setup status is temporarily unavailable. Configuration pages remain available, and source counts will refresh once the API responds.
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-white p-5 shadow-panel">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Readiness</p>
            <h3 className="mt-1 text-lg font-semibold text-ink">Current setup status</h3>
            <div className="mt-3 grid gap-2 text-sm text-slate-700">
              <p>Active workflow sources: <strong>{toStatusValue(sourcesPayload.summary.workflow_sources, sourcesStatus.available)}</strong></p>
              <p>Active GitHub sources: <strong>{toStatusValue(sourcesPayload.summary.github_sources, sourcesStatus.available)}</strong></p>
              <p>Active ingestion keys: <strong>{toStatusValue(sourcesPayload.summary.ingestion_keys_active, sourcesStatus.available)}</strong></p>
              <p>Enabled alert channels: <strong>{toStatusValue(sourcesPayload.summary.alert_channels_ready, sourcesStatus.available)}</strong></p>
            </div>
            <div className="mt-4">
              <Link href="/sources" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700">
                Open connected sources
              </Link>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-panel">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Configuration</p>
            <h3 className="mt-1 text-lg font-semibold text-ink">Manage control-plane components</h3>
            <div className="mt-3 grid gap-2">
              <Link href="/settings/control-plane/api-keys" className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
                API keys
              </Link>
              <Link href="/settings/control-plane/github" className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
                GitHub integrations
              </Link>
              <Link href="/settings/control-plane/alerts" className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
                Alert channels and policies
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
