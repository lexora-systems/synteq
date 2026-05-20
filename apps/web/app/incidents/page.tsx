import { revalidatePath } from "next/cache";
import Link from "next/link";
import { TopNav } from "../../components/top-nav";
import {
  fetchIncidentAttentionGroups,
  fetchIncidents,
  postIncidentAction,
  type IncidentAttentionGroup,
  type IncidentGuidance
} from "../../lib/api";
import { requireToken } from "../../lib/auth";
import {
  asRecord,
  logServerLoadFailure,
  safeArray,
  safeDateString,
  safeNullableString,
  safeNumber,
  safeString
} from "../../lib/resilience";

type IncidentListPayload = Awaited<ReturnType<typeof fetchIncidents>>;
type IncidentRow = IncidentListPayload["incidents"][number];
type IncidentAttentionGroupsPayload = Awaited<ReturnType<typeof fetchIncidentAttentionGroups>>;
type LoadResult<T> = {
  ok: boolean;
  payload: T;
};

const INCIDENT_STATUSES: IncidentRow["status"][] = ["open", "acked", "resolved"];
const INCIDENT_SEVERITIES: IncidentRow["severity"][] = ["warn", "low", "medium", "high", "critical"];
const ATTENTION_STATES: IncidentAttentionGroup["attention"][] = ["urgent", "elevated", "normal", "unknown"];
const ATTENTION_SEVERITIES: IncidentAttentionGroup["highestSeverity"][] = ["critical", "high", "medium", "low", "unknown"];
const DEFAULT_GUIDANCE: IncidentGuidance = {
  incident_type: "unknown",
  likely_causes: [],
  business_impact: "Impact has not been classified yet.",
  recommended_actions: [],
  confidence: "low",
  evidence: [],
  generated_by: "rules_v1",
  summary_text: "Guidance is unavailable for this incident."
};

async function loadIncidentsData<T>(
  scope: string,
  loader: () => Promise<unknown>,
  fallback: T,
  normalize: (payload: unknown) => T
): Promise<LoadResult<T>> {
  try {
    return {
      ok: true,
      payload: normalize(await loader())
    };
  } catch (error) {
    logServerLoadFailure("incidents", scope, error);
    return {
      ok: false,
      payload: fallback
    };
  }
}

function fallbackIncidentList(page: number): IncidentListPayload {
  return {
    incidents: [],
    pagination: {
      page,
      page_size: 25,
      total: 0,
      has_next: false
    },
    last_updated: new Date().toISOString()
  };
}

function normalizeGuidance(value: unknown): IncidentGuidance {
  const guidance = asRecord(value);
  if (!guidance) {
    return DEFAULT_GUIDANCE;
  }

  const incidentType = [
    "duplicate_webhook",
    "retry_storm",
    "latency_spike",
    "failure_rate_spike",
    "missing_heartbeat",
    "cost_spike",
    "unknown"
  ].includes(guidance.incident_type as string)
    ? (guidance.incident_type as IncidentGuidance["incident_type"])
    : "unknown";
  const confidence = ["low", "medium", "high"].includes(guidance.confidence as string)
    ? (guidance.confidence as IncidentGuidance["confidence"])
    : "low";

  return {
    incident_type: incidentType,
    likely_causes: safeArray(guidance.likely_causes, (item) => safeString(item) || null),
    business_impact: safeString(guidance.business_impact, DEFAULT_GUIDANCE.business_impact),
    recommended_actions: safeArray(guidance.recommended_actions, (item) => safeString(item) || null),
    confidence,
    evidence: safeArray(guidance.evidence, (item) => safeString(item) || null),
    generated_by: "rules_v1",
    summary_text: safeString(guidance.summary_text, DEFAULT_GUIDANCE.summary_text)
  };
}

