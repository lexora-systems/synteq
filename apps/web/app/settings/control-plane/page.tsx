import Link from "next/link";
import { TopNav } from "../../../components/top-nav";
import { fetchConnectedSources, fetchMe } from "../../../lib/api";
import { requireToken } from "../../../lib/auth";

export default async function ControlPlaneIndexPage() {
  const token = await requireToken();
  const [me, sourcesPayload] = await Promise.all([fetchMe(token), fetchConnectedSources(token)]);
  const canManage = ["owner", "admin"].includes(me.user.role);

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

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-white p-5 shadow-panel">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Readiness</p>
            <h3 className="mt-1 text-lg font-semibold text-ink">Current setup status</h3>
            <div className="mt-3 grid gap-2 text-sm text-slate-700">
              <p>Active workflow sources: <strong>{sourcesPayload.summary.workflow_sources}</strong></p>
              <p>Active GitHub sources: <strong>{sourcesPayload.summary.github_sources}</strong></p>
              <p>Active ingestion keys: <strong>{sourcesPayload.summary.ingestion_keys_active}</strong></p>
              <p>Enabled alert channels: <strong>{sourcesPayload.summary.alert_channels_ready}</strong></p>
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
