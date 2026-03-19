import { fetchOverview, fetchWorkflows } from "./api";

type ActivationState = {
  activated: boolean;
  hasWorkflows: boolean;
  hasTelemetry: boolean;
  metricsUnavailable: boolean;
};

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

export async function resolveActivationState(token: string): Promise<ActivationState> {
  let workflowsPayload: Awaited<ReturnType<typeof fetchWorkflows>> | null = null;

  try {
    workflowsPayload = await fetchWorkflows(token);
  } catch {
    return {
      activated: false,
      hasWorkflows: false,
      hasTelemetry: false,
      metricsUnavailable: true
    };
  }

  const hasWorkflows = workflowsPayload.workflows.length > 0;

  if (!hasWorkflows) {
    return {
      activated: false,
      hasWorkflows: false,
      hasTelemetry: false,
      metricsUnavailable: false
    };
  }

  try {
    const overview = await fetchOverview(token, "7d");
    const totalEvents = asNumber(overview.summary?.count_total);
    const hasTelemetry = totalEvents > 0;

    return {
      activated: hasTelemetry,
      hasWorkflows: true,
      hasTelemetry,
      metricsUnavailable: false
    };
  } catch {
    return {
      activated: true,
      hasWorkflows: true,
      hasTelemetry: false,
      metricsUnavailable: true
    };
  }
}
