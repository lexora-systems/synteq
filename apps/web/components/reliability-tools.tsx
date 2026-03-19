"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { WorkflowRow } from "../lib/api";
import type { SupportedCurrency } from "@synteq/shared";

type ScanPayload = {
  workflow_id: string;
  workflow_name?: string;
  reliability_score: number;
  success_rate: number;
  duplicate_rate: number;
  retry_rate: number;
  latency_health_score: number;
  estimated_monthly_risk_usd: number;
  estimated_monthly_risk: number;
  currency: SupportedCurrency;
  conversion_rate: number;
  anomaly_flags: string[];
  top_risks: string[];
  next_steps: string[];
  recommendation: string;
  enough_data: boolean;
};

type SimulationPayload = {
  ok: boolean;
  result: {
    scenario: "webhook-failure" | "retry-storm" | "latency-spike" | "duplicate-webhook";
    workflow_id: string;
    batch_id: string;
    injected_events: number;
    queued_events: number;
    direct_events: number;
    recommendation: string;
  };
};

const scenarioButtons: Array<{
  key: "webhook-failure" | "retry-storm" | "latency-spike" | "duplicate-webhook";
  label: string;
}> = [
  { key: "webhook-failure", label: "Simulate webhook failure" },
  { key: "retry-storm", label: "Simulate retry storm" },
  { key: "latency-spike", label: "Simulate latency spike" },
  { key: "duplicate-webhook", label: "Simulate duplicate webhook" }
];

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMoney(amount: number, currency: SupportedCurrency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "JPY" ? 0 : 2
  }).format(amount);
}

function toScanErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("unauthorized") || message.includes("401")) {
    return "Session expired. Please sign in again.";
  }
  if (message.includes("forbidden") || message.includes("403") || message.includes("permission")) {
    return "Monitoring data access is blocked. Verify project permissions and try again.";
  }
  if (message.includes("bigquery") || message.includes("credential") || message.includes("500")) {
    return "Monitoring data is temporarily unavailable. Check pipeline health and data source configuration.";
  }
  return "Unable to run reliability scan right now. Please try again in a moment.";
}

