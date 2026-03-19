import Link from "next/link";
import { redirect } from "next/navigation";
import { TopNav } from "../../components/top-nav";
import { MetricsChart } from "../../components/charts";
import { ReliabilityTools } from "../../components/reliability-tools";
import { fetchIncidents, fetchOverview, fetchTenantSettings, fetchWorkflows } from "../../lib/api";
import { resolveActivationState } from "../../lib/activation";
import { requireToken } from "../../lib/auth";

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(amount);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function deriveRiskScore(input: {
  failureRate: number;
  retryRate: number;
  openIncidents: number;
  p95LatencyMs: number;
}): number {
  // Frontend-only fallback score until backend score is available.
  const incidentPenalty = Math.min(input.openIncidents * 6, 30);
  const latencyPenalty =
    input.p95LatencyMs >= 2500 ? 20 : input.p95LatencyMs >= 1500 ? 12 : input.p95LatencyMs >= 800 ? 6 : 0;
  const score =
    100 -
    input.failureRate * 45 -
    input.retryRate * 22 -
    incidentPenalty -
    latencyPenalty;

  return Math.round(clamp(score, 0, 100));
}

function riskStatus(score: number): "Healthy" | "Watch" | "High Risk" {
  if (score >= 80) {
    return "Healthy";
  }
  if (score >= 60) {
    return "Watch";
  }
  return "High Risk";
}

function deriveDeploymentStability(input: {
  successRate: number;
  retryRate: number;
  duplicateRate: number;
  p95LatencyMs: number;
}): number {
  const latencyPenalty =
    input.p95LatencyMs >= 2500 ? 12 : input.p95LatencyMs >= 1500 ? 8 : input.p95LatencyMs >= 800 ? 4 : 0;
  const stability =
    input.successRate * 100 -
    input.retryRate * 18 -
    input.duplicateRate * 14 -
    latencyPenalty;

  return Math.round(clamp(stability, 0, 100));
}

function deploymentStatus(score: number): "Stable" | "Needs Attention" | "Unstable" {
  if (score >= 85) {
    return "Stable";
  }
  if (score >= 65) {
    return "Needs Attention";
  }
  return "Unstable";
}

