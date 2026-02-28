import { revalidatePath } from "next/cache";
import Link from "next/link";
import { TopNav } from "../../components/top-nav";
import { fetchIncidents, postIncidentAction } from "../../lib/api";
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

export default async function IncidentsPage({
  searchParams
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const status = params.status;
  const token = await requireToken();
  const payload = await fetchIncidents(token, status, page, 25);

  return (
    <main className="min-h-screen bg-cloud pb-12">
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

          <p className="mt-2 text-xs text-slate-500">
            Page {payload.pagination.page} of {Math.max(1, Math.ceil(payload.pagination.total / payload.pagination.page_size))}
          </p>

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
                {payload.incidents.map((incident) => {
                  const id = String(incident.id);
                  const status = String(incident.status);
                  return (
                    <tr key={id} className="border-b border-slate-100 align-top">
                      <td className="py-3 pr-3 text-ink">{String(incident.summary)}</td>
                      <td className="py-3 pr-3">
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs uppercase tracking-wide text-slate-700">
                          {String(incident.severity)}
                        </span>
                      </td>
                      <td className="py-3 pr-3">{status}</td>
                      <td className="py-3 pr-3">{String(incident.workflow_id ?? "-")}</td>
                      <td className="py-3 pr-3">{new Date(String(incident.started_at)).toLocaleString()}</td>
                      <td className="py-3">
                        <div className="flex gap-2">
                          <form action={ackAction}>
                            <input type="hidden" name="incident_id" value={id} />
                            <button className="rounded-lg border border-amber-300 px-2 py-1 text-xs text-amber-700" disabled={status !== "open"}>
                              Ack
                            </button>
                          </form>
                          <form action={resolveAction}>
                            <input type="hidden" name="incident_id" value={id} />
                            <button className="rounded-lg border border-mint px-2 py-1 text-xs text-mint" disabled={status === "resolved"}>
                              Resolve
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <Link
              href={`/incidents?page=${Math.max(1, payload.pagination.page - 1)}${status ? `&status=${status}` : ""}`}
              className={`rounded-lg border px-3 py-1 text-xs ${
                payload.pagination.page <= 1 ? "pointer-events-none border-slate-100 text-slate-300" : "border-slate-300 text-slate-700"
              }`}
            >
              Previous
            </Link>
            <Link
              href={`/incidents?page=${payload.pagination.page + 1}${status ? `&status=${status}` : ""}`}
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
