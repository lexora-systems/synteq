import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { TopNav } from "../../../../components/top-nav";
import {
  createAlertChannel,
  createAlertPolicy,
  deleteAlertChannel,
  deleteAlertPolicy,
  extractApiErrorCode,
  fetchAlertChannels,
  fetchAlertPolicies,
  fetchMe,
  fetchWorkflows,
  updateAlertChannel,
  updateAlertPolicy
} from "../../../../lib/api";
import { requireToken } from "../../../../lib/auth";

type PageStatus =
  | "channel-created"
  | "channel-updated"
  | "channel-deactivated"
  | "policy-created"
  | "policy-updated"
  | "policy-deleted"
  | "upgrade"
  | "error";

function toStatusMessage(status?: string): { ok: boolean; text: string } | null {
  switch (status as PageStatus | undefined) {
    case "channel-created":
      return { ok: true, text: "Alert channel created. You'll be alerted when configured risk conditions are met." };
    case "channel-updated":
      return { ok: true, text: "Alert channel updated." };
    case "channel-deactivated":
      return { ok: true, text: "Alert channel deactivated." };
    case "policy-created":
      return { ok: true, text: "Alert policy created. Synteq is continuously monitoring this condition now." };
    case "policy-updated":
      return { ok: true, text: "Alert policy updated." };
    case "policy-deleted":
      return { ok: true, text: "Alert policy deleted." };
    case "upgrade":
      return {
        ok: false,
        text: "Alert channels are available on Pro because Synteq continuously dispatches proactive risk notifications."
      };
    case "error":
      return { ok: false, text: "Unable to process alert configuration action right now." };
    default:
      return null;
  }
}

function outcomeFromError(error: unknown): "upgrade" | "error" {
  const code = extractApiErrorCode(error);
  if (code === "UPGRADE_REQUIRED") {
    return "upgrade";
  }
  return "error";
}