function normalizeIncident(value: unknown): IncidentRow | null {
  const incident = asRecord(value);
  if (!incident) {
    return null;
  }

  const id = safeString(incident.id);
  if (!id) {
    return null;
  }

  return {
    id,
    tenant_id: safeString(incident.tenant_id, "unknown"),
    workflow_id: safeNullableString(incident.workflow_id),
    environment: safeNullableString(incident.environment),
    policy_id: safeNullableString(incident.policy_id),
    status: INCIDENT_STATUSES.includes(incident.status as IncidentRow["status"]) ? (incident.status as IncidentRow["status"]) : "open",
    severity: INCIDENT_SEVERITIES.includes(incident.severity as IncidentRow["severity"]) ? (incident.severity as IncidentRow["severity"]) : "warn",
    started_at: safeDateString(incident.started_at),
    last_seen_at: safeDateString(incident.last_seen_at),
    resolved_at: safeNullableString(incident.resolved_at),
    summary: safeString(incident.summary, "Untitled incident"),
    details_json: asRecord(incident.details_json) ?? {},
    guidance: normalizeGuidance(incident.guidance)
  };
}

function normalizeIncidentListPayload(payload: unknown, page: number): IncidentListPayload {
  const record = asRecord(payload);
  if (!record) {
    throw new Error("Malformed incidents payload");
  }
  const pagination = asRecord(record.pagination);

  return {
    incidents: safeArray(record.incidents, normalizeIncident),
    pagination: {
      page: Math.max(1, safeNumber(pagination?.page, page)),
      page_size: Math.max(1, safeNumber(pagination?.page_size, 25)),
      total: Math.max(0, safeNumber(pagination?.total)),
      has_next: Boolean(pagination?.has_next)
    },
    last_updated: safeDateString(record.last_updated)
  };
}

function normalizeAttentionGroup(value: unknown): IncidentAttentionGroup | null {
  const group = asRecord(value);
  if (!group) {
    return null;
  }

  const id = safeString(group.id);
  const groupKey = asRecord(group.groupKey);
  const activeStatuses = asRecord(group.activeStatuses);
  if (!id) {
    return null;
  }

  return {
    id,
    label: safeString(group.label, "Unknown group"),
    attention: ATTENTION_STATES.includes(group.attention as IncidentAttentionGroup["attention"])
      ? (group.attention as IncidentAttentionGroup["attention"])
      : "unknown",
    incidentCount: safeNumber(group.incidentCount),
    highestSeverity: ATTENTION_SEVERITIES.includes(group.highestSeverity as IncidentAttentionGroup["highestSeverity"])
      ? (group.highestSeverity as IncidentAttentionGroup["highestSeverity"])
      : "unknown",
    lastSeenAt: safeNullableString(group.lastSeenAt),
    alertFailureCount: safeNumber(group.alertFailureCount),
    activeStatuses: {
      open: safeNumber(activeStatuses?.open),
      acked: safeNumber(activeStatuses?.acked)
    },
    groupKey: {
      fingerprint: safeNullableString(groupKey?.fingerprint) ?? undefined,
      workflowId: safeNullableString(groupKey?.workflowId) ?? undefined,
      workflowName: safeNullableString(groupKey?.workflowName) ?? undefined,
      source: safeNullableString(groupKey?.source) ?? undefined,
      system: safeNullableString(groupKey?.system) ?? undefined,
      environment: safeNullableString(groupKey?.environment) ?? undefined,
      ruleKey: safeNullableString(groupKey?.ruleKey) ?? undefined
    }
  };
}

function normalizeAttentionGroupsPayload(payload: unknown): IncidentAttentionGroupsPayload {
  const record = asRecord(payload);
  if (!record) {
    throw new Error("Malformed attention groups payload");
  }

  return {
    generatedAt: safeDateString(record.generatedAt),
    groups: safeArray(record.groups, normalizeAttentionGroup)
  };
}

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
  const [incidentsResult, attentionResult] = await Promise.all([
    loadIncidentsData(
      "incident_list",
      () => fetchIncidents(token, status, page, 25, workflowId),
      fallbackIncidentList(page),
      (incidentPayload) => normalizeIncidentListPayload(incidentPayload, page)
    ),
    loadIncidentsData(
      "attention_groups",
      () => fetchIncidentAttentionGroups(token),
      {
        generatedAt: new Date().toISOString(),
        groups: []
      },
      normalizeAttentionGroupsPayload
    )
  ]);
  const payload = incidentsResult.payload;
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

          {!incidentsResult.ok ? (
            <p className="mt-4 border-l-4 border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="incidents-load-warning">
              Incident data is temporarily unavailable. This route is still available for navigation.
            </p>
          ) : null}

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