export default async function OverviewPage() {
  const token = await requireToken();
  const activation = await resolveActivationState(token);
  if (!activation.activated && !activation.metricsUnavailable) {
    redirect("/welcome");
  }

  const [overviewResult, incidentsPayload, workflowsPayload, settingsResult] = await Promise.all([
    fetchOverview(token, "1h")
      .then((payload) => ({ ok: true as const, payload }))
      .catch(() => ({ ok: false as const })),
    fetchIncidents(token, "open"),
    fetchWorkflows(token),
    fetchTenantSettings(token)
      .then((payload) => ({ ok: true as const, payload }))
      .catch(() => ({ ok: false as const }))
  ]);
  const monitoringDataUnavailable = !overviewResult.ok;
  const overview = overviewResult.ok
    ? overviewResult.payload
    : {
        summary: {},
        series: [],
        windows: {},
        last_updated: new Date().toISOString()
      };

  const summary = overview.summary ?? {};
  const total = asNumber(summary.count_total);
  const failed = asNumber(summary.count_failed);
  const success = asNumber(summary.count_success);
  const p95 = asNumber(summary.p95_duration_ms);
  const retryRate = asNumber(summary.retry_rate);
  const duplicateRate = asNumber(summary.duplicate_rate);
  const avgCost = asNumber(summary.avg_cost_usd);
  const totalCost = asNumber(summary.sum_cost_usd);
  const openIncidents = incidentsPayload.pagination.total;
  const failureRate = total > 0 ? failed / total : 0;
  const successRate = total > 0 ? success / total : 0;
  const riskScore = deriveRiskScore({
    failureRate,
    retryRate,
    openIncidents,
    p95LatencyMs: p95
  });
  const riskLabel = riskStatus(riskScore);
  const stabilityScore = deriveDeploymentStability({
    successRate,
    retryRate,
    duplicateRate,
    p95LatencyMs: p95
  });
  const stabilityLabel = deploymentStatus(stabilityScore);
  const estimatedExposure = totalCost > 0 ? totalCost : avgCost * total;
  const hasLimitedData = total < 5 && openIncidents === 0;
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
  const latestSeriesTimestampMs = chartData.reduce((latest, point) => {
    const parsed = new Date(point.bucket_ts).getTime();
    if (!Number.isFinite(parsed)) {
      return latest;
    }
    return Math.max(latest, parsed);
  }, 0);
  const telemetryAgeMinutes = latestSeriesTimestampMs > 0 ? (Date.now() - latestSeriesTimestampMs) / 60_000 : null;
  const telemetryPossiblyStale =
    !monitoringDataUnavailable && chartData.length > 0 && telemetryAgeMinutes !== null && telemetryAgeMinutes > 15;
  const tenantSettings = settingsResult.ok
    ? settingsResult.payload.settings
    : {
        tenant_id: "unknown",
        default_currency: "USD" as const,
        current_plan: "free" as const,
        effective_plan: "free" as const,
        trial: {
          status: "none" as const,
          available: false,
          active: false,
          consumed: false,
          started_at: null,
          ends_at: null,
          source: null,
          days_remaining: 0
        }
      };
  const trial = tenantSettings.trial;
  const showTrialActive = trial.active;
  const showTrialEnded = !trial.active && trial.consumed && tenantSettings.current_plan === "free";

  return (
    <main className="min-h-screen bg-cloud pb-12">
      <TopNav />
      <section className="mx-auto grid w-full max-w-6xl gap-6 px-4 pt-8">
        <div className="rounded-3xl bg-gradient-to-r from-ink to-ocean p-6 text-white shadow-panel">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-200">Decision Layer</p>
          <h2 className="mt-1 text-3xl font-semibold">Risk intelligence dashboard</h2>
          <p className="mt-2 text-sm text-cyan-100">
            {monitoringDataUnavailable
              ? "Monitoring source temporarily unavailable"
              : `Last updated: ${new Date(overview.last_updated).toLocaleString()}`}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/incidents?status=open" className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-ink">
              Open incidents ({openIncidents})
            </Link>
            <Link href="#investigation-tools" className="rounded-xl border border-cyan-200 px-4 py-2 text-sm font-semibold text-white">
              Run Reliability Scan
            </Link>
          </div>
        </div>

        {showTrialActive ? (
          <div className="flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-panel">
            <p>Pro trial active: {trial.days_remaining} days remaining.</p>
            {trial.started_at ? (
              <p className="text-xs text-emerald-700">Started {new Date(trial.started_at).toLocaleDateString()}</p>
            ) : null}
          </div>
        ) : null}

        {showTrialEnded ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-panel">
            Trial ended. Upgrade to Pro to continue full feature access.
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-4">
          <div className="rounded-2xl border border-cyan-200 bg-white p-5 shadow-panel lg:col-span-2">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-700">Platform Risk Score</p>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  monitoringDataUnavailable
                    ? "bg-slate-100 text-slate-700"
                    : riskLabel === "Healthy"
                    ? "bg-emerald-100 text-emerald-700"
                    : riskLabel === "Watch"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-rose-100 text-rose-700"
                }`}
              >
                {monitoringDataUnavailable ? "Data unavailable" : riskLabel}
              </span>
            </div>
            <p className="mt-3 text-5xl font-semibold text-ink">{monitoringDataUnavailable ? "--" : riskScore}</p>
            <p className="mt-2 text-sm text-slate-600">
              {monitoringDataUnavailable
                ? "Derived score is hidden until monitoring data source is reachable."
                : "Derived from failures, retries, latency, and active incident load."}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Revenue Exposure</p>
            <p className="mt-3 text-2xl font-semibold text-ink">
              {monitoringDataUnavailable
                ? "Unavailable"
                : estimatedExposure > 0
                  ? formatUsd(estimatedExposure)
                  : "No data yet"}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {monitoringDataUnavailable
                ? "Monitoring source is unavailable. Retry after pipeline health check."
                : estimatedExposure > 0
                  ? "Estimated cost exposure in selected range."
                  : "Run traffic or simulation to estimate exposure."}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Active Incidents</p>
            <p className="mt-3 text-2xl font-semibold text-ink">{openIncidents.toLocaleString()}</p>
            <Link href="/incidents?status=open" className="mt-2 inline-flex text-sm font-semibold text-ocean hover:text-ink">
              Open incident queue
            </Link>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-panel">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Deployment Stability</p>
            <p className="mt-3 text-2xl font-semibold text-ink">{monitoringDataUnavailable ? "--" : `${stabilityScore}/100`}</p>
            <p className="mt-2 text-sm text-slate-600">
              {monitoringDataUnavailable
                ? "Deployment stability is unavailable until telemetry resumes."
                : `${stabilityLabel} - Success rate ${formatPercent(successRate)}`}
            </p>
          </div>
        </div>

        {monitoringDataUnavailable ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-panel">
            Monitoring data is temporarily unavailable. Check data source credentials and run `npm run check:pipeline:health`.
            You can continue using simulation and incidents while monitoring data recovers.
          </div>
        ) : null}

        {hasLimitedData ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-panel">
            <p className="font-semibold text-ink">No data yet</p>
            <p className="mt-1">Connect a real workflow and ingest telemetry to start live platform risk monitoring.</p>
            <p className="mt-1">While setup is pending, run a simulation to validate detection and incident response.</p>
          </div>
        ) : null}

        {telemetryPossiblyStale ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-panel">
            Monitoring telemetry appears delayed (last metrics point about {Math.round(telemetryAgeMinutes ?? 0)} minutes ago).
            Verify scheduler cadence and run `npm run check:pipeline:freshness`.
          </div>
        ) : null}

        <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 text-sm text-slate-700 shadow-panel">
          <p className="font-semibold text-ink">Real monitoring setup</p>
          <p className="mt-1">
            Simulations are for validation. For live risk intelligence, connect a real workflow and continuously ingest telemetry.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Operational Metrics</p>
            <h3 className="mt-1 text-xl font-semibold text-ink">Execution performance snapshot</h3>
          </div>
          <div className="grid gap-4 md:grid-cols-5">
            <div className="metric-card">
              <p>Total Runs</p>
              <strong>{monitoringDataUnavailable ? "Unavailable" : total.toLocaleString()}</strong>
            </div>
            <div className="metric-card">
              <p>Success</p>
              <strong>{monitoringDataUnavailable ? "Unavailable" : success.toLocaleString()}</strong>
            </div>
            <div className="metric-card">
              <p>Failures</p>
              <strong className="text-ember">{monitoringDataUnavailable ? "Unavailable" : failed.toLocaleString()}</strong>
            </div>
            <div className="metric-card">
              <p>P95 Latency</p>
              <strong>{monitoringDataUnavailable ? "Unavailable" : `${p95.toFixed(0)} ms`}</strong>
            </div>
            <div className="metric-card">
              <p>Avg Cost / Run</p>
              <strong>{monitoringDataUnavailable ? "Unavailable" : `$${avgCost.toFixed(4)}`}</strong>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Monitoring Trends</p>
            <h3 className="mt-1 text-xl font-semibold text-ink">Real-time stability and performance signals</h3>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-panel">
            <p className="font-semibold text-ink">Sliding Window Summary</p>
            {monitoringDataUnavailable ? (
              <p className="mt-2 text-sm text-amber-800">Monitoring trends unavailable until data source access is restored.</p>
            ) : (
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                <p>5m failures: <strong>{asNumber(window5m?.count_failed).toLocaleString()}</strong></p>
                <p>15m failures: <strong>{asNumber(window15m?.count_failed).toLocaleString()}</strong></p>
                <p>Range total cost: <strong>{formatUsd(totalCost)}</strong></p>
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <MetricsChart data={chartData} dataKey="success_rate" color="#0f766e" title="Success Rate" unavailable={monitoringDataUnavailable} />
            <MetricsChart data={chartData} dataKey="failure_rate" color="#b91c1c" title="Failure Rate" unavailable={monitoringDataUnavailable} />
            <MetricsChart data={chartData} dataKey="p95_duration_ms" color="#d97706" title="P95 Latency (ms)" unavailable={monitoringDataUnavailable} />
            <MetricsChart data={chartData} dataKey="retry_rate" color="#0e7490" title="Retry Rate" unavailable={monitoringDataUnavailable} />
          </div>
        </div>

        <section id="investigation-tools" className="space-y-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Investigation Tools</p>
            <h3 className="mt-1 text-xl font-semibold text-ink">Investigate and validate risk signals</h3>
          </div>
          {workflowsPayload.workflows.length > 0 ? (
            <ReliabilityTools workflows={workflowsPayload.workflows} />
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-panel">
              Register a workflow first, then run a Synteq Reliability Scan and controlled simulations.
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