async function createAlertChannelAction(formData: FormData) {
  "use server";

  const token = await requireToken();
  const type = String(formData.get("type") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const target = String(formData.get("target") ?? "").trim();

  try {
    if (type === "slack") {
      await createAlertChannel(token, { type: "slack", name, config: { webhook_url: target } });
    } else if (type === "webhook") {
      await createAlertChannel(token, { type: "webhook", name, config: { url: target } });
    } else if (type === "email") {
      await createAlertChannel(token, { type: "email", name, config: { email: target } });
    } else {
      redirect("/settings/control-plane/alerts?status=error");
    }

    revalidatePath("/settings/control-plane/alerts");
    revalidatePath("/sources");
    redirect("/settings/control-plane/alerts?status=channel-created");
  } catch (error) {
    redirect(`/settings/control-plane/alerts?status=${outcomeFromError(error)}`);
  }
}

async function toggleAlertChannelAction(formData: FormData) {
  "use server";

  const token = await requireToken();
  const channelId = String(formData.get("channel_id") ?? "");
  const nextEnabled = String(formData.get("next_enabled") ?? "") === "1";

  try {
    await updateAlertChannel(token, channelId, { is_enabled: nextEnabled });
    revalidatePath("/settings/control-plane/alerts");
    revalidatePath("/sources");
    redirect("/settings/control-plane/alerts?status=channel-updated");
  } catch (error) {
    redirect(`/settings/control-plane/alerts?status=${outcomeFromError(error)}`);
  }
}

async function deactivateAlertChannelAction(formData: FormData) {
  "use server";

  const token = await requireToken();
  const channelId = String(formData.get("channel_id") ?? "");

  try {
    await deleteAlertChannel(token, channelId);
    revalidatePath("/settings/control-plane/alerts");
    revalidatePath("/sources");
    redirect("/settings/control-plane/alerts?status=channel-deactivated");
  } catch (error) {
    redirect(`/settings/control-plane/alerts?status=${outcomeFromError(error)}`);
  }
}

async function createAlertPolicyAction(formData: FormData) {
  "use server";

  const token = await requireToken();
  const channelIds = formData
    .getAll("channel_ids")
    .map((value) => String(value))
    .filter((value) => value.length > 0);

  try {
    await createAlertPolicy(token, {
      name: String(formData.get("name") ?? "").trim(),
      metric: String(formData.get("metric") ?? "failure_rate"),
      window_sec: Number(formData.get("window_sec") ?? 300),
      threshold: Number(formData.get("threshold") ?? 0.2),
      comparator: String(formData.get("comparator") ?? "gte") as "gt" | "gte" | "lt" | "lte" | "eq",
      min_events: Number(formData.get("min_events") ?? 20),
      severity: String(formData.get("severity") ?? "high") as "warn" | "low" | "medium" | "high" | "critical",
      is_enabled: true,
      filter_workflow_id: String(formData.get("filter_workflow_id") ?? "").trim() || undefined,
      filter_env: String(formData.get("filter_env") ?? "").trim() || undefined,
      channel_ids: channelIds
    });
    revalidatePath("/settings/control-plane/alerts");
    redirect("/settings/control-plane/alerts?status=policy-created");
  } catch (error) {
    redirect(`/settings/control-plane/alerts?status=${outcomeFromError(error)}`);
  }
}

async function toggleAlertPolicyAction(formData: FormData) {
  "use server";

  const token = await requireToken();
  const policyId = String(formData.get("policy_id") ?? "");
  const nextEnabled = String(formData.get("next_enabled") ?? "") === "1";

  try {
    await updateAlertPolicy(token, policyId, { is_enabled: nextEnabled });
    revalidatePath("/settings/control-plane/alerts");
    redirect("/settings/control-plane/alerts?status=policy-updated");
  } catch (error) {
    redirect(`/settings/control-plane/alerts?status=${outcomeFromError(error)}`);
  }
}

async function deleteAlertPolicyAction(formData: FormData) {
  "use server";

  const token = await requireToken();
  const policyId = String(formData.get("policy_id") ?? "");

  try {
    await deleteAlertPolicy(token, policyId);
    revalidatePath("/settings/control-plane/alerts");
    redirect("/settings/control-plane/alerts?status=policy-deleted");
  } catch (error) {
    redirect(`/settings/control-plane/alerts?status=${outcomeFromError(error)}`);
  }
}

export default async function AlertControlPlanePage({
  searchParams
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const token = await requireToken();
  const [me, channelsPayload, policiesPayload, workflowsPayload] = await Promise.all([
    fetchMe(token),
    fetchAlertChannels(token),
    fetchAlertPolicies(token),
    fetchWorkflows(token)
  ]);
  const canManage = ["owner", "admin"].includes(me.user.role);
  const statusMessage = toStatusMessage(params.status);

  return (
    <main className="min-h-screen syn-app-shell pb-12">
      <TopNav />
      <section className="mx-auto w-full max-w-6xl px-4 pt-8">
        <div className="rounded-2xl bg-white p-6 shadow-panel">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Control Plane / Alerts</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">Alert channels and policies</h2>
          <p className="mt-2 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-slate-700">
            Immediate value: policy-driven alerts reduce manual checking and notify teams quickly when risk patterns appear.
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Configure proactive risk notifications for anomalous behavior and operational incidents.
          </p>
          <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 md:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">What Synteq receives</p>
              <p className="mt-1">Alert destination configuration and policy thresholds tied to operational signals.</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">What Synteq does NOT receive</p>
              <p className="mt-1">Inbox access, chat history access, or broad communication-platform access.</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Access model</p>
              <p className="mt-1">Event-based dispatch with signal-level context. Disable alerts anytime.</p>
            </div>
          </div>
          <div className="mt-3">
            <Link href="/settings/control-plane" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700">
              Back to control plane
            </Link>
          </div>
        </div>

        {statusMessage ? (
          <div
            className={`mt-4 rounded-2xl px-4 py-3 text-sm shadow-panel ${
              statusMessage.ok ? "border border-emerald-300/70 bg-emerald-50/95 text-emerald-800" : "border border-amber-300/70 bg-amber-50/95 text-amber-800"
            }`}
            data-testid="alerts-feedback"
          >
            {statusMessage.text}
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div className="rounded-2xl bg-white p-5 shadow-panel">
            <h3 className="text-lg font-semibold text-ink">Alert channels</h3>
            <p className="mt-1 text-sm text-slate-600">Channel types supported in this MVP: email, webhook, slack.</p>
            <p className="mt-1 text-sm text-slate-600">Disable or deactivate anytime from the right-side actions.</p>

            {canManage ? (
              <form action={createAlertChannelAction} className="mt-4 grid gap-3" data-testid="alerts-channel-create-form">
                <input
                  name="name"
                  required
                  placeholder="Ops Slack"
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  data-testid="alerts-channel-name-input"
                />
                <select name="type" defaultValue="slack" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" data-testid="alerts-channel-type-select">
                  <option value="slack">slack webhook</option>
                  <option value="webhook">generic webhook</option>
                  <option value="email">email</option>
                </select>
                <input
                  name="target"
                  required
                  placeholder="Webhook URL or destination email"
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  data-testid="alerts-channel-target-input"
                />
                <button className="w-fit rounded-lg bg-ocean px-4 py-2 text-sm font-semibold text-white" data-testid="alerts-channel-create-submit">
                  Create channel
                </button>
              </form>
            ) : (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Owner/admin role is required to manage alert channels.
              </div>
            )}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-2">Name</th>
                    <th className="py-2">Type</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Preview</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {channelsPayload.channels.map((channel) => (
                    <tr key={channel.id} className="border-b border-slate-100 align-top">
                      <td className="py-3 pr-2 text-ink">{channel.name}</td>
                      <td className="py-3 pr-2">{channel.type}</td>
                      <td className="py-3 pr-2">{channel.is_enabled ? "enabled" : "disabled"}</td>
                      <td className="py-3 pr-2 font-mono text-xs">{JSON.stringify(channel.config_preview)}</td>
                      <td className="py-3 pr-2">
                        {canManage ? (
                          <div className="flex flex-wrap gap-2">
                            <form action={toggleAlertChannelAction}>
                              <input type="hidden" name="channel_id" value={channel.id} />
                              <input type="hidden" name="next_enabled" value={channel.is_enabled ? "0" : "1"} />
                              <button className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700">
                                {channel.is_enabled ? "Disable" : "Enable"}
                              </button>
                            </form>
                            <form action={deactivateAlertChannelAction}>
                              <input type="hidden" name="channel_id" value={channel.id} />
                              <button className="rounded-lg border border-rose-300 px-2 py-1 text-xs text-rose-700">
                                Deactivate
                              </button>
                            </form>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">Read only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-panel">
            <h3 className="text-lg font-semibold text-ink">Alert policies</h3>
            <p className="mt-1 text-sm text-slate-600">Attach channels to anomaly thresholds already supported by Synteq.</p>
            <p className="mt-1 text-sm text-slate-600">
              Missing-heartbeat policies use observed heartbeat cadence when available, then fall back to configured window thresholds.
            </p>
            <p className="mt-1 text-sm text-slate-600">Disable or delete anytime from the right-side actions.</p>

            {canManage ? (
              <form action={createAlertPolicyAction} className="mt-4 grid gap-3">
                <input name="name" required placeholder="Failure rate spike" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                <div className="grid gap-3 md:grid-cols-2">
                  <select name="metric" defaultValue="failure_rate" className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <option value="failure_rate">failure_rate</option>
                    <option value="latency_p95">latency_p95</option>
                    <option value="retry_rate">retry_rate</option>
                    <option value="duplicate_rate">duplicate_rate</option>
                    <option value="cost_spike">cost_spike</option>
                    <option value="latency_drift_ewma">latency_drift_ewma</option>
                    <option value="missing_heartbeat">missing_heartbeat</option>
                  </select>
                  <select name="comparator" defaultValue="gte" className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <option value="gte">gte</option>
                    <option value="gt">gt</option>
                    <option value="lte">lte</option>
                    <option value="lt">lt</option>
                    <option value="eq">eq</option>
                  </select>
                  <input name="threshold" type="number" step="0.01" defaultValue="0.2" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  <input name="window_sec" type="number" defaultValue="300" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  <input name="min_events" type="number" defaultValue="20" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  <select name="severity" defaultValue="high" className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <option value="warn">warn</option>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="critical">critical</option>
                  </select>
                  <select name="filter_workflow_id" defaultValue="" className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <option value="">All workflows</option>
                    {workflowsPayload.workflows.map((workflow) => (
                      <option key={workflow.id} value={workflow.id}>
                        {workflow.display_name} ({workflow.environment})
                      </option>
                    ))}
                  </select>
                  <input name="filter_env" placeholder="prod (optional)" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                </div>
                <fieldset className="rounded-xl border border-slate-200 p-3">
                  <legend className="px-1 text-xs uppercase tracking-[0.2em] text-slate-500">Attach channels</legend>
                  <div className="grid gap-2">
                    {channelsPayload.channels.map((channel) => (
                      <label key={channel.id} className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" name="channel_ids" value={channel.id} />
                        {channel.name} ({channel.type}) {channel.is_enabled ? "" : "[disabled]"}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <button className="w-fit rounded-lg bg-ocean px-4 py-2 text-sm font-semibold text-white">Create policy</button>
              </form>
            ) : (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Owner/admin role is required to manage alert policies.
              </div>
            )}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[700px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-2">Name</th>
                    <th className="py-2">Metric</th>
                    <th className="py-2">Threshold</th>
                    <th className="py-2">Severity</th>
                    <th className="py-2">Channels</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {policiesPayload.policies.map((policy) => (
                    <tr key={policy.id} className="border-b border-slate-100 align-top">
                      <td className="py-3 pr-2 text-ink">
                        {policy.name}
                        <div className="text-xs text-slate-500">{policy.is_enabled ? "enabled" : "disabled"}</div>
                      </td>
                      <td className="py-3 pr-2">{policy.metric}</td>
                      <td className="py-3 pr-2">
                        {policy.comparator} {policy.threshold}
                      </td>
                      <td className="py-3 pr-2">{policy.severity}</td>
                      <td className="py-3 pr-2">{policy.channels.map((channel) => channel.name).join(", ") || "-"}</td>
                      <td className="py-3 pr-2">
                        {canManage ? (
                          <div className="flex flex-wrap gap-2">
                            <form action={toggleAlertPolicyAction}>
                              <input type="hidden" name="policy_id" value={policy.id} />
                              <input type="hidden" name="next_enabled" value={policy.is_enabled ? "0" : "1"} />
                              <button className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700">
                                {policy.is_enabled ? "Disable" : "Enable"}
                              </button>
                            </form>
                            <form action={deleteAlertPolicyAction}>
                              <input type="hidden" name="policy_id" value={policy.id} />
                              <button className="rounded-lg border border-rose-300 px-2 py-1 text-xs text-rose-700">
                                Delete
                              </button>
                            </form>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">Read only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
