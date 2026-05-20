import { TopNav } from "../../../components/top-nav";
import { MetricsChart } from "../../../components/charts";
import { fetchOverview } from "../../../lib/api";
import { requireToken } from "../../../lib/auth";
import { asRecord, logServerLoadFailure, safeArray, safeDateString, safeNumber, safeString } from "../../../lib/resilience";

type WorkflowOverviewPayload = Awaited<ReturnType<typeof fetchOverview>>;

function fallbackOverview(): WorkflowOverviewPayload {
  return {
    summary: {},
    series: [],
    windows: {},
    last_updated: new Date().toISOString()
  };
}

function normalizeWorkflowOverview(payload: unknown): WorkflowOverviewPayload {
  const record = asRecord(payload);
  if (!record) {
    throw new Error("Malformed workflow overview payload");
  }

  return {
    summary: asRecord(record.summary) ?? {},
    series: safeArray(record.series, (item) => asRecord(item)),
    windows: asRecord(record.windows) ?? {},
    last_updated: safeDateString(record.last_updated)
  };
}

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await requireToken();
  const overviewResult = await fetchOverview(token, "24h", id)
    .then((payload) => ({ ok: true as const, payload: normalizeWorkflowOverview(payload) }))
    .catch((error) => {
      logServerLoadFailure("workflow_detail", "metrics_overview", error);
      return {
        ok: false as const,
        payload: fallbackOverview()
      };
    });
  const overview = overviewResult.payload;

  const chartData = (overview.series ?? []).map((point) => {
    const totalCount = safeNumber(point.count_total);
    return {
      bucket_ts: safeString(point.bucket_ts, new Date().toISOString()),
      success_rate: totalCount > 0 ? safeNumber(point.count_success) / totalCount : 0,
      failure_rate: totalCount > 0 ? safeNumber(point.count_failed) / totalCount : 0,
      p95_duration_ms: safeNumber(point.p95_duration_ms),
      retry_rate: safeNumber(point.retry_rate),
      duplicate_rate: safeNumber(point.duplicate_rate)
    };
  });

  return (
    <main className="min-h-screen syn-app-shell pb-12">
      <TopNav />
      <section className="mx-auto grid w-full max-w-6xl gap-4 px-4 pt-8">
        <div className="rounded-2xl bg-white p-6 shadow-panel">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Workflow</p>
          <h2 className="text-2xl font-semibold text-ink">{id}</h2>
          <p className="mt-1 text-sm text-slate-500">Last updated: {new Date(overview.last_updated).toLocaleString()}</p>
        </div>
        {!overviewResult.ok ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-panel" data-testid="workflow-overview-warning">
            Workflow metrics are temporarily unavailable. The route remains available for navigation.
          </div>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-2">
          <MetricsChart data={chartData} dataKey="success_rate" color="#0f766e" title="Success Rate" unavailable={!overviewResult.ok} />
          <MetricsChart data={chartData} dataKey="failure_rate" color="#b91c1c" title="Failure Rate" unavailable={!overviewResult.ok} />
          <MetricsChart data={chartData} dataKey="p95_duration_ms" color="#d97706" title="P95 Latency (ms)" unavailable={!overviewResult.ok} />
          <MetricsChart data={chartData} dataKey="duplicate_rate" color="#0e7490" title="Duplicate Rate" unavailable={!overviewResult.ok} />
        </div>
      </section>
    </main>
  );
}
