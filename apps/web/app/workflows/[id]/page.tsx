import { TopNav } from "../../../components/top-nav";
import { MetricsChart } from "../../../components/charts";
import { fetchOverview } from "../../../lib/api";
import { requireToken } from "../../../lib/auth";

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await requireToken();
  const overview = await fetchOverview(token, "24h", id);

  const chartData = (overview.series ?? []).map((point) => {
    const totalCount = asNumber(point.count_total);
    return {
      bucket_ts: String(point.bucket_ts),
      success_rate: totalCount > 0 ? asNumber(point.count_success) / totalCount : 0,
      failure_rate: totalCount > 0 ? asNumber(point.count_failed) / totalCount : 0,
      p95_duration_ms: asNumber(point.p95_duration_ms),
      retry_rate: asNumber(point.retry_rate),
      duplicate_rate: asNumber(point.duplicate_rate)
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
        <div className="grid gap-4 lg:grid-cols-2">
          <MetricsChart data={chartData} dataKey="success_rate" color="#0f766e" title="Success Rate" />
          <MetricsChart data={chartData} dataKey="failure_rate" color="#b91c1c" title="Failure Rate" />
          <MetricsChart data={chartData} dataKey="p95_duration_ms" color="#d97706" title="P95 Latency (ms)" />
          <MetricsChart data={chartData} dataKey="duplicate_rate" color="#0e7490" title="Duplicate Rate" />
        </div>
      </section>
    </main>
  );
}

