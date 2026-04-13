import {
  fetchConnectedSources,
  fetchGitHubIntegrations,
  fetchIncidents,
  fetchOverview,
  fetchWorkflows,
  type ConnectedSourceRow,
  type GitHubIntegrationRow
} from "./api";

type ActivationState = {
  activated: boolean;
  hasWorkflows: boolean;
  hasTelemetry: boolean;
  metricsUnavailable: boolean;
};

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function toTimestampMs(value: string | null): number {
  if (!value) {
    return Number.NaN;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NaN;
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
      description: "At least one active source is connected for monitoring.",
      state: sourceConnected ? "complete" : "current"
    },
    {
      key: "webhook_verified",
      title: "Webhook verified",
      description: webhookStepRequired
        ? "GitHub webhook has delivered at least one valid event to Synteq."
        : "GitHub webhook verification is optional until a GitHub integration is connected.",
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
      description: "Synteq has ingested at least one operational signal from a connected source.",
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
      description: "Detection is live and Synteq is ready to surface risk as signals arrive.",
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
      label: "Connect GitHub",
      href: "/settings/control-plane/github",
      helper: "Connect your first source so Synteq can begin ingesting live operational signals."
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
    connectedSources: sourcesResult.payload?.sources ?? [],
    githubIntegrations: githubResult.payload?.integrations ?? [],
    totalSignals: asNumber(overviewResult.payload?.summary?.count_total),
    openIncidents: incidentsResult.payload?.pagination.total ?? 0,
    metricsUnavailable: !overviewResult.ok
  });
}
