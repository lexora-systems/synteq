import Link from "next/link";
import { TopNav } from "../../../../components/top-nav";
import {
  GitHubIntegrationsManager,
  type GitHubIntegrationsActionState
} from "../../../../components/control-plane/github-integrations-manager";
import {
  createGitHubIntegration,
  deactivateGitHubIntegration,
  fetchGitHubIntegrations,
  fetchMe,
  rotateGitHubIntegrationSecret
} from "../../../../lib/api";
import { requireToken } from "../../../../lib/auth";

function toFailureMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unable to process GitHub integration action.";
  }

  if (error.message.includes("FORBIDDEN_PERMISSION")) {
    return "Only owner/admin can manage GitHub integrations.";
  }

  return "Unable to process GitHub integration action.";
}

async function manageGitHubIntegrationsAction(
  state: GitHubIntegrationsActionState,
  formData: FormData
): Promise<GitHubIntegrationsActionState> {
  "use server";

  const token = await requireToken();
  const intent = String(formData.get("intent") ?? "");

  try {
    if (intent === "create") {
      const repositoryFullNameRaw = String(formData.get("repository_full_name") ?? "").trim();
      const created = await createGitHubIntegration(token, repositoryFullNameRaw || undefined);
      const list = await fetchGitHubIntegrations(token);
      return {
        ok: true,
        message: "GitHub integration created. Synteq is now ready to monitor incoming GitHub workflow signals from this webhook.",
        webhook_url: created.webhook_url,
        integrations: list.integrations,
        latest_secret: created.webhook_secret
      };
    }

    if (intent === "deactivate") {
      const id = String(formData.get("id") ?? "");
      if (!id) {
        return {
          ...state,
          ok: false,
          message: "Missing integration id.",
          latest_secret: null
        };
      }
      await deactivateGitHubIntegration(token, id);
      const list = await fetchGitHubIntegrations(token);
      return {
        ok: true,
        message: "GitHub integration deactivated. Synteq will stop watching events from this webhook.",
        webhook_url: list.webhook_url,
        integrations: list.integrations,
        latest_secret: null
      };
    }

    if (intent === "rotate") {
      const id = String(formData.get("id") ?? "");
      if (!id) {
        return {
          ...state,
          ok: false,
          message: "Missing integration id.",
          latest_secret: null
        };
      }
      const rotated = await rotateGitHubIntegrationSecret(token, id);
      const list = await fetchGitHubIntegrations(token);
      return {
        ok: true,
        message: "Webhook secret rotated. Update GitHub webhook settings so Synteq can keep monitoring without interruption.",
        webhook_url: rotated.webhook_url,
        integrations: list.integrations,
        latest_secret: rotated.webhook_secret
      };
    }

    return {
      ...state,
      ok: false,
      message: "Unknown GitHub integration action.",
      latest_secret: null
    };
  } catch (error) {
    return {
      ...state,
      ok: false,
      message: toFailureMessage(error),
      latest_secret: null
    };
  }
}

export default async function GitHubIntegrationsControlPlanePage() {
  const token = await requireToken();
  const [me, payload] = await Promise.all([fetchMe(token), fetchGitHubIntegrations(token)]);
  const canManage = ["owner", "admin"].includes(me.user.role);

  return (
    <main className="min-h-screen syn-app-shell pb-12">
      <TopNav />
      <section className="mx-auto w-full max-w-6xl px-4 pt-8">
        <div className="rounded-2xl bg-white p-6 shadow-panel">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Control Plane / GitHub</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">GitHub integrations</h2>
          <p className="mt-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-slate-700">
            Immediate value: GitHub workflow signals feed earlier anomaly detection and proactive incident alerts.
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Register tenant-scoped webhook integrations to ingest supported GitHub Actions operational events.
          </p>
          <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 md:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">What Synteq receives</p>
              <p className="mt-1">Repository identity plus workflow/job/run status, conclusion, timing, and attempt metadata.</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">What Synteq does NOT receive</p>
              <p className="mt-1">Repository contents, source code, artifact contents, full build logs, or secrets by default.</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Access model</p>
              <p className="mt-1">Webhook signature verification with a shared secret. Secret is for auth only, not analyzed as signal data.</p>
            </div>
          </div>
          <div className="mt-3">
            <Link href="/settings/control-plane" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700">
              Back to control plane
            </Link>
          </div>
        </div>

        <div className="mt-4">
          <GitHubIntegrationsManager
            initialWebhookUrl={payload.webhook_url}
            initialIntegrations={payload.integrations}
            canManage={canManage}
            action={manageGitHubIntegrationsAction}
          />
        </div>
      </section>
    </main>
  );
}
