import Link from "next/link";
import { TopNav } from "../../../components/top-nav";
import { fetchMe, fetchSecurityEvents } from "../../../lib/api";
import { requireToken } from "../../../lib/auth";

const eventTypes = [
  "REFRESH_REUSE_DETECTED",
  "LOGIN_FAILED",
  "LOGIN_LOCKED",
  "INVITE_RATE_LIMITED"
] as const;

type EventType = (typeof eventTypes)[number];

function asEventType(value?: string): EventType | undefined {
  if (!value) {
    return undefined;
  }

  return eventTypes.find((item) => item === value);
}

function summarizeMetadata(metadata: Record<string, unknown>) {
  const raw = JSON.stringify(metadata);
  if (raw.length <= 140) {
    return raw;
  }

  return `${raw.slice(0, 137)}...`;
}

export default async function SecuritySettingsPage({
  searchParams
}: {
  searchParams: Promise<{ type?: string; page?: string }>;
}) {
  const params = await searchParams;
  const selectedType = asEventType(params.type);
  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const token = await requireToken();
  const me = await fetchMe(token);

  if (!["owner", "admin"].includes(me.user.role)) {
    return (
      <main className="min-h-screen syn-app-shell pb-12">
        <TopNav />
        <section className="mx-auto w-full max-w-3xl px-4 pt-8">
          <div className="rounded-2xl bg-white p-6 shadow-panel">
            <h2 className="text-2xl font-semibold text-ink">Security Events</h2>
            <p className="mt-2 text-sm text-slate-600">Only owner/admin can access this page.</p>
          </div>
        </section>
      </main>
    );
  }

  const payload = await fetchSecurityEvents(token, {
    type: selectedType,
    page,
    limit: 25
  });

  return (
    <main className="min-h-screen syn-app-shell pb-12">
      <TopNav />
      <section className="mx-auto w-full max-w-6xl px-4 pt-8">
        <div className="rounded-2xl bg-white p-6 shadow-panel">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Security</p>
              <h2 className="text-2xl font-semibold text-ink">Security events</h2>
            </div>
            <form className="flex items-center gap-2" method="get">
              <select
                name="type"
                defaultValue={selectedType ?? ""}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">All types</option>
                {eventTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">Apply</button>
            </form>
          </div>

          <p className="mt-2 text-xs text-slate-500">
            Page {payload.pagination.page} of{" "}
            {Math.max(1, Math.ceil(payload.pagination.total / payload.pagination.limit))}
          </p>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2">Time</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Actor</th>
                  <th className="py-2">IP</th>
                  <th className="py-2">User Agent</th>
                  <th className="py-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {payload.events.map((event) => (
                  <tr key={event.id} className="border-b border-slate-100 align-top">
                    <td className="py-3 pr-3 whitespace-nowrap">{new Date(event.created_at).toLocaleString()}</td>
                    <td className="py-3 pr-3">{event.type}</td>
                    <td className="py-3 pr-3">
                      {event.actor ? `${event.actor.full_name} (${event.actor.email})` : "-"}
                    </td>
                    <td className="py-3 pr-3">{event.ip ?? "-"}</td>
                    <td className="py-3 pr-3 max-w-[220px] truncate">{event.user_agent ?? "-"}</td>
                    <td className="py-3 pr-3 font-mono text-xs">{summarizeMetadata(event.metadata_json)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <Link
              href={`/settings/security?page=${Math.max(1, payload.pagination.page - 1)}${
                selectedType ? `&type=${selectedType}` : ""
              }`}
              className={`rounded-lg border px-3 py-1 text-xs ${
                payload.pagination.page <= 1
                  ? "pointer-events-none border-slate-100 text-slate-300"
                  : "border-slate-300 text-slate-700"
              }`}
            >
              Previous
            </Link>
            <Link
              href={`/settings/security?page=${payload.pagination.page + 1}${
                selectedType ? `&type=${selectedType}` : ""
              }`}
              className={`rounded-lg border px-3 py-1 text-xs ${
                !payload.pagination.has_next
                  ? "pointer-events-none border-slate-100 text-slate-300"
                  : "border-slate-300 text-slate-700"
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

