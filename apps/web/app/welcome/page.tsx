import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { TopNav } from "../../components/top-nav";
import { fetchMe, fetchTenantSettings, registerWorkflow, startTenantTrial } from "../../lib/api";
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

  const [settingsResult, meResult] = await Promise.all([
    fetchTenantSettings(token)
      .then((payload) => ({ ok: true as const, payload }))
      .catch(() => ({ ok: false as const })),
    fetchMe(token)
      .then((payload) => ({ ok: true as const, payload }))
      .catch(() => ({ ok: false as const }))
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

  return (
    <main className="min-h-screen bg-cloud pb-12">
      <TopNav />
      <section className="mx-auto w-full max-w-[1120px] px-4 pb-12 pt-5 sm:px-6 sm:pt-7 lg:px-8 lg:pt-10">
        {activation.metricsUnavailable ? (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-panel">
            Monitoring services are temporarily unavailable. You can review setup here and retry actions once API access is restored.
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-7">
            <div className="space-y-4">
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-ocean">Welcome to Synteq</p>
              <h1 className="max-w-[620px] text-4xl font-semibold leading-tight text-ink sm:text-5xl">
                Understand your system risk in real time
              </h1>
              <p className="max-w-[620px] text-base text-slate-600 sm:text-lg">
                Detect failures, measure impact, and prevent incidents before they escalate.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <a
                href="#connect-workflow"
                className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-ink shadow-panel transition hover:border-slate-400 sm:w-auto"
              >
                Connect your first workflow
              </a>
            </div>

            <div className="space-y-2">
              <Link href="/overview#investigation-tools" className="text-sm font-medium text-ocean hover:text-ink">
                Try with simulation
              </Link>
              <p className="text-sm text-slate-500">
                Your trial can also start automatically when real monitoring begins.
              </p>
            </div>
          </div>

          <aside className="lg:col-span-5">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-panel sm:p-6">
              <h2 className="text-lg font-semibold text-ink">How Synteq works</h2>
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Step 1</p>
                  <p className="mt-1 font-medium text-ink">Connect workflow</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Step 2</p>
                  <p className="mt-1 font-medium text-ink">Send telemetry</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Step 3</p>
                  <p className="mt-1 font-medium text-ink">Get risk insights</p>
                </div>
              </div>
              <p className="mt-4 text-sm text-slate-600">Use simulation while live monitoring is being set up.</p>
            </div>
          </aside>
        </div>

        <div className="mt-6 space-y-3">
          {params.trial === "started" ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-panel">
              Your 14-day Pro trial has started.
            </div>
          ) : null}
          {params.trial === "already_active" ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-panel">
              Pro trial is already active.
            </div>
          ) : null}
          {params.trial === "already_used" ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-panel">
              Trial has already been used for this tenant.
            </div>
          ) : null}
          {params.trial === "not_eligible" ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-panel">
              This tenant is not eligible for a trial.
            </div>
          ) : null}
          {params.trial === "error" ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-panel">
              Unable to start trial right now. Please try again.
            </div>
          ) : null}
          {params.workflow === "connected" ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-panel">
              Workflow connected. Start sending telemetry to activate live monitoring.
            </div>
          ) : null}
          {params.workflow === "invalid" ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-panel">
              Workflow name and system are required.
            </div>
          ) : null}
          {params.workflow === "error" ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-panel">
              Unable to connect workflow right now. Please try again.
            </div>
          ) : null}
        </div>

        <section className="mt-6 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Activation</p>
            <h2 className="mt-1 text-2xl font-semibold text-ink">Choose how to get started</h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
              <h3 className="text-lg font-semibold text-ink">Start Pro trial</h3>
              <p className="mt-2 text-sm text-slate-600">
                Unlock full scans, multiple workflows, and advanced risk visibility for 14 days.
              </p>
              <div className="mt-4">
                {showTrialStartCta && canManuallyStartTrial ? (
                  <form action={startTrialAction}>
                    <button className="inline-flex h-10 items-center rounded-xl bg-gradient-to-r from-ink to-ocean px-4 text-sm font-semibold text-white">
                      Start Trial
                    </button>
                  </form>
                ) : showTrialActive ? (
                  <p className="text-sm font-medium text-emerald-700">Active: {trial.days_remaining} days left</p>
                ) : showTrialEnded ? (
                  <p className="text-sm text-slate-600">Trial already consumed</p>
                ) : (
                  <p className="text-sm text-slate-600">Owner or admin can activate trial</p>
                )}
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
              <h3 className="text-lg font-semibold text-ink">Connect a workflow</h3>
              <p className="mt-2 text-sm text-slate-600">
                Set up live monitoring to begin collecting risk signals from a real system.
              </p>
              <div className="mt-4">
                <a
                  href="#connect-workflow"
                  className="inline-flex h-10 items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink hover:border-slate-400"
                >
                  Connect workflow
                </a>
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
              <h3 className="text-lg font-semibold text-ink">Run a simulation</h3>
              <p className="mt-2 text-sm text-slate-600">
                Validate detection behavior safely before live telemetry is connected.
              </p>
              <div className="mt-4">
                <Link
                  href="/overview#investigation-tools"
                  className="inline-flex h-10 items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-ink hover:border-slate-400"
                >
                  Open simulation
                </Link>
              </div>
            </article>
          </div>
        </section>

        <section id="connect-workflow" className="mt-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-panel sm:p-6">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Workflow Setup</p>
              <h2 className="mt-1 text-2xl font-semibold text-ink">Connect your first workflow</h2>
              <p className="mt-2 text-sm text-slate-600">
                Add one workflow to start live monitoring. You can run simulation while telemetry setup is pending.
              </p>
            </div>

            {canManageWorkflows ? (
              <form action={connectWorkflowAction} className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-sm text-slate-700">
                  Workflow Name
                  <input
                    type="text"
                    name="display_name"
                    required
                    placeholder="Payments Daily"
                    className="h-11 rounded-xl border border-slate-300 px-3 text-sm text-ink"
                  />
                </label>
                <label className="grid gap-1 text-sm text-slate-700">
                  System
                  <input
                    type="text"
                    name="system"
                    required
                    placeholder="checkout-service"
                    className="h-11 rounded-xl border border-slate-300 px-3 text-sm text-ink"
                  />
                </label>
                <label className="grid gap-1 text-sm text-slate-700">
                  Environment
                  <select name="environment" defaultValue="prod" className="h-11 rounded-xl border border-slate-300 px-3 text-sm text-ink">
                    <option value="prod">prod</option>
                    <option value="staging">staging</option>
                    <option value="dev">dev</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm text-slate-700">
                  Optional Slug
                  <input
                    type="text"
                    name="slug"
                    placeholder="payments-daily"
                    className="h-11 rounded-xl border border-slate-300 px-3 text-sm text-ink"
                  />
                </label>
                <div className="md:col-span-2">
                  <button className="h-11 rounded-xl bg-ocean px-5 text-sm font-semibold text-white shadow-panel transition hover:bg-ink">
                    Connect workflow
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                Owner, admin, or engineer role is required to connect workflows.
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
