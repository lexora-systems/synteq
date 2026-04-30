import Link from "next/link";
import { revalidatePath } from "next/cache";
import { TopNav } from "../../../components/top-nav";
import {
  fetchIncidentById,
  fetchIncidentTimeline,
  fetchMe,
  postIncidentAction,
  type IncidentTimelineEntry
} from "../../../lib/api";
import { requireToken } from "../../../lib/auth";

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
  const [payload, me, timelineResult] = await Promise.all([
    fetchIncidentById(token, id),
    fetchMe(token),
    fetchIncidentTimeline(token, id)
      .then((timelinePayload) => ({ ok: true as const, payload: timelinePayload }))
      .catch(() => ({ ok: false as const }))
  ]);
  const incident = payload.incident;
  const guidance = incident.guidance;
  const canWriteIncident = me.user.role !== "viewer";
  const details = incident.details_json ?? {};
  const isSimulation = details.source === "simulation" || Number(details.synthetic_ratio ?? 0) > 0;
  const timeline = timelineResult.ok ? timelineResult.payload.timeline : [];

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
            <h3 className="text-lg font-semibold text-ink">Recent incident events</h3>
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
                  {payload.recent_events.map((event) => (
                    <tr key={event.id} className="border-b border-slate-100 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap">{new Date(event.at_time).toLocaleString()}</td>
                      <td className="py-2 pr-3">{event.event_type}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{JSON.stringify(event.payload_json)}</td>
                    </tr>
                  ))}
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
