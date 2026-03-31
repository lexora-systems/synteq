import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { TopNav } from "../../components/top-nav";
import { fetchMe, fetchTenantSettings, fetchWorkflows, registerWorkflow, startTenantTrial } from "../../lib/api";
import { resolveActivationState } from "../../lib/activation";
import { requireToken } from "../../lib/auth";

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

async function startTrialAction() {
  "use server";
  const token = await requireToken();

  try {
    const response = await startTenantTrial(token);
    revalidatePath("/welcome");
    revalidatePath("/overview");
    revalidatePath("/settings/tenant");
    redirect(`/welcome?trial=${response.result.code}`);
  } catch {
    redirect("/welcome?trial=error");
  }
}

async function connectWorkflowAction(formData: FormData) {
  "use server";
  const token = await requireToken();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const system = String(formData.get("system") ?? "").trim();
  const environment = String(formData.get("environment") ?? "prod").trim() || "prod";
  const providedSlug = String(formData.get("slug") ?? "").trim();
  const slug = toSlug(providedSlug || displayName);

  if (!displayName || !system || !slug) {
    redirect("/welcome?workflow=invalid");
  }

  try {
    await registerWorkflow(token, {
      slug,
      display_name: displayName,
      system,
      environment
    });
    revalidatePath("/welcome");
    revalidatePath("/overview");
    redirect("/welcome?workflow=connected");
  } catch {
    redirect("/welcome?workflow=error");
  }
}

