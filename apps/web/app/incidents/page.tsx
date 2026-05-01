import { revalidatePath } from "next/cache";
import Link from "next/link";
import { TopNav } from "../../components/top-nav";
import {
  fetchIncidentAttentionGroups,
  fetchIncidents,
  postIncidentAction,
  type IncidentAttentionGroup
} from "../../lib/api";
import { requireToken } from "../../lib/auth";

async function ackAction(formData: FormData) {
  "use server";
  const incidentId = String(formData.get("incident_id") ?? "");
  const token = await requireToken();
  if (!incidentId) return;
  await postIncidentAction(token, incidentId, "ack");
  revalidatePath("/incidents");
}

async function resolveAction(formData: FormData) {
  "use server";
  const incidentId = String(formData.get("incident_id") ?? "");
  const token = await requireToken();
  if (!incidentId) return;
  await postIncidentAction(token, incidentId, "resolve");
  revalidatePath("/incidents");
}

function simulationBadge(details: Record<string, unknown>) {
  const source = details.source;
  const syntheticRatio = Number(details.synthetic_ratio ?? 0);
  return source === "simulation" || syntheticRatio > 0;
}

function formatDateTime(value: string | null) {
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

function formatToken(value: string) {
  return value.replace(/_/g, " ");
}

function attentionBadgeClass(attention: IncidentAttentionGroup["attention"]) {
  if (attention === "urgent") {
    return "bg-rose-100 text-rose-700";
  }
  if (attention === "elevated") {
    return "bg-amber-100 text-amber-800";
  }
  if (attention === "normal") {
    return "bg-emerald-100 text-emerald-700";
  }
  return "bg-slate-100 text-slate-700";
}

function severityBadgeClass(severity: IncidentAttentionGroup["highestSeverity"] | string) {
  if (severity === "critical" || severity === "high") {
    return "bg-rose-50 text-rose-700";
  }
  if (severity === "medium") {
    return "bg-amber-50 text-amber-800";
  }
  return "bg-slate-100 text-slate-700";
}

export default async function IncidentsPage({
  searchParams
}: {
  searchParams: Promise<{ page?: string; status?: string; workflow_id?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const status = params.status;
  const workflowId = params.workflow_id;
  const token = await requireToken();
  const [payload, attentionResult] = await Promise.all([
    fetchIncidents(token, status, page, 25, workflowId),
    fetchIncidentAttentionGroups(token)
      .then((attentionPayload) => ({ ok: true as const, payload: attentionPayload }))
      .catch(() => ({ ok: false as const }))
  ]);
  const attentionGroups = attentionResult.ok ? attentionResult.payload.groups.slice(0, 6) : [];
  const hiddenAttentionGroups = attentionResult.ok ? Math.max(0, attentionResult.payload.groups.length - attentionGroups.length) : 0;
  const hasIncidentFilters = Boolean(status || workflowId);

  return (
    <main className="min-h-screen syn-app-shell pb-12">
      <TopNav />
      <section className="mx-auto w-full max-w-6xl px-4 pt-8">
        <div className="rounded-2xl bg-white p-6 shadow-panel">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Incidents</p>
              <h2 className="text-2xl font-semibold text-ink">Incident queue</h2>
            </div>
            <p className="text-sm text-slate-500">Last updated: {new Date(payload.last_updated).toLocaleString()}</p>
          </div>

          {workflowId ? (
            <p className="mt-2 text-xs text-slate-500">
              Filtered by workflow <strong>{workflowId}</strong>
            </p>
          ) : null}

          <p className="mt-2 text-xs text-slate-500">
            Page {payload.pagination.page} of {Math.max(1, Math.ceil(payload.pagination.total / payload.pagination.page_size))}
          </p>

          <div className="mt-5 border-t border-slate-200 pt-5" data-testid="attention-groups-section">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Attention groups</p>
                <h3 className="mt-1 text-lg font-semibold text-ink">Active operational context</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Groups summarize active incident pressure across the workspace.
                  {hasIncidentFilters ? " The incident table below is filtered; these groups remain workspace-wide." : ""}
                </p>
              </div>
              {attentionResult.ok ? (
                <p className="text-xs text-slate-500">Generated {formatDateTime(attentionResult.payload.generatedAt)}</p>
              ) : null}
            </div>

            {!attentionResult.ok ? (
              <p className="mt-3 border-l-4 border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Attention groups are temporarily unavailable. The incident queue below is still current.
              </p>
            ) : attentionGroups.length === 0 ? (
              <p className="mt-3 border-l-4 border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                No active attention groups.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="py-2">Group</th>
                      <th className="py-2">Attention</th>
                      <th className="py-2">Incidents</th>
                      <th className="py-2">Highest severity</th>
                      <th className="py-2">Last seen</th>
                      <th className="py-2">Alert failures</th>
                      <th className="py-2">Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attentionGroups.map((group) => (
                      <tr key={group.id} className="border-b border-slate-100 align-top">
                        <td className="py-3 pr-3">
                          <p className="font-medium text-ink">{group.label}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {[group.groupKey.source, group.groupKey.system, group.groupKey.ruleKey, group.groupKey.environment]
                              .filter(Boolean)
                              .join(" / ") || "Derived from active incident metadata"}
                          </p>
                        </td>
                        <td className="py-3 pr-3">
                          <span className={`rounded-full px-2 py-1 text-xs font-semibold uppercase tracking-wide ${attentionBadgeClass(group.attention)}`}>
                            {formatToken(group.attention)}
                          </span>
                        </td>
                        <td className="py-3 pr-3">{group.incidentCount}</td>
                        <td className="py-3 pr-3">
                          <span className={`rounded-full px-2 py-1 text-xs uppercase tracking-wide ${severityBadgeClass(group.highestSeverity)}`}>
                            {formatToken(group.highestSeverity)}
                          </span>
                        </td>
                        <td className="py-3 pr-3">{formatDateTime(group.lastSeenAt)}</td>
                        <td className="py-3 pr-3">{group.alertFailureCount}</td>
                        <td className="py-3 pr-3">
                          {group.activeStatuses.open} open / {group.activeStatuses.acked} acked
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {hiddenAttentionGroups > 0 ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Showing 6 groups. {hiddenAttentionGroups} additional active group{hiddenAttentionGroups === 1 ? "" : "s"} available.
                  </p>
                ) : null}
              </div>
            )}
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2">Summary</th>
                  <th className="py-2">Severity</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Workflow</th>
                  <th className="py-2">Started</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {payload.incidents.length > 0 ? (
                  payload.incidents.map((incident) => {
                    const id = String(incident.id);
                    const incidentStatus = String(incident.status);
                    return (
                      <tr key={id} className="border-b border-slate-100 align-top">
                        <td className="py-3 pr-3 text-ink">
                          <p className="flex items-center gap-2">
                            <span>{incident.summary}</span>
                            {simulationBadge(incident.details_json) ? (
                              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
                                Simulation
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {incident.guidance.incident_type.replaceAll("_", " ")} - confidence {incident.guidance.confidence}
                          </p>
                        </td>
                        <td className="py-3 pr-3">
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs uppercase tracking-wide text-slate-700">
                            {String(incident.severity)}
                          </span>
                        </td>
                        <td className="py-3 pr-3">{incidentStatus}</td>
                        <td className="py-3 pr-3">{String(incident.workflow_id ?? "-")}</td>
                        <td className="py-3 pr-3">{new Date(String(incident.started_at)).toLocaleString()}</td>
                        <td className="py-3">
                          <div className="flex gap-2">
                            <form action={ackAction}>
                              <input type="hidden" name="incident_id" value={id} />
                              <button
                                className="rounded-lg border border-amber-300 px-2 py-1 text-xs text-amber-700"
                                disabled={incidentStatus !== "open"}
                              >
                                Ack
                              </button>
                            </form>
                            <form action={resolveAction}>
                              <input type="hidden" name="incident_id" value={id} />
                              <button
                                className="rounded-lg border border-mint px-2 py-1 text-xs text-mint"
                                disabled={incidentStatus === "resolved"}
                              >
                                Resolve
                              </button>
                            </form>
                            <Link href={`/incidents/${id}`} className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700">
                              Details
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="py-6 text-sm text-slate-600">
                      No incidents match the current view.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <Link
              href={`/incidents?page=${Math.max(1, payload.pagination.page - 1)}${status ? `&status=${status}` : ""}${
                workflowId ? `&workflow_id=${workflowId}` : ""
              }`}
              className={`rounded-lg border px-3 py-1 text-xs ${
                payload.pagination.page <= 1 ? "pointer-events-none border-slate-100 text-slate-300" : "border-slate-300 text-slate-700"
              }`}
            >
              Previous
            </Link>
            <Link
              href={`/incidents?page=${payload.pagination.page + 1}${status ? `&status=${status}` : ""}${
                workflowId ? `&workflow_id=${workflowId}` : ""
              }`}
              className={`rounded-lg border px-3 py-1 text-xs ${
                !payload.pagination.has_next ? "pointer-events-none border-slate-100 text-slate-300" : "border-slate-300 text-slate-700"
              }`}
            >
              Next
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
