import Link from "next/link";
import { revalidatePath } from "next/cache";
import { TopNav } from "../../../components/top-nav";
import {
  fetchIncidentById,
  fetchIncidentTimeline,
  fetchMe,
  postIncidentAction,
  type IncidentGuidance,
  type IncidentTimelineEntry
} from "../../../lib/api";
import { requireToken } from "../../../lib/auth";
import {
  asRecord,
  logServerLoadFailure,
  safeArray,
  safeDateString,
  safeNullableString,
  safeNumber,
  safeString
} from "../../../lib/resilience";

type IncidentDetailPayload = Awaited<ReturnType<typeof fetchIncidentById>>;
type IncidentRow = IncidentDetailPayload["incident"];
type IncidentTimelinePayload = Awaited<ReturnType<typeof fetchIncidentTimeline>>;
type DashboardRole = "owner" | "admin" | "engineer" | "viewer";
type LoadResult<T> = {
  ok: boolean;
  payload: T;
};

const INCIDENT_STATUSES: IncidentRow["status"][] = ["open", "acked", "resolved"];
const INCIDENT_SEVERITIES: IncidentRow["severity"][] = ["warn", "low", "medium", "high", "critical"];
const TIMELINE_TYPES: IncidentTimelineEntry["type"][] = [
  "incident_created",
  "incident_refreshed",
  "incident_acknowledged",
  "incident_resolved",
  "alert_pending",
  "alert_sent",
  "alert_failed",
  "finding_linked",
  "detection_event",
  "status_change",
  "unknown_event"
];
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

async function loadIncidentData<T>(
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
    logServerLoadFailure("incident_detail", scope, error);
    return {
      ok: false,
      payload: fallback
    };
  }
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

function normalizeIncidentDetailPayload(payload: unknown): IncidentDetailPayload {
  const record = asRecord(payload);
  const incident = normalizeIncident(record?.incident);
  if (!record || !incident) {
    throw new Error("Malformed incident detail payload");
  }

  return {
    incident,
    recent_events: safeArray(record.recent_events, (item) => {
      const event = asRecord(item);
      if (!event) {
        return null;
      }
      const eventId = safeString(event.id);
      const eventType = safeString(event.event_type);
      return eventId && eventType
        ? {
            id: eventId,
            event_type: eventType,
            at_time: safeDateString(event.at_time),
            summary: safeString(event.summary),
            metadata: asRecord(event.metadata) as Record<string, string | number | boolean | null> | undefined
          }
        : null;
    })
  };
}

function normalizeTimelinePayload(payload: unknown): IncidentTimelinePayload {
  const record = asRecord(payload);
  if (!record) {
    throw new Error("Malformed incident timeline payload");
  }

  return {
    incident_id: safeString(record.incident_id),
    timeline: safeArray(record.timeline, (item) => {
      const entry = asRecord(item);
      if (!entry) {
        return null;
      }
      const id = safeString(entry.id);
      if (!id) {
        return null;
      }

      return {
        id,
        at: safeDateString(entry.at),
        type: TIMELINE_TYPES.includes(entry.type as IncidentTimelineEntry["type"])
          ? (entry.type as IncidentTimelineEntry["type"])
          : "unknown_event",
        title: safeString(entry.title, "Timeline event"),
        description: safeNullableString(entry.description) ?? undefined,
        severity: safeNullableString(entry.severity) ?? undefined,
        source: safeNullableString(entry.source) ?? undefined,
        workflow: safeNullableString(entry.workflow) ?? undefined,
        environment: safeNullableString(entry.environment) ?? undefined,
        metadata: asRecord(entry.metadata) ?? undefined
      };
    })
  };
}

function confidenceClass(confidence: "low" | "medium" | "high") {
  if (confidence === "high") {
    return "bg-rose-100 text-rose-700 border-rose-200";
  }
  if (confidence === "medium") {
    return "bg-amber-100 text-amber-700 border-amber-200";
  }

  return "bg-slate-100 text-slate-700 border-slate-200";
}

function formatTimelineValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function timelineMetadataEntries(metadata: IncidentTimelineEntry["metadata"]) {
  if (!metadata) {
    return [];
  }

  const hiddenKeys = new Set(["event_type", "details", "evidence"]);
  return Object.entries(metadata)
    .filter(([key, value]) => !hiddenKeys.has(key) && ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 4);
}

function timelineContextChips(entry: IncidentTimelineEntry) {
  return [
    ["source", entry.source],
    ["workflow", entry.workflow],
    ["environment", entry.environment],
    ["severity", entry.severity]
  ].filter(([, value]) => typeof value === "string" && value.length > 0) as Array<[string, string]>;
}

function eventTypeLabel(eventType: string): string {
  return eventType.replace(/_/g, " ").toLowerCase();
}