export default async function WelcomePage({
  searchParams
}: {
  searchParams: Promise<{ trial?: string; workflow?: string }>;
}) {
  const params = await searchParams;
  const token = await requireToken();
  const activation = await resolveActivationState(token);

  if (activation.activated && !activation.metricsUnavailable) {
    redirect("/overview");
  }

  const [settingsResult, meResult, workflowsResult] = await Promise.all([
    fetchTenantSettings(token)
      .then((payload) => ({ ok: true as const, payload }))
      .catch(() => ({ ok: false as const })),
    fetchMe(token)
      .then((payload) => ({ ok: true as const, payload }))
      .catch(() => ({ ok: false as const })),
    fetchWorkflows(token)
      .then((payload) => ({ ok: true as const, payload }))
      .catch(() => ({ ok: false as const, payload: { workflows: [] } }))
  ]);

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

  const role = meResult.ok ? meResult.payload.user.role : "viewer";
  const canManageWorkflows = role === "owner" || role === "admin" || role === "engineer";
  const canManuallyStartTrial = role === "owner" || role === "admin";
  const trial = tenantSettings.trial;
  const showTrialStartCta =
    trial.available && !trial.active && tenantSettings.effective_plan === "free" && tenantSettings.current_plan === "free";
  const showTrialActive = trial.active;
  const showTrialEnded = !trial.active && trial.consumed && tenantSettings.current_plan === "free";
  const connectedWorkflows = workflowsResult.ok ? workflowsResult.payload.workflows : [];
  const hasConnectedWorkflow = connectedWorkflows.length > 0;
  const trialStatusLabel = showTrialActive
    ? `${trial.days_remaining}d left`
    : showTrialEnded
      ? "Used"
      : showTrialStartCta
        ? "Available"
        : "Unavailable";
  const planLabel = tenantSettings.effective_plan.toUpperCase();

  return (
    <main className="min-h-screen syn-app-shell pb-12">
      <TopNav />
      <section className="mx-auto w-full max-w-[1120px] px-4 pb-12 pt-5 sm:px-6 sm:pt-7 lg:px-8 lg:pt-10">
        {activation.metricsUnavailable ? (
          <div className="mb-6 rounded-2xl border border-amber-300/70 bg-amber-50/95 px-4 py-3 text-sm text-amber-800 shadow-panel">
            Monitoring services are temporarily unavailable. You can review setup here and retry actions once API access is restored.
          </div>
        ) : null}

        <section
          className="relative overflow-hidden rounded-3xl border border-cyan-400/25 bg-gradient-to-r from-[#071a35]/90 via-[#0a2b52]/80 to-[#0a3555]/85 p-6 sm:p-8"
          data-testid="welcome-onboarding-hero"
        >
          <div
            className="pointer-events-none absolute right-[-90px] top-[-110px] h-[260px] w-[260px] rounded-full opacity-70"
            style={{ background: "radial-gradient(circle, rgba(34,211,238,0.28) 0%, transparent 70%)" }}
          />
          <div className="relative">
            <p className="syn-hero-kicker text-xs font-medium uppercase tracking-[0.24em]">Welcome to Synteq</p>
            <h1 className="mt-3 max-w-[760px] text-4xl font-semibold leading-tight text-slate-100 sm:text-5xl">
              Understand risk clearly before it becomes an incident
            </h1>
            <p className="mt-4 max-w-[760px] text-base text-cyan-50/85 sm:text-lg">
              Immediate value: continuous awareness and proactive alerts with minimal access required.
            </p>

            <div className="mt-5 flex flex-wrap gap-2.5">
              <span className="syn-chip">Plan: {planLabel}</span>
              <span className="syn-chip">Trial: {trialStatusLabel}</span>
              <span className="syn-chip">Role: {role}</span>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <a
                href="#connect-workflow"
                className="syn-cta-lift syn-btn-primary w-full text-sm sm:w-auto"
                data-testid="welcome-connect-workflow-cta"
              >
                Connect your first workflow
              </a>
              <Link
                href="/settings/control-plane"
                className="syn-cta-lift syn-btn-secondary syn-btn-secondary-soft w-full text-sm sm:w-auto"
              >
                Open control plane
              </Link>
              <Link
                href="/overview#investigation-tools"
                className="syn-cta-lift syn-btn-secondary syn-btn-secondary-soft w-full text-sm sm:w-auto"
                data-testid="welcome-run-simulation-cta"
              >
                Run simulation first
              </Link>
            </div>

            <p className="mt-4 text-sm text-cyan-100/70">
              You can start trial now or let it activate automatically when live monitoring begins.
            </p>
          </div>
        </section>

        <section className="mt-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Trust and Access</p>
            <h2 className="mt-1 text-xl font-semibold text-ink">Minimal access required</h2>
            <div className="mt-3 grid gap-3 text-sm text-slate-700 md:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">What Synteq receives</p>
                <p className="mt-1">Operational signals and event-level telemetry.</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">What Synteq does NOT receive</p>
                <p className="mt-1">Full system control, full repository access, or broad credentials.</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Access model and control</p>
                <p className="mt-1">Webhook/event-based, read-only, signal-level access. Disconnect anytime.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-5">
          <div className="syn-app-panel rounded-3xl p-5 sm:p-6">
            <h2 className="syn-app-title text-xl font-semibold">Activation checklist</h2>
            <p className="syn-app-copy mt-1 text-sm">A clear 3-step flow for first-time setup.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="syn-app-panel-muted rounded-2xl px-4 py-3">
                <p className="syn-app-muted text-xs uppercase tracking-[0.2em]">Step 1</p>
                <p className="syn-app-title mt-1 font-medium">Connect at least one workflow</p>
              </div>
              <div className="syn-app-panel-muted rounded-2xl px-4 py-3">
                <p className="syn-app-muted text-xs uppercase tracking-[0.2em]">Step 2</p>
                <p className="syn-app-title mt-1 font-medium">Configure ingestion keys/integrations</p>
              </div>
              <div className="syn-app-panel-muted rounded-2xl px-4 py-3">
                <p className="syn-app-muted text-xs uppercase tracking-[0.2em]">Step 3</p>
                <p className="syn-app-title mt-1 font-medium">Review risk insights in Overview</p>
              </div>
            </div>
            <p className="syn-app-muted mt-4 text-sm">Use simulation while your live setup is still in progress.</p>
          </div>
        </section>

        <div className="mt-6 space-y-3">
          {params.trial === "started" ? (
            <div className="rounded-2xl border border-emerald-300/70 bg-emerald-50/95 px-4 py-3 text-sm text-emerald-800 shadow-panel">
              Your 14-day Pro trial has started.
            </div>
          ) : null}
          {params.trial === "already_active" ? (
            <div className="syn-app-panel-muted syn-app-copy rounded-2xl px-4 py-3 text-sm">Pro trial is already active.</div>
          ) : null}
          {params.trial === "already_used" ? (
            <div className="syn-app-panel-muted syn-app-copy rounded-2xl px-4 py-3 text-sm">Trial has already been used for this tenant.</div>
          ) : null}
          {params.trial === "not_eligible" ? (
            <div className="syn-app-panel-muted syn-app-copy rounded-2xl px-4 py-3 text-sm">This tenant is not eligible for a trial.</div>
          ) : null}
          {params.trial === "error" ? (
            <div className="rounded-2xl border border-amber-300/70 bg-amber-50/95 px-4 py-3 text-sm text-amber-800 shadow-panel">
              Unable to start trial right now. Please try again.
            </div>
          ) : null}
          {params.workflow === "connected" ? (
            <div className="rounded-2xl border border-emerald-300/70 bg-emerald-50/95 px-4 py-3 text-sm text-emerald-800 shadow-panel">
              Workflow connected. Synteq is now watching this source once telemetry arrives, and you&apos;ll be alerted when reliability risks are detected.
            </div>
          ) : null}
          {params.workflow === "invalid" ? (
            <div className="rounded-2xl border border-amber-300/70 bg-amber-50/95 px-4 py-3 text-sm text-amber-800 shadow-panel">
              Workflow name and system are required.
            </div>
          ) : null}
          {params.workflow === "error" ? (
            <div className="rounded-2xl border border-amber-300/70 bg-amber-50/95 px-4 py-3 text-sm text-amber-800 shadow-panel">
              Unable to connect workflow right now. Please try again.
            </div>
          ) : null}
        </div>

        {hasConnectedWorkflow ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-panel">
            <p className="font-semibold">
              Synteq is now watching {connectedWorkflows.length} workflow source{connectedWorkflows.length === 1 ? "" : "s"}.
            </p>
            <p className="mt-1">
              Signals watched: execution outcomes, retry behavior, latency trends, and heartbeat continuity.
            </p>
            <p className="mt-1">
              You&apos;ll be alerted when failure spikes, retry storms, missing heartbeats, or latency-related risks are detected.
            </p>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-panel">
            <p className="font-semibold text-ink">No connected source yet</p>
            <p className="mt-1">Connect one source to start live monitoring. Synteq is continuously monitoring once signals begin arriving.</p>
          </div>
        )}

        <section className="mt-6 space-y-4">
          <div>
            <p className="syn-app-kicker text-xs font-medium uppercase tracking-[0.22em]">Activation Paths</p>
            <h2 className="syn-app-title mt-1 text-2xl font-semibold">Choose your next step</h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <article className="syn-app-panel rounded-2xl p-5">
              <p className="syn-app-kicker text-[11px] font-medium uppercase tracking-[0.18em]">Plan Upgrade</p>
              <h3 className="syn-app-title mt-2 text-lg font-semibold">Start Pro trial</h3>
              <p className="syn-app-copy mt-2 text-sm">
                Unlock full scans, multiple workflows, and advanced risk visibility for 14 days.
              </p>
              <div className="mt-4">
                {showTrialStartCta && canManuallyStartTrial ? (
                  <form action={startTrialAction}>
                    <button className="syn-cta-lift syn-btn-primary text-sm">Start trial</button>
                  </form>
                ) : showTrialActive ? (
                  <p className="text-sm font-medium text-emerald-700">Active: {trial.days_remaining} days left</p>
                ) : showTrialEnded ? (
                  <p className="syn-app-copy text-sm">Trial already consumed</p>
                ) : (
                  <p className="syn-app-copy text-sm">Owner or admin can activate trial</p>
                )}
              </div>
            </article>

            <article className="syn-app-panel rounded-2xl p-5">
              <p className="syn-app-kicker text-[11px] font-medium uppercase tracking-[0.18em]">Live Setup</p>
              <h3 className="syn-app-title mt-2 text-lg font-semibold">Connect a workflow</h3>
              <p className="syn-app-copy mt-2 text-sm">
                Register your first service to start receiving telemetry and building risk insights.
              </p>
              <div className="mt-4">
                <a href="#connect-workflow" className="syn-cta-lift syn-btn-secondary syn-btn-secondary-soft text-sm">
                  Connect workflow
                </a>
              </div>
            </article>

            <article className="syn-app-panel rounded-2xl p-5">
              <p className="syn-app-kicker text-[11px] font-medium uppercase tracking-[0.18em]">Signal Ingestion</p>
              <h3 className="syn-app-title mt-2 text-lg font-semibold">Configure control plane</h3>
              <p className="syn-app-copy mt-2 text-sm">
                Create API keys, set up GitHub webhook integrations, and configure alert dispatch channels.
              </p>
              <div className="mt-4">
                <Link href="/settings/control-plane" className="syn-cta-lift syn-btn-secondary syn-btn-secondary-soft text-sm">
                  Open control plane
                </Link>
              </div>
            </article>

            <article className="syn-app-panel rounded-2xl p-5">
              <p className="syn-app-kicker text-[11px] font-medium uppercase tracking-[0.18em]">Safe Testing</p>
              <h3 className="syn-app-title mt-2 text-lg font-semibold">Run a simulation</h3>
              <p className="syn-app-copy mt-2 text-sm">
                Validate detection behavior safely before live telemetry is connected.
              </p>
              <div className="mt-4">
                <Link href="/overview#investigation-tools" className="syn-cta-lift syn-btn-secondary syn-btn-secondary-soft text-sm">
                  Open simulation
                </Link>
              </div>
            </article>
          </div>
        </section>

        <section id="connect-workflow" className="mt-6">
          <div className="syn-app-panel rounded-3xl p-5 sm:p-6">
            <div>
              <p className="syn-app-kicker text-xs font-medium uppercase tracking-[0.22em]">Workflow Setup</p>
              <h2 className="syn-app-title mt-1 text-2xl font-semibold">Connect your first workflow</h2>
              <p className="syn-app-copy mt-2 text-sm">
                Add one workflow to start live monitoring. You can run simulation while telemetry setup is pending.
              </p>
            </div>

            {canManageWorkflows ? (
              <form action={connectWorkflowAction} className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="syn-app-copy grid gap-1 text-sm">
                  Workflow Name
                  <input type="text" name="display_name" required placeholder="Payments Daily" className="h-11 rounded-xl border px-3 text-sm" />
                </label>
                <label className="syn-app-copy grid gap-1 text-sm">
                  System
                  <input type="text" name="system" required placeholder="checkout-service" className="h-11 rounded-xl border px-3 text-sm" />
                </label>
                <label className="syn-app-copy grid gap-1 text-sm">
                  Environment
                  <select name="environment" defaultValue="prod" className="h-11 rounded-xl border px-3 text-sm">
                    <option value="prod">prod</option>
                    <option value="staging">staging</option>
                    <option value="dev">dev</option>
                  </select>
                </label>
                <label className="syn-app-copy grid gap-1 text-sm">
                  Optional Slug
                  <input type="text" name="slug" placeholder="payments-daily" className="h-11 rounded-xl border px-3 text-sm" />
                </label>
                <div className="md:col-span-2">
                  <button className="syn-cta-lift syn-btn-primary text-sm">Connect workflow</button>
                </div>
              </form>
            ) : (
              <div className="syn-app-panel-muted syn-app-copy mt-4 rounded-2xl p-4 text-sm">
                Owner, admin, or engineer role is required to connect workflows.
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

