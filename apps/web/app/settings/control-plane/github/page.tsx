import Link from "next/link";
import { cookies } from "next/headers";
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
  isApiContractError,
  isApiRequestError,
  rotateGitHubIntegrationSecret
} from "../../../../lib/api";
import { requireToken } from "../../../../lib/auth";

const GITHUB_SECRET_FLASH_COOKIE = "synteq_github_secret_flash";
const GITHUB_SECRET_FLASH_SEEN_COOKIE = "synteq_github_secret_flash_seen";

type GitHubSecretRevealKind = "created" | "rotated";

type GitHubSecretFlashPayload = {
  message: string;
  webhook_url: string;
  webhook_secret: string;
  reveal_kind: GitHubSecretRevealKind;
};

function encodeGitHubSecretFlash(payload: GitHubSecretFlashPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeGitHubSecretFlash(raw: string | undefined): GitHubSecretFlashPayload | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<GitHubSecretFlashPayload>;
    if (
      typeof parsed.message !== "string" ||
      typeof parsed.webhook_url !== "string" ||
      typeof parsed.webhook_secret !== "string"
    ) {
      return null;
    }

    return {
      message: parsed.message,
      webhook_url: parsed.webhook_url,
      webhook_secret: parsed.webhook_secret,
      reveal_kind: parsed.reveal_kind === "rotated" ? "rotated" : "created"
    };
  } catch {
    return null;
  }
}

async function setGitHubSecretFlash(payload: GitHubSecretFlashPayload) {
  const cookieStore = await cookies();
  cookieStore.set(GITHUB_SECRET_FLASH_COOKIE, encodeGitHubSecretFlash(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/settings/control-plane/github",
    maxAge: 120
  });
  cookieStore.delete(GITHUB_SECRET_FLASH_SEEN_COOKIE);
}

async function clearGitHubSecretFlash() {
  const cookieStore = await cookies();
  cookieStore.delete(GITHUB_SECRET_FLASH_COOKIE);
  cookieStore.delete(GITHUB_SECRET_FLASH_SEEN_COOKIE);
}

function toActionErrorLogFields(error: unknown): Record<string, string | number | null> {
  if (isApiRequestError(error)) {
    return {
      error_type: error.name,
      path: error.path,
      status: error.status,
      code: error.code,
      kind: error.kind,
      request_id: error.requestId
    };
  }

  if (isApiContractError(error)) {
    return {
      error_type: error.name,
      path: error.path,
      status: null,
      code: error.contract,
      kind: "contract",
      request_id: null
    };
  }

  if (error instanceof Error) {
    return {
      error_type: error.name,
      path: null,
      status: null,
      code: null,
      kind: "unknown",
      request_id: null
    };
  }

  return {
    error_type: "UnknownError",
    path: null,
    status: null,
    code: null,
    kind: "unknown",
    request_id: null
  };
}

function logGitHubActionFailure(action: string, error: unknown) {
  console.error("github.integration.action_failed", {
    action,
    ...toActionErrorLogFields(error)
  });
}