export function ReliabilityTools({ workflows }: { workflows: WorkflowRow[] }) {
  const [workflowId, setWorkflowId] = useState(workflows[0]?.id ?? "");
  const [range, setRange] = useState<"24h" | "7d" | "30d">("7d");
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanPayload | null>(null);
  const [simulatingScenario, setSimulatingScenario] = useState<string | null>(null);
  const [simulationMessage, setSimulationMessage] = useState<string | null>(null);
  const workflowLabel = useMemo(
    () => workflows.find((workflow) => workflow.id === workflowId)?.display_name ?? workflowId,
    [workflowId, workflows]
  );

  async function runScan() {
    if (!workflowId || scanLoading) {
      return;
    }

    setScanLoading(true);
    setScanError(null);
    setSimulationMessage(null);

    try {
      const response = await fetch("/api/scan/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          workflow_id: workflowId,
          range
        })
      });

      const payload = (await response.json().catch(() => ({}))) as ScanPayload & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to run reliability scan");
      }

      setScanResult(payload);
    } catch (error) {
      setScanResult(null);
      setScanError(toScanErrorMessage(error));
    } finally {
      setScanLoading(false);
    }
  }

  async function runSimulation(scenario: "webhook-failure" | "retry-storm" | "latency-spike" | "duplicate-webhook") {
    if (!workflowId || simulatingScenario) {
      return;
    }

    setSimulatingScenario(scenario);
    setSimulationMessage(null);

    try {
      const response = await fetch(`/api/simulate/${scenario}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          workflow_id: workflowId
        })
      });

      const payload = (await response.json().catch(() => ({}))) as SimulationPayload & { error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Simulation request failed");
      }

      setSimulationMessage(
        `${payload.result.injected_events} synthetic events injected for ${payload.result.scenario}. Monitoring signals will update shortly.`
      );
    } catch (error) {
      setSimulationMessage(error instanceof Error ? error.message : "Simulation request failed");
    } finally {
      setSimulatingScenario(null);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl bg-white p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Reliability Scan</p>
        <h3 className="mt-1 text-xl font-semibold text-ink">Run Reliability Scan</h3>
        <p className="mt-1 text-sm text-slate-600">Detect hidden automation failures in minutes.</p>

        <div className="mt-4 grid gap-3 md:grid-cols-[2fr_1fr_auto]">
          <label className="text-sm text-slate-700">
            Workflow
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={workflowId}
              onChange={(event) => setWorkflowId(event.target.value)}
            >
              {workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.display_name} ({workflow.environment})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Range
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={range}
              onChange={(event) => setRange(event.target.value as "24h" | "7d" | "30d")}
            >
              <option value="24h">Last 24h</option>
              <option value="7d">Last 7d</option>
              <option value="30d">Last 30d</option>
            </select>
          </label>
          <button
            className="self-end rounded-lg bg-gradient-to-r from-ink to-ocean px-4 py-2 text-sm font-semibold text-white shadow-panel disabled:opacity-60"
            onClick={runScan}
            disabled={!workflowId || scanLoading}
          >
            {scanLoading ? "Running..." : "Run Reliability Scan"}
          </button>
        </div>

        {scanError ? <p className="mt-3 text-sm text-rose-700">{scanError}</p> : null}

        {scanResult ? (
          <div className="mt-4 space-y-4 rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500">Workflow: {scanResult.workflow_name ?? workflowLabel}</p>
              <p className="rounded-full bg-ink px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                Score {scanResult.reliability_score}
              </p>
            </div>

            {scanResult.enough_data ? null : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Not enough live data yet to score this workflow confidently. Run a simulation to see how Synteq detects incidents.
              </div>
            )}

            <div className="grid gap-2 text-sm md:grid-cols-2">
              <p>Success Rate: <strong>{percent(scanResult.success_rate)}</strong></p>
              <p>Duplicate Webhook Rate: <strong>{percent(scanResult.duplicate_rate)}</strong></p>
              <p>Retry Rate: <strong>{percent(scanResult.retry_rate)}</strong></p>
              <p>Latency Health: <strong>{scanResult.latency_health_score}/100</strong></p>
              <p className="md:col-span-2">
                Estimated Revenue Risk: <strong>{formatMoney(scanResult.estimated_monthly_risk, scanResult.currency)}/month</strong>
              </p>
              <p className="md:col-span-2 text-xs text-slate-500">
                {scanResult.currency === "USD"
                  ? "Base currency USD"
                  : `Approx. ${formatMoney(scanResult.estimated_monthly_risk_usd, "USD")} USD (FX ${scanResult.conversion_rate})`}
              </p>
            </div>

            <div>
              <p className="text-sm font-semibold text-ink">Top Risks</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {(scanResult.top_risks.length > 0 ? scanResult.top_risks : ["No major risk flags detected in this window."]).map(
                  (risk) => (
                    <li key={risk}>{risk}</li>
                  )
                )}
              </ul>
            </div>

            <div>
              <p className="text-sm font-semibold text-ink">Next Steps</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {scanResult.next_steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Simulation</p>
        <h3 className="mt-1 text-xl font-semibold text-ink">Test Synteq Detection</h3>
        <p className="mt-1 text-sm text-slate-600">
          Trigger safe synthetic scenarios to see how Synteq detects incidents and recommends actions.
        </p>

        <div className="mt-4 grid gap-2">
          {scenarioButtons.map((scenario) => (
            <button
              key={scenario.key}
              className="rounded-lg border border-slate-300 px-3 py-2 text-left text-sm text-slate-700 hover:border-slate-400 disabled:opacity-60"
              onClick={() => runSimulation(scenario.key)}
              disabled={!workflowId || Boolean(simulatingScenario)}
            >
              {simulatingScenario === scenario.key ? "Running..." : scenario.label}
            </button>
          ))}
        </div>

        {simulationMessage ? <p className="mt-3 text-sm text-slate-700">{simulationMessage}</p> : null}

        <div className="mt-4 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-slate-700">
          <p className="font-semibold text-ink">Connect a real workflow for live monitoring</p>
          <p className="mt-1">
            Simulations validate detection behavior. For real risk monitoring, connect a production workflow and ingest live telemetry.
            While setup is pending, keep using simulations to validate incident response.
          </p>
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Incidents will appear in a few seconds after simulation.
        </div>

        <div className="mt-3 flex gap-2 text-sm">
          <Link
            href={`/incidents?status=open${workflowId ? `&workflow_id=${encodeURIComponent(workflowId)}` : ""}`}
            className="rounded-lg border border-slate-300 px-3 py-2 text-slate-700"
          >
            Open Incidents
          </Link>
          <Link href="/incidents" className="rounded-lg border border-slate-300 px-3 py-2 text-slate-700">
            Incident Queue
          </Link>
        </div>
      </section>
    </div>
  );
}
