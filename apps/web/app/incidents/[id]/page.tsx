import Link from "next/link";
import { revalidatePath } from "next/cache";
import { TopNav } from "../../../components/top-nav";
import { fetchIncidentById, fetchMe, postIncidentAction } from "../../../lib/api";
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
  const [payload, me] = await Promise.all([fetchIncidentById(token, id), fetchMe(token)]);
  const incident = payload.incident;
  const guidance = incident.guidance;
  const canWriteIncident = me.user.role !== "viewer";
  const details = incident.details_json ?? {};
  const isSimulation = details.source === "simulation" || Number(details.synthetic_ratio ?? 0) > 0;

  return (
    <main className="min-h-screen bg-cloud pb-12">
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