function toFailureMessage(error: unknown): string {
  if (isApiContractError(error)) {
    if (error.path.includes("/rotate-secret")) {
      return "Rotate secret failed because API response did not include a usable one-time webhook secret.";
    }
    return "GitHub integration API response was malformed. Retry after deploying matching web/API revisions.";
  }

  if (isApiRequestError(error)) {
    if (error.path.includes("/rotate-secret")) {
      if (error.status === 401) {
        return "Session expired while rotating secret. Sign in again and retry.";
      }
      if (error.status === 403 || error.code === "FORBIDDEN_PERMISSION") {
        return "Only owner/admin can manage GitHub integrations.";
      }
      if (error.status === 404) {
        return "Integration not found for this workspace. Refresh and retry.";
      }
      if (error.kind === "network") {
        return "Rotate secret failed due to network/API connectivity. No new one-time secret was displayed.";
      }
      if (error.kind === "invalid_json") {
        return "Rotate secret failed because API returned an unreadable response payload.";
      }
      if ((error.status ?? 0) >= 500) {
        return "Rotate secret failed because API returned a server error. No new one-time secret was displayed.";
      }
      return "Rotate secret failed. No new one-time secret was displayed.";
    }
  }

  if (!(error instanceof Error)) {
    return "Unable to process GitHub integration action.";
  }

  if (error.message.includes("API /v1/control-plane/github-integrations/") && error.message.includes("/deactivate")) {
    if (error.message.includes("401")) {
      return "Session expired while deactivating integration. Sign in again and retry.";
    }
    if (error.message.includes("404")) {
      return "Integration not found for this workspace. Refresh and retry.";
    }
    if (error.message.includes("Route POST:")) {
      return "Deactivation endpoint is unavailable on the API service. Deploy the latest API revision and retry.";
    }
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
      try {
        const list = await fetchGitHubIntegrations(token);
        const message = "GitHub integration created. Synteq is now ready to monitor incoming GitHub workflow signals from this webhook.";
        await setGitHubSecretFlash({
          message,
          webhook_url: created.webhook_url,
          webhook_secret: created.webhook_secret,
          reveal_kind: "created"
        });
        return {
          ok: true,
          message,
          webhook_url: created.webhook_url,
          integrations: list.integrations,
          latest_secret: created.webhook_secret,
          latest_secret_kind: "created"
        };
      } catch {
        const message =
          "Integration created successfully. Copy the webhook secret now. Integration list refresh failed, so some status data may be temporarily stale.";
        await setGitHubSecretFlash({
          message,
          webhook_url: created.webhook_url,
          webhook_secret: created.webhook_secret,
          reveal_kind: "created"
        });
        return {
          ok: true,
          message,
          webhook_url: created.webhook_url,
          integrations: [created.integration, ...state.integrations.filter((item) => item.id !== created.integration.id)],
          latest_secret: created.webhook_secret,
          latest_secret_kind: "created"
        };
      }
    }

    if (intent === "deactivate") {
      const id = String(formData.get("id") ?? "");
      if (!id) {
        await clearGitHubSecretFlash();
        return {
          ...state,
          ok: false,
          message: "Missing integration id.",
          latest_secret: null,
          latest_secret_kind: null
        };
      }
      let deactivated: Awaited<ReturnType<typeof deactivateGitHubIntegration>> | null = null;
      try {
        deactivated = await deactivateGitHubIntegration(token, id);
      } catch (error) {
        // If the API mutated successfully but the initial response failed, recover from a fresh read.
        try {
          const list = await fetchGitHubIntegrations(token);
          const recovered = list.integrations.find((integration) => integration.id === id);
          if (recovered && !recovered.is_active) {
            await clearGitHubSecretFlash();
            return {
              ok: true,
              message: "GitHub integration deactivated. Synteq will stop watching events from this webhook.",
              webhook_url: list.webhook_url,
              integrations: list.integrations,
              latest_secret: null,
              latest_secret_kind: null
            };
          }
        } catch {
          // Fall through to the standard failure message below.
        }
        throw error;
      }
      if (!deactivated) {
        throw new Error("Deactivation response missing");
      }
      try {
        const list = await fetchGitHubIntegrations(token);
        await clearGitHubSecretFlash();
        return {
          ok: true,
          message: "GitHub integration deactivated. Synteq will stop watching events from this webhook.",
          webhook_url: list.webhook_url,
          integrations: list.integrations,
          latest_secret: null,
          latest_secret_kind: null
        };
      } catch {
        await clearGitHubSecretFlash();
        return {
          ok: true,
          message:
            "GitHub integration deactivated successfully. Integration list refresh failed, so some status data may be temporarily stale.",
          webhook_url: state.webhook_url,
          integrations: state.integrations.map((integration) =>
            integration.id === deactivated.integration.id ? deactivated.integration : integration
          ),
          latest_secret: null,
          latest_secret_kind: null
        };
      }
    }

    if (intent === "rotate") {
      const id = String(formData.get("id") ?? "");
      if (!id) {
        await clearGitHubSecretFlash();
        return {
          ...state,
          ok: false,
          message: "Missing integration id.",
          latest_secret: null,
          latest_secret_kind: null
        };
      }
      let rotated: Awaited<ReturnType<typeof rotateGitHubIntegrationSecret>> | null = null;
      try {
        rotated = await rotateGitHubIntegrationSecret(token, id);
      } catch (error) {
        logGitHubActionFailure("rotate", error);
        await clearGitHubSecretFlash();
        return {
          ...state,
          ok: false,
          message: toFailureMessage(error),
          latest_secret: null,
          latest_secret_kind: null
        };
      }
      if (!rotated || !rotated.webhook_secret || rotated.webhook_secret.trim().length === 0) {
        console.error("github.integration.action_failed", {
          action: "rotate",
          error_type: "RotateSecretMissingInResponse",
          path: "/v1/control-plane/github-integrations/:id/rotate-secret",
          status: 200,
          code: "github_rotate_secret_response_missing_secret",
          kind: "contract",
          request_id: null
        });
        await clearGitHubSecretFlash();
        return {
          ...state,
          ok: false,
          message: "Rotate secret failed because API response did not include a usable one-time webhook secret.",
          latest_secret: null,
          latest_secret_kind: null
        };
      }
      try {
        const list = await fetchGitHubIntegrations(token);
        const message = "Webhook secret rotated. Update GitHub webhook settings so Synteq can keep monitoring without interruption.";
        await setGitHubSecretFlash({
          message,
          webhook_url: rotated.webhook_url,
          webhook_secret: rotated.webhook_secret,
          reveal_kind: "rotated"
        });
        return {
          ok: true,
          message,
          webhook_url: rotated.webhook_url,
          integrations: list.integrations,
          latest_secret: rotated.webhook_secret,
          latest_secret_kind: "rotated"
        };
      } catch {
        const message =
          "Secret rotated successfully. Copy it now. Integration list refresh failed, so some status data may be temporarily stale.";
        await setGitHubSecretFlash({
          message,
          webhook_url: rotated.webhook_url,
          webhook_secret: rotated.webhook_secret,
          reveal_kind: "rotated"
        });
        return {
          ok: true,
          message,
          webhook_url: rotated.webhook_url,
          integrations: state.integrations.map((integration) =>
            integration.id === rotated.integration.id ? rotated.integration : integration
          ),
          latest_secret: rotated.webhook_secret,
          latest_secret_kind: "rotated"
        };
      }
    }

    await clearGitHubSecretFlash();
    return {
      ...state,
      ok: false,
      message: "Unknown GitHub integration action.",
      latest_secret: null,
      latest_secret_kind: null
    };
  } catch (error) {
    logGitHubActionFailure("manage", error);
    await clearGitHubSecretFlash();
    return {
      ...state,
      ok: false,
      message: toFailureMessage(error),
      latest_secret: null,
      latest_secret_kind: null
    };
  }
}

export default async function GitHubIntegrationsControlPlanePage() {
  const cookieStore = await cookies();
  const flashPayload = decodeGitHubSecretFlash(cookieStore.get(GITHUB_SECRET_FLASH_COOKIE)?.value);
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
            initialState={{
              ok: true,
              message: flashPayload?.message ?? null,
              webhook_url: flashPayload?.webhook_url ?? payload.webhook_url,
              integrations: payload.integrations,
              latest_secret: flashPayload?.webhook_secret ?? null,
              latest_secret_kind: flashPayload?.reveal_kind ?? null
            }}
            canManage={canManage}
            action={manageGitHubIntegrationsAction}
          />
        </div>
      </section>
    </main>
  );
}