function lifecycleEventSummary(eventType: string): string {
  if (eventType === "ALERT_PENDING") {
    return "Alert dispatch was queued.";
  }
  if (eventType === "ALERT_SENT") {
    return "Alert dispatch completed.";
  }
  if (eventType === "ALERT_FAILED") {
    return "Alert dispatch failed.";
  }
  if (eventType === "ALERT_SKIPPED") {
    return "Alert dispatch was skipped.";
  }
  if (eventType === "ACKED") {
    return "Incident was acknowledged.";
  }
  if (eventType === "RESOLVED_MANUAL" || eventType === "RESOLVED_AUTO" || eventType === "BRIDGE_RESOLVED") {
    return "Incident resolution was recorded.";
  }
  if (eventType === "BRIDGE_REFRESHED" || eventType === "DETECTED") {
    return "Detection condition was observed again.";
  }
  if (eventType === "BRIDGE_OPENED" || eventType === "BRIDGE_REOPENED" || eventType === "TRIGGERED") {
    return "Detection opened or confirmed this incident.";
  }
  if (eventType === "SLA_BREACHED" || eventType === "SEVERITY_ESCALATED") {
    return "Incident state changed.";
  }
  return "Lifecycle event recorded.";
}

async function ackAction(formData: FormData) {
  "use server";
  const incidentId = String(formData.get("incident_id") ?? "");
  const token = await requireToken();
  if (!incidentId) return;
  await postIncidentAction(token, incidentId, "ack");
  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath("/incidents");
}

async function resolveAction(formData: FormData) {
  "use server";
  const incidentId = String(formData.get("incident_id") ?? "");
  const token = await requireToken();
  if (!incidentId) return;
  await postIncidentAction(token, incidentId, "resolve");
  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath("/incidents");
}

