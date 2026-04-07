import Link from "next/link";
import { TopNav } from "../../../../components/top-nav";
import { ApiKeysManager, type ApiKeysActionState } from "../../../../components/control-plane/api-keys-manager";
import { createApiKey, fetchApiKeys, fetchMe, revokeApiKey, rotateApiKey } from "../../../../lib/api";
import { requireToken } from "../../../../lib/auth";

function toFailureMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unable to process API key action right now.";
  }

  if (error.message.includes("FORBIDDEN_PERMISSION")) {
    return "Only owner/admin can manage ingestion API keys.";
  }

  return "Unable to process API key action right now.";
}

async function manageApiKeysAction(state: ApiKeysActionState, formData: FormData): Promise<ApiKeysActionState> {
  "use server";

  const token = await requireToken();
  const intent = String(formData.get("intent") ?? "");

  try {
    if (intent === "create") {
      const name = String(formData.get("name") ?? "").trim();
      if (!name) {
        return {
          ...state,
          ok: false,
          message: "Key label is required.",
          latest_secret: null
        };
      }
      const created = await createApiKey(token, name);
      const nextList = await fetchApiKeys(token);
      return {
        ok: true,
        message: `API key "${created.api_key.name}" created. Synteq is now ready to watch execution and heartbeat signals sent with this key.`,
        api_keys: nextList.api_keys,
        latest_secret: created.secret,
        latest_secret_name: created.api_key.name
      };
    }

    if (intent === "revoke") {
      const id = String(formData.get("id") ?? "");
      if (!id) {
        return {
          ...state,
          ok: false,
          message: "Missing API key id.",
          latest_secret: null
        };
      }
      await revokeApiKey(token, id);
      const nextList = await fetchApiKeys(token);
      return {
        ok: true,
        message: "API key revoked. Synteq will stop accepting new signals from that key immediately.",
        api_keys: nextList.api_keys,
        latest_secret: null,
        latest_secret_name: null
      };
    }

    if (intent === "rotate") {
      const id = String(formData.get("id") ?? "");
      if (!id) {
        return {
          ...state,
          ok: false,
          message: "Missing API key id.",
          latest_secret: null
        };
      }
      const rotated = await rotateApiKey(token, id);
      const nextList = await fetchApiKeys(token);
      return {
        ok: true,
        message: `API key "${rotated.api_key.name}" rotated. Synteq will continue monitoring once senders use the new key.`,
        api_keys: nextList.api_keys,
        latest_secret: rotated.secret,
        latest_secret_name: rotated.api_key.name
      };
    }

    return {
      ...state,
      ok: false,
      message: "Unknown API key action.",
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

export default async function ApiKeysControlPlanePage() {
  const token = await requireToken();
  const [me, keysPayload] = await Promise.all([fetchMe(token), fetchApiKeys(token)]);
  const canManage = ["owner", "admin"].includes(me.user.role);

  return (
    <main className="min-h-screen syn-app-shell pb-12">
      <TopNav />
      <section className="mx-auto w-full max-w-6xl px-4 pt-8">
        <div className="rounded-2xl bg-white p-6 shadow-panel">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Control Plane / API Keys</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">Ingestion API keys</h2>
          <p className="mt-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-slate-700">
            Immediate value: stable ingestion keys keep detection and alerting continuous, even as your pipelines scale.
          </p>
          <p className="mt-2 text-sm text-slate-600">
            API keys authenticate execution, heartbeat, and operational event ingestion into Synteq.
          </p>
          <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 md:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">What Synteq receives</p>
              <p className="mt-1">Operational signal metadata such as status, timing, retries, and workflow identifiers.</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">What Synteq does NOT receive</p>
              <p className="mt-1">Interactive system access, source code, full logs, artifact contents, or customer secrets by default.</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Access model</p>
              <p className="mt-1">API key authentication for event ingestion. Keys authenticate senders and are not used as analysis data.</p>
            </div>
          </div>
          <div className="mt-3">
            <Link href="/settings/control-plane" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700">
              Back to control plane
            </Link>
          </div>
        </div>

        <div className="mt-4">
          <ApiKeysManager initialApiKeys={keysPayload.api_keys} canManage={canManage} action={manageApiKeysAction} />
        </div>
      </section>
    </main>
  );
}
