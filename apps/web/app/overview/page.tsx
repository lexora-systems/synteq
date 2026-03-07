import Link from "next/link";
import { TopNav } from "../../components/top-nav";
import { MetricsChart } from "../../components/charts";
import { ReliabilityTools } from "../../components/reliability-tools";
import { fetchIncidents, fetchOverview, fetchWorkflows } from "../../lib/api";
import { requireToken } from "../../lib/auth";

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

export default async function OverviewPage() {
  const token = await requireToken();
  const [overview, incidentsPayload, workflowsPayload] = await Promise.all([
    fetchOverview(token, "1h"),
    fetchIncidents(token, "open"),
    fetchWorkflows(token)
  ]);

  const summary = overview.summary ?? {};
  const total = asNumber(summary.count_total);
  const failed = asNumber(summary.count_failed);
  const success = asNumber(summary.count_success);
  const p95 = asNumber(summary.p95_duration_ms);
  const avgCost = asNumber(summary.avg_cost_usd);
  const totalCost = asNumber(summary.sum_cost_usd);
  const window5m = overview.windows?.["5m"] as Record<string, unknown> | undefined;
  const window15m = overview.windows?.["15m"] as Record<string, unknown> | undefined;

  const chartData = (overview.series ?? []).map((point) => {
    const totalCount = asNumber(point.count_total);
    const successRate = totalCount > 0 ? asNumber(point.count_success) / totalCount : 0;
    const failureRate = totalCount > 0 ? asNumber(point.count_failed) / totalCount : 0;

    return {
      bucket_ts: String(point.bucket_ts),
      success_rate: successRate,
      failure_rate: failureRate,
      p95_duration_ms: asNumber(point.p95_duration_ms),
      retry_rate: asNumber(point.retry_rate),
      duplicate_rate: asNumber(point.duplicate_rate),
      avg_cost_usd: asNumber(point.avg_cost_usd)
    };
  });

  return (
    <main className="min-h-screen bg-cloud pb-12">
      <TopNav />
      <section className="mx-auto grid w-full max-w-6xl gap-6 px-4 pt-8">
        <div className="rounded-3xl bg-gradient-to-r from-ink to-ocean p-6 text-white shadow-panel">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-200">Overview</p>
          <h2 className="mt-1 text-3xl font-semibold">Platform health at a glance</h2>
          <p className="mt-2 text-sm text-cyan-100">Last updated: {new Date(overview.last_updated).toLocaleString()}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/incidents?status=open" className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-ink">
              Open incidents ({incidentsPayload.pagination.total})
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-5">
          <div className="metric-card">
            <p>Total Runs</p>
            <strong>{total.toLocaleString()}</strong>
          </div>
          <div className="metric-card">
            <p>Success</p>
            <strong>{success.toLocaleString()}</strong>
          </div>
          <div className="metric-card">
            <p>Failures</p>
            <strong className="text-ember">{failed.toLocaleString()}</strong>
          </div>
          <div className="metric-card">
            <p>P95 Latency</p>
            <strong>{p95.toFixed(0)} ms</strong>
          </div>
          <div className="metric-card">
            <p>Avg Cost / Run</p>
            <strong>${avgCost.toFixed(4)}</strong>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-panel">
          <p className="font-semibold text-ink">Sliding Windows</p>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <p>5m failures: <strong>{asNumber(window5m?.count_failed).toLocaleString()}</strong></p>
            <p>15m failures: <strong>{asNumber(window15m?.count_failed).toLocaleString()}</strong></p>
            <p>Range total cost: <strong>${totalCost.toFixed(4)}</strong></p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <MetricsChart data={chartData} dataKey="success_rate" color="#0f766e" title="Success Rate" />
          <MetricsChart data={chartData} dataKey="failure_rate" color="#b91c1c" title="Failure Rate" />
          <MetricsChart data={chartData} dataKey="p95_duration_ms" color="#d97706" title="P95 Latency (ms)" />
          <MetricsChart data={chartData} dataKey="retry_rate" color="#0e7490" title="Retry Rate" />
        </div>

        {workflowsPayload.workflows.length > 0 ? (
          <ReliabilityTools workflows={workflowsPayload.workflows} />
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-panel">
            Register a workflow first, then run a Synteq Reliability Scan and controlled simulations.
          </div>
        )}
      </section>
    </main>
  );
}
