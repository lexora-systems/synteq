import {
  fetchConnectedSources,
  fetchGitHubIntegrations,
  fetchIncidents,
  fetchOverview,
  fetchWorkflows,
  type ConnectedSourceRow,
  type GitHubIntegrationRow
} from "./api";
import { asRecord, safeArray, safeBoolean, safeDateString, safeNullableString, safeNumber, safeString } from "./resilience";

type ActivationState = {
  activated: boolean;
  hasWorkflows: boolean;
  hasTelemetry: boolean;
  metricsUnavailable: boolean;
};

function toTimestampMs(value: string | null): number {
  if (!value) {
    return Number.NaN;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function normalizeConnectedSource(value: unknown): ConnectedSourceRow | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = safeString(record.id);
  const name = safeString(record.name, "Unknown source");
  const type = record.type === "github_integration" ? "github_integration" : "workflow";
  const status = record.status === "inactive" ? "inactive" : "active";

  if (!id) {
    return null;
  }

  return {
    id,
    type,
    name,
    status,
    powers: safeString(record.powers, "Operational monitoring"),
    details: asRecord(record.details) ?? {},
    last_activity_at: safeNullableString(record.last_activity_at),
    connected_at: safeDateString(record.connected_at)
  };
}

function normalizeGitHubIntegration(value: unknown): GitHubIntegrationRow | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = safeString(record.id);
  const webhookId = safeString(record.webhook_id);
  if (!id || !webhookId) {
    return null;
  }

  return {
    id,
    webhook_id: webhookId,
    repository_full_name: safeNullableString(record.repository_full_name),
    is_active: safeBoolean(record.is_active),
    last_delivery_id: safeNullableString(record.last_delivery_id),
    last_seen_at: safeNullableString(record.last_seen_at),
    created_at: safeDateString(record.created_at),
    updated_at: safeDateString(record.updated_at)
  };
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
    const totalEvents = safeNumber(overview.summary?.count_total);
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

export type ActivationMilestoneState = "complete" | "current" | "waiting" | "blocked";

export type ActivationMilestone = {
  key: "workspace_ready" | "source_connected" | "webhook_verified" | "first_signal_received" | "monitoring_active";
  title: string;
  description: string;
  state: ActivationMilestoneState;
};

export type ActivationPrimaryAction = {
  label: string;
  href: string;
  helper: string;
};

export type ActivationJourney = {
  milestones: ActivationMilestone[];
  primaryAction: ActivationPrimaryAction;
  progress: {
    completed: number;
    total: number;
    percent: number;
  };
  workspaceReady: boolean;
  sourceConnected: boolean;
  hasActiveSources: boolean;
  hasActiveGitHubIntegrations: boolean;
  webhookVerified: boolean;
  firstSignalReceived: boolean;
  monitoringActive: boolean;
  quietMonitoring: boolean;
  metricsUnavailable: boolean;
  totalSignals: number;
  openIncidents: number;
  github: {
    integrationCount: number;
    activeIntegrationCount: number;
    verifiedIntegrationCount: number;
    latestDeliveryAt: string | null;
    latestDeliveryId: string | null;
    status: "not_connected" | "inactive" | "awaiting_delivery" | "verified_waiting_signal" | "connected_monitoring";
    statusMessage: string;
  };
};

type ActivationJourneyInput = {
  connectedSources: ConnectedSourceRow[];
  githubIntegrations: GitHubIntegrationRow[];
  totalSignals: number;
  openIncidents: number;
  metricsUnavailable: boolean;
};

export function deriveActivationJourney(input: ActivationJourneyInput): ActivationJourney {
  const activeSources = input.connectedSources.filter(
    (source) => source.status === "active" && (source.type === "workflow" || source.type === "github_integration")
  );
  const activeGitHubIntegrations = input.githubIntegrations.filter((integration) => integration.is_active);
  const verifiedIntegrations = activeGitHubIntegrations.filter(
    (integration) => Boolean(integration.last_seen_at || integration.last_delivery_id)
  );
  const hasActiveSources = activeSources.length > 0;
  const sourceConnected = hasActiveSources;
  const hasActiveGitHubIntegrations = activeGitHubIntegrations.length > 0;
  const webhookVerified = verifiedIntegrations.length > 0;
  const sourceHasLastActivity = activeSources.some((source) => Boolean(source.last_activity_at));
  const firstSignalReceived =
    input.totalSignals > 0 || sourceHasLastActivity || (input.metricsUnavailable && webhookVerified);
  const monitoringActive = hasActiveSources && (firstSignalReceived || input.openIncidents > 0 || webhookVerified);
  const quietMonitoring = monitoringActive && input.openIncidents === 0;

  let latestDeliveryAt: string | null = null;
  let latestDeliveryAtMs = Number.NaN;
  let latestDeliveryId: string | null = null;

  for (const integration of activeGitHubIntegrations) {
    const seenAtMs = toTimestampMs(integration.last_seen_at);
    if (!Number.isNaN(seenAtMs) && (Number.isNaN(latestDeliveryAtMs) || seenAtMs > latestDeliveryAtMs)) {
      latestDeliveryAtMs = seenAtMs;
      latestDeliveryAt = integration.last_seen_at;
      latestDeliveryId = integration.last_delivery_id;
    }
  }

  if (!latestDeliveryId) {
    latestDeliveryId = activeGitHubIntegrations.find((integration) => Boolean(integration.last_delivery_id))?.last_delivery_id ?? null;
  }

  const webhookStepRequired = hasActiveGitHubIntegrations;
  const webhookMilestoneComplete = !webhookStepRequired || webhookVerified;

  const currentMilestoneKey =
    !sourceConnected
      ? "source_connected"
      : webhookStepRequired && !webhookVerified
        ? "webhook_verified"
        : !firstSignalReceived
          ? "first_signal_received"
          : !monitoringActive
            ? "monitoring_active"
            : null;

  const milestones: ActivationMilestone[] = [
    {
      key: "workspace_ready",
      title: "Workspace ready",
      description: "Authenticated workspace access is confirmed.",
      state: "complete"
    },
    {
      key: "source_connected",
      title: "Source connected",
      description: "A GitHub integration or generic workflow source has been configured.",
      state: sourceConnected ? "complete" : "current"
    },
    {
      key: "webhook_verified",
      title: "Webhook verified",
      description: webhookStepRequired
        ? "GitHub webhook has delivered at least one valid event to Synteq."
        : "For GitHub, at least one signed webhook delivery must arrive. Generic workflow sources validate through test events or live ingestion.",
      state: webhookMilestoneComplete
        ? "complete"
        : currentMilestoneKey === "webhook_verified"
          ? "current"
          : !sourceConnected
            ? "waiting"
            : "blocked"
    },
    {
      key: "first_signal_received",
      title: "First signal received",
      description: "Synteq has ingested at least one workflow execution event.",
      state: firstSignalReceived
        ? "complete"
        : currentMilestoneKey === "first_signal_received"
          ? "current"
          : !sourceConnected
            ? "waiting"
            : webhookStepRequired && !webhookVerified
              ? "blocked"
              : "waiting"
    },
    {
      key: "monitoring_active",
      title: "Monitoring active",
      description: "Synteq can update reliability windows and surface incident context as new signals arrive.",
      state: monitoringActive
        ? "complete"
        : currentMilestoneKey === "monitoring_active"
          ? "current"
          : !firstSignalReceived
            ? "waiting"
            : "blocked"
    }
  ];

  const completedMilestones = milestones.filter((milestone) => milestone.state === "complete").length;

  let primaryAction: ActivationPrimaryAction;
  if (!sourceConnected) {
    primaryAction = {
      label: "Choose first source",
      href: "/sources",
      helper: "Choose GitHub Actions or a generic workflow webhook so Synteq can begin receiving workflow execution signals."
    };
  } else if (webhookStepRequired && !webhookVerified) {
    primaryAction = {
      label: "Complete webhook setup",
      href: "/settings/control-plane/github",
      helper: "Webhook exists but no verified delivery has arrived yet. Send a test delivery or run a GitHub workflow."
    };
  } else if (!firstSignalReceived) {
    primaryAction = {
      label: hasActiveGitHubIntegrations ? "Trigger a workflow run" : "Send first signal",
      href: hasActiveGitHubIntegrations ? "/settings/control-plane/github" : "/sources",
      helper: "Synteq is connected. Generate one real run/event to validate end-to-end ingestion."
    };
  } else {
    primaryAction = {
      label: "Open overview",
      href: "/overview",
      helper: quietMonitoring
        ? "Synteq is connected and monitoring. No open incidents right now."
        : "Monitoring is active. Review current risk posture and incident state."
    };
  }

  let githubStatus: ActivationJourney["github"]["status"];
  let githubStatusMessage: string;

  if (input.githubIntegrations.length === 0) {
    githubStatus = "not_connected";
    githubStatusMessage = "No GitHub integration connected yet.";
  } else if (!hasActiveGitHubIntegrations) {
    githubStatus = "inactive";
    githubStatusMessage = "GitHub integrations exist but are currently inactive.";
  } else if (!webhookVerified) {
    githubStatus = "awaiting_delivery";
    githubStatusMessage = "Waiting for first valid GitHub webhook delivery.";
  } else if (!firstSignalReceived) {
    githubStatus = "verified_waiting_signal";
    githubStatusMessage = "Webhook verified. Waiting for additional operational signal flow.";
  } else {
    githubStatus = "connected_monitoring";
    githubStatusMessage = "GitHub connection is verified and monitoring is active.";
  }

  return {
    milestones,
    primaryAction,
    progress: {
      completed: completedMilestones,
      total: milestones.length,
      percent: Math.round((completedMilestones / milestones.length) * 100)
    },
    workspaceReady: true,
    sourceConnected,
    hasActiveSources,
    hasActiveGitHubIntegrations,
    webhookVerified,
    firstSignalReceived,
    monitoringActive,
    quietMonitoring,
    metricsUnavailable: input.metricsUnavailable,
    totalSignals: input.totalSignals,
    openIncidents: input.openIncidents,
    github: {
      integrationCount: input.githubIntegrations.length,
      activeIntegrationCount: activeGitHubIntegrations.length,
      verifiedIntegrationCount: verifiedIntegrations.length,
      latestDeliveryAt,
      latestDeliveryId,
      status: githubStatus,
      statusMessage: githubStatusMessage
    }
  };
}

export async function resolveActivationJourney(token: string): Promise<ActivationJourney> {
  const [sourcesResult, githubResult, overviewResult, incidentsResult] = await Promise.all([
    fetchConnectedSources(token)
      .then((payload) => ({ ok: true as const, payload }))
      .catch(() => ({ ok: false as const, payload: null })),
    fetchGitHubIntegrations(token)
      .then((payload) => ({ ok: true as const, payload }))
      .catch(() => ({ ok: false as const, payload: null })),
    fetchOverview(token, "1h")
      .then((payload) => ({ ok: true as const, payload }))
      .catch(() => ({ ok: false as const, payload: null })),
    fetchIncidents(token, "open")
      .then((payload) => ({ ok: true as const, payload }))
      .catch(() => ({ ok: false as const, payload: null }))
  ]);

  return deriveActivationJourney({
    connectedSources: safeArray(asRecord(sourcesResult.payload)?.sources, normalizeConnectedSource),
    githubIntegrations: safeArray(asRecord(githubResult.payload)?.integrations, normalizeGitHubIntegration),
    totalSignals: safeNumber(asRecord(asRecord(overviewResult.payload)?.summary)?.count_total),
    openIncidents: safeNumber(asRecord(asRecord(incidentsResult.payload)?.pagination)?.total),
    metricsUnavailable: !overviewResult.ok
  });
}