export default async function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await requireToken();
  const [incidentResult, meResult, timelineResult] = await Promise.all([
    loadIncidentData("incident_detail", () => fetchIncidentById(token, id), null as IncidentDetailPayload | null, normalizeIncidentDetailPayload),
    fetchMe(token)
      .then((payload) => ({ ok: true as const, role: payload.user.role }))
      .catch((error) => {
        logServerLoadFailure("incident_detail", "current_user", error);
        return { ok: false as const, role: roleFromToken(token) ?? "viewer" };
      }),
    loadIncidentData(
      "incident_timeline",
      () => fetchIncidentTimeline(token, id),
      {
        incident_id: id,
        timeline: []
      },
      normalizeTimelinePayload
    )
  ]);

  if (!incidentResult.payload) {
    return (
      <main className="min-h-screen syn-app-shell pb-12">
        <TopNav />
        <section className="mx-auto w-full max-w-6xl px-4 pt-8">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900 shadow-panel" data-testid="incident-detail-load-warning">
            <p className="text-xs uppercase tracking-[0.2em] text-amber-700">Incident unavailable</p>
            <h2 className="mt-1 text-2xl font-semibold text-ink">Incident details are temporarily unavailable</h2>
            <p className="mt-2 text-sm">
              Synteq could not load this incident safely. The incident queue and other demo routes remain available.
            </p>
            <Link href="/incidents" className="mt-4 inline-flex rounded-lg border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-900">
              Back to Incident Queue
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const payload = incidentResult.payload;
  const incident = payload.incident;
  const guidance = incident.guidance;
  const canWriteIncident = meResult.role !== "viewer";
  const details = incident.details_json ?? {};
  const isSimulation = details.source === "simulation" || safeNumber(details.synthetic_ratio) > 0;
  const timeline = timelineResult.payload.timeline;

  return (
    <main className="min-h-screen syn-app-shell pb-12">
      <TopNav />
      <section className="mx-auto grid w-full max-w-6xl gap-4 px-4 pt-8 lg:grid-cols-[1.7fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-2xl bg-white p-6 shadow-panel">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Incident</p>
            <h2 className="mt-1 text-2xl font-semibold text-ink">{incident.summary}</h2>
            {isSimulation ? (
              <p className="mt-2 inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-700">
                Simulation origin
              </p>
            ) : null}
            <div className="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
              <p>Status: <strong>{incident.status}</strong></p>
              <p>Severity: <strong>{incident.severity}</strong></p>
              <p>Workflow: <strong>{incident.workflow_id ?? "-"}</strong></p>
              <p>Environment: <strong>{incident.environment ?? "-"}</strong></p>
              <p>Started: <strong>{new Date(incident.started_at).toLocaleString()}</strong></p>
              <p>Last seen: <strong>{new Date(incident.last_seen_at).toLocaleString()}</strong></p>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-panel">
            <h3 className="text-lg font-semibold text-ink">Detected issue</h3>
            <p className="mt-2 text-sm text-slate-700">{guidance.summary_text}</p>
            <div className="mt-3">
              <span className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-semibold uppercase ${confidenceClass(guidance.confidence)}`}>
                confidence {guidance.confidence}
              </span>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-panel">
            <h3 className="text-lg font-semibold text-ink">Likely cause</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {guidance.likely_causes.map((cause: string) => (
                <li key={cause}>{cause}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-panel">
            <h3 className="text-lg font-semibold text-ink">Business impact</h3>
            <p className="mt-2 text-sm text-slate-700">{guidance.business_impact}</p>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-panel">
            <h3 className="text-lg font-semibold text-ink">Recommended actions</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {guidance.recommended_actions.map((action: string) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-panel">
            <h3 className="text-lg font-semibold text-ink">Evidence</h3>
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {guidance.evidence.map((item: string) => (
                <li key={item} className="font-mono">{item}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-panel">
            <h3 className="text-lg font-semibold text-ink">Timeline</h3>
            <p className="mt-1 text-sm text-slate-600">
              Primary investigation view with sanitized incident, alert, and finding history.
            </p>
            {!timelineResult.ok ? (
              <p className="mt-2 text-sm text-amber-800">Timeline is temporarily unavailable.</p>
            ) : timeline.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">No timeline events recorded yet.</p>
            ) : (
              <ol className="mt-4 space-y-4 border-l border-slate-200 pl-4">
                {timeline.map((entry) => {
                  const contextChips = timelineContextChips(entry);
                  const metadataEntries = timelineMetadataEntries(entry.metadata);
                  return (
                    <li key={entry.id} className="relative">
                      <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border border-cyan-300 bg-white" />
                      <p className="text-xs text-slate-500">{new Date(entry.at).toLocaleString()}</p>
                      <h4 className="mt-1 text-sm font-semibold text-ink">{entry.title}</h4>
                      {entry.description ? (
                        <p className="mt-1 text-sm text-slate-600">{entry.description}</p>
                      ) : null}
                      {contextChips.length > 0 || metadataEntries.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {contextChips.map(([label, value]) => (
                            <span
                              key={`${entry.id}-${label}`}
                              className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600"
                            >
                              {label}: {value}
                            </span>
                          ))}
                          {metadataEntries.map(([key, value]) => (
                            <span
                              key={`${entry.id}-${key}`}
                              className="rounded-full border border-cyan-100 bg-cyan-50 px-2 py-0.5 text-[11px] text-cyan-800"
                            >
                              {key}: {formatTimelineValue(value)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-panel">
            <h3 className="text-lg font-semibold text-ink">Sanitized lifecycle events</h3>
            <p className="mt-1 text-sm text-slate-600">
              Raw event payloads are hidden. Use the timeline above for investigation context.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="py-2">Time</th>
                    <th className="py-2">Type</th>
                    <th className="py-2">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.recent_events.length > 0 ? (
                    payload.recent_events.map((event) => (
                      <tr key={event.id} className="border-b border-slate-100 align-top">
                        <td className="py-2 pr-3 whitespace-nowrap">{new Date(event.at_time).toLocaleString()}</td>
                        <td className="py-2 pr-3">{eventTypeLabel(event.event_type)}</td>
                        <td className="py-2 pr-3 text-slate-600">{event.summary || lifecycleEventSummary(event.event_type)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="py-4 text-sm text-slate-600">
                        No recent lifecycle events recorded.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl bg-white p-6 shadow-panel">
            <h3 className="text-lg font-semibold text-ink">What to do next</h3>
            <div className="mt-3 flex flex-col gap-2 text-sm">
              <Link href={incident.workflow_id ? `/workflows/${incident.workflow_id}` : "/overview"} className="rounded-lg border border-slate-300 px-3 py-2 text-center text-slate-700">
                Review Workflow
              </Link>
              <Link href="/settings/security" className="rounded-lg border border-slate-300 px-3 py-2 text-center text-slate-700">
                Open Security Events
              </Link>
              {canWriteIncident ? (
                <form action={ackAction}>
                  <input type="hidden" name="incident_id" value={incident.id} />
                  <button
                    className="w-full rounded-lg border border-amber-300 px-3 py-2 text-amber-700"
                    disabled={incident.status !== "open"}
                  >
                    Acknowledge Incident
                  </button>
                </form>
              ) : null}
              {canWriteIncident ? (
                <form action={resolveAction}>
                  <input type="hidden" name="incident_id" value={incident.id} />
                  <button
                    className="w-full rounded-lg border border-mint px-3 py-2 text-mint"
                    disabled={incident.status === "resolved"}
                  >
                    Resolve Incident
                  </button>
                </form>
              ) : null}
              <Link href="/incidents" className="rounded-lg border border-slate-300 px-3 py-2 text-center text-slate-700">
                Back to Incident Queue
              </Link>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
