import { runtimeMetrics } from "../lib/runtime-metrics.js";

export type OperationalEventForAnalysis = {
  source: string;
  eventType: string;
  system: string;
  eventTs: Date;
  severity: "warn" | "low" | "medium" | "high" | "critical" | null;
};

export type OperationalEventAnalysisHandoff = {
  mode: "operational_events_table";
  queued: number;
  next_stage: "pending_worker";
};

export async function handoffOperationalEventsForAnalysis(input: {
  tenantId: string;
  requestId: string;
  events: OperationalEventForAnalysis[];
}): Promise<OperationalEventAnalysisHandoff> {
  // Events are durably stored in operational_events.
  // Analysis worker bridge: `npm run worker:operational-events --workspace api`.
  runtimeMetrics.increment("ingest_operational_handoff_total", input.events.length);

  return {
    mode: "operational_events_table",
    queued: input.events.length,
    next_stage: "pending_worker"
  };
}
