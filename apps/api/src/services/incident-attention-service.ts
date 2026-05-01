import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma.js";

export type IncidentAttentionLevel = "urgent" | "elevated" | "normal" | "unknown";
export type IncidentAttentionSeverity = "critical" | "high" | "medium" | "low" | "unknown";

export type IncidentAttentionGroup = {
  id: string;
  label: string;
  attention: IncidentAttentionLevel;
  incidentCount: number;
  highestSeverity: IncidentAttentionSeverity;
  lastSeenAt: string | null;
  alertFailureCount: number;
  activeStatuses: {
    open: number;
    acked: number;
  };
  groupKey: {
    fingerprint?: string;
    workflowId?: string;
    workflowName?: string;
    source?: string;
    system?: string;
    environment?: string;
    ruleKey?: string;
  };
};

export type IncidentAttentionGroups = {
  generatedAt: string;
  groups: IncidentAttentionGroup[];
};

type FindManyArgs = Record<string, unknown>;

type AttentionIncidentRow = {
  id: string;
  policy_id: string | null;
  workflow_id: string | null;
  environment: string | null;
  status: string;
  severity: string;
  started_at: Date;
  last_seen_at: Date;
  sla_due_at: Date | null;
  sla_breached_at: Date | null;
  fingerprint: string | null;
  details_json: unknown;
  workflow?: {
    id: string;
    display_name: string;
    slug: string;
    system: string;
    environment: string;
  } | null;
  policy?: {
    id: string;
    metric: string;
    name: string;
  } | null;
};

type AttentionIncidentEventRow = {
  id: number;
  incident_id: string;
  event_type: string;
  at_time: Date;
};

type AttentionFindingLinkRow = {
  id: number;
  tenant_id: string;
  incident_id: string;
  finding?: {
    source: string;
    rule_key: string;
    system: string;
    fingerprint: string;
  } | null;
};

export type IncidentAttentionClient = {
  incident: {
    findMany: (args: FindManyArgs) => Promise<AttentionIncidentRow[]>;
  };
  incidentEvent: {
    findMany: (args: FindManyArgs) => Promise<AttentionIncidentEventRow[]>;
  };
  findingIncidentLink: {
    findMany: (args: FindManyArgs) => Promise<AttentionFindingLinkRow[]>;
  };
};

type GroupSeed = {
  kind: "fingerprint" | "workflow" | "source_rule" | "policy" | "incident";
  rawKey: string;
  incident: AttentionIncidentRow;
  groupKey: IncidentAttentionGroup["groupKey"];
  label: string;
};

const ALERT_FAILURE_EVENT_TYPES = new Set(["ALERT_FAILED", "ALERT_SKIPPED"]);
const RECENT_ALERT_FAILURE_HOURS = 24;
const REPEATED_SIGNAL_EVENT_TYPES = new Set(["DETECTED", "BRIDGE_REFRESHED"]);
const attentionRank: Record<IncidentAttentionLevel, number> = {
  urgent: 0,
  elevated: 1,
  normal: 2,
  unknown: 3
};
const severityRank: Record<IncidentAttentionSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  unknown: 4
};
const SENSITIVE_VALUE_PATTERN =
  /(secret|password|token|authorization|signature|api[_-]?key|credential|cookie|session|private[_-]?key|client[_-]?secret|webhook[_-]?secret)/i;

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function safeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 191 || trimmed.includes("@") || /^https?:\/\//i.test(trimmed)) {
    return undefined;
  }
  if (SENSITIVE_VALUE_PATTERN.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function stringField(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = safeString(source[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function normalizeEnvironment(value: string | null | undefined) {
  const safe = safeString(value);
  return safe ?? undefined;
}

function severityBucket(severity: string): IncidentAttentionSeverity {
  if (severity === "critical" || severity === "high" || severity === "medium") {
    return severity;
  }
  if (severity === "low" || severity === "warn") {
    return "low";
  }
  return "unknown";
}

function highestSeverity(incidents: AttentionIncidentRow[]) {
  let highest: IncidentAttentionSeverity = "unknown";
  for (const incident of incidents) {
    const current = severityBucket(incident.severity);
    if (severityRank[current] < severityRank[highest]) {
      highest = current;
    }
  }
  return highest;
}

function maxDate(values: Date[]) {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((latest, value) => (value.getTime() > latest.getTime() ? value : latest), values[0]);
}

function stableId(rawKey: string) {
  return `attn_${createHash("sha256").update(rawKey).digest("hex").slice(0, 16)}`;
}

function formatRuleKey(ruleKey: string) {
  return ruleKey.replace(/[._-]+/g, " ");
}

function contextForIncident(
  incident: AttentionIncidentRow,
  findingByIncidentId: Map<string, AttentionFindingLinkRow>
) {
  const details = asObject(incident.details_json);
  const finding = findingByIncidentId.get(incident.id)?.finding ?? null;
  const workflowId =
    safeString(incident.workflow_id) ??
    stringField(details, ["workflowId", "workflow_id", "sourceId", "source_id"]);
  const workflowName =
    safeString(incident.workflow?.display_name) ??
    stringField(details, ["workflowName", "workflow_name", "workflow", "sourceName", "source_name"]);
  const environment =
    normalizeEnvironment(incident.environment) ??
    normalizeEnvironment(incident.workflow?.environment) ??
    stringField(details, ["environment", "env"]);
  const ruleKey =
    safeString(finding?.rule_key) ??
    stringField(details, ["finding_rule_key", "ruleKey", "rule_key", "rule", "metric"]) ??
    safeString(incident.policy?.metric);
  const source =
    safeString(finding?.source) ??
    stringField(details, ["source", "sourceType", "source_type"]);
  const system =
    safeString(finding?.system) ??
    stringField(details, ["system", "service", "repository", "repository_full_name"]) ??
    safeString(incident.workflow?.system);

  return {
    fingerprint: safeString(incident.fingerprint ?? undefined),
    workflowId,
    workflowName,
    environment,
    source,
    system,
    ruleKey,
    policyId: safeString(incident.policy_id ?? undefined),
    policyMetric: safeString(incident.policy?.metric)
  };
}

function labelFor(input: {
  kind: GroupSeed["kind"];
  incident: AttentionIncidentRow;
  groupKey: IncidentAttentionGroup["groupKey"];
  policyMetric?: string;
}) {
  const environmentSuffix = input.groupKey.environment ? ` / ${input.groupKey.environment}` : "";
  if (input.kind === "workflow" && (input.groupKey.workflowName || input.groupKey.workflowId)) {
    return `${input.groupKey.workflowName ?? input.groupKey.workflowId}${environmentSuffix}`;
  }
  if (input.kind === "source_rule" && (input.groupKey.system || input.groupKey.ruleKey)) {
    const system = input.groupKey.system ?? input.groupKey.source ?? "Source";
    const rule = input.groupKey.ruleKey ? ` / ${formatRuleKey(input.groupKey.ruleKey)}` : "";
    return `${system}${rule}${environmentSuffix}`;
  }
  if (input.kind === "policy" && input.policyMetric) {
    return `${formatRuleKey(input.policyMetric)}${environmentSuffix}`;
  }
  if (input.kind === "fingerprint" && input.groupKey.fingerprint) {
    return input.groupKey.workflowName ?? input.groupKey.system ?? `Incident fingerprint ${input.groupKey.fingerprint.slice(0, 8)}`;
  }
  return `Incident ${input.incident.id}`;
}

function seedForIncident(input: {
  tenantId: string;
  incident: AttentionIncidentRow;
  findingByIncidentId: Map<string, AttentionFindingLinkRow>;
  groupedFingerprints: Set<string>;
}): GroupSeed {
  const context = contextForIncident(input.incident, input.findingByIncidentId);
  const environment = context.environment;

  if (context.fingerprint && input.groupedFingerprints.has(context.fingerprint)) {
    const groupKey = {
      fingerprint: context.fingerprint,
      workflowId: context.workflowId,
      workflowName: context.workflowName,
      source: context.source,
      system: context.system,
      environment,
      ruleKey: context.ruleKey
    };
    return {
      kind: "fingerprint",
      rawKey: `${input.tenantId}:fingerprint:${context.fingerprint}`,
      incident: input.incident,
      groupKey,
      label: labelFor({
        kind: "fingerprint",
        incident: input.incident,
        groupKey
      })
    };
  }

  if (context.workflowId) {
    const groupKey = {
      workflowId: context.workflowId,
      workflowName: context.workflowName,
      environment
    };
    return {
      kind: "workflow",
      rawKey: `${input.tenantId}:workflow:${context.workflowId}:${environment ?? "default"}`,
      incident: input.incident,
      groupKey,
      label: labelFor({
        kind: "workflow",
        incident: input.incident,
        groupKey
      })
    };
  }

  if ((context.source || context.system) && context.ruleKey) {
    const groupKey = {
      source: context.source,
      system: context.system,
      environment,
      ruleKey: context.ruleKey
    };
    return {
      kind: "source_rule",
      rawKey: `${input.tenantId}:source_rule:${context.source ?? ""}:${context.system ?? ""}:${context.ruleKey}:${environment ?? "default"}`,
      incident: input.incident,
      groupKey,
      label: labelFor({
        kind: "source_rule",
        incident: input.incident,
        groupKey
      })
    };
  }

  if (context.policyId || context.policyMetric) {
    const groupKey = {
      environment,
      ruleKey: context.policyMetric
    };
    return {
      kind: "policy",
      rawKey: `${input.tenantId}:policy:${context.policyId ?? context.policyMetric}:${environment ?? "default"}`,
      incident: input.incident,
      groupKey,
      label: labelFor({
        kind: "policy",
        incident: input.incident,
        groupKey,
        policyMetric: context.policyMetric
      })
    };
  }

  const groupKey: IncidentAttentionGroup["groupKey"] = {};
  return {
    kind: "incident",
    rawKey: `${input.tenantId}:incident:${input.incident.id}`,
    incident: input.incident,
    groupKey,
    label: labelFor({
      kind: "incident",
      incident: input.incident,
      groupKey
    })
  };
}

function deriveAttention(input: {
  incidents: AttentionIncidentRow[];
  highestSeverity: IncidentAttentionSeverity;
  alertFailureCount: number;
  recentAlertFailureCount: number;
  repeatedSignalCount: number;
}) {
  if (input.highestSeverity === "unknown") {
    return "unknown" as const;
  }
  if (
    input.highestSeverity === "critical" ||
    input.incidents.some((incident) => incident.sla_breached_at !== null) ||
    (input.highestSeverity === "high" && input.recentAlertFailureCount > 0)
  ) {
    return "urgent" as const;
  }
  if (
    input.highestSeverity === "high" ||
    input.highestSeverity === "medium" ||
    input.incidents.length > 1 ||
    input.alertFailureCount > 0 ||
    input.repeatedSignalCount >= 2
  ) {
    return "elevated" as const;
  }
  return "normal" as const;
}

function countEventsByIncident(events: AttentionIncidentEventRow[]) {
  const counts = new Map<string, { alertFailures: number; recentAlertFailures: number; repeatedSignals: number }>();
  return {
    add(event: AttentionIncidentEventRow, now: Date) {
      const current = counts.get(event.incident_id) ?? {
        alertFailures: 0,
        recentAlertFailures: 0,
        repeatedSignals: 0
      };
      if (ALERT_FAILURE_EVENT_TYPES.has(event.event_type)) {
        current.alertFailures += 1;
        const ageMs = now.getTime() - event.at_time.getTime();
        if (ageMs >= 0 && ageMs <= RECENT_ALERT_FAILURE_HOURS * 60 * 60_000) {
          current.recentAlertFailures += 1;
        }
      }
      if (REPEATED_SIGNAL_EVENT_TYPES.has(event.event_type)) {
        current.repeatedSignals += 1;
      }
      counts.set(event.incident_id, current);
    },
    get(incidentId: string) {
      return (
        counts.get(incidentId) ?? {
          alertFailures: 0,
          recentAlertFailures: 0,
          repeatedSignals: 0
        }
      );
    }
  };
}

function compareGroups(left: IncidentAttentionGroup, right: IncidentAttentionGroup) {
  const attentionDelta = attentionRank[left.attention] - attentionRank[right.attention];
  if (attentionDelta !== 0) {
    return attentionDelta;
  }
  const severityDelta = severityRank[left.highestSeverity] - severityRank[right.highestSeverity];
  if (severityDelta !== 0) {
    return severityDelta;
  }
  const leftTime = left.lastSeenAt ? new Date(left.lastSeenAt).getTime() : 0;
  const rightTime = right.lastSeenAt ? new Date(right.lastSeenAt).getTime() : 0;
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return left.label.localeCompare(right.label);
}

export async function getIncidentAttentionGroups(input: {
  tenantId: string;
  now?: Date;
  client?: IncidentAttentionClient;
}): Promise<IncidentAttentionGroups> {
  const now = input.now ?? new Date();
  const client = input.client ?? (prisma as unknown as IncidentAttentionClient);
  const incidents = await client.incident.findMany({
    where: {
      tenant_id: input.tenantId,
      status: {
        in: ["open", "acked"]
      }
    },
    select: {
      id: true,
      policy_id: true,
      workflow_id: true,
      environment: true,
      status: true,
      severity: true,
      started_at: true,
      last_seen_at: true,
      sla_due_at: true,
      sla_breached_at: true,
      fingerprint: true,
      details_json: true,
      workflow: {
        select: {
          id: true,
          display_name: true,
          slug: true,
          system: true,
          environment: true
        }
      },
      policy: {
        select: {
          id: true,
          metric: true,
          name: true
        }
      }
    },
    orderBy: {
      last_seen_at: "desc"
    }
  });

  if (incidents.length === 0) {
    return {
      generatedAt: now.toISOString(),
      groups: []
    };
  }

  const incidentIds = incidents.map((incident) => incident.id);
  const [events, findingLinks] = await Promise.all([
    client.incidentEvent.findMany({
      where: {
        incident_id: {
          in: incidentIds
        },
        event_type: {
          in: [...ALERT_FAILURE_EVENT_TYPES, ...REPEATED_SIGNAL_EVENT_TYPES]
        }
      },
      select: {
        id: true,
        incident_id: true,
        event_type: true,
        at_time: true
      },
      orderBy: {
        at_time: "desc"
      }
    }),
    client.findingIncidentLink.findMany({
      where: {
        tenant_id: input.tenantId,
        incident_id: {
          in: incidentIds
        }
      },
      select: {
        id: true,
        tenant_id: true,
        incident_id: true,
        finding: {
          select: {
            source: true,
            rule_key: true,
            system: true,
            fingerprint: true
          }
        }
      }
    })
  ]);

  const findingByIncidentId = new Map<string, AttentionFindingLinkRow>();
  for (const link of findingLinks) {
    if (!findingByIncidentId.has(link.incident_id)) {
      findingByIncidentId.set(link.incident_id, link);
    }
  }

  const fingerprintCounts = new Map<string, number>();
  for (const incident of incidents) {
    const fingerprint = safeString(incident.fingerprint ?? undefined);
    if (fingerprint) {
      fingerprintCounts.set(fingerprint, (fingerprintCounts.get(fingerprint) ?? 0) + 1);
    }
  }
  const groupedFingerprints = new Set(
    [...fingerprintCounts.entries()].filter(([, count]) => count > 1).map(([fingerprint]) => fingerprint)
  );

  const eventsByIncident = countEventsByIncident(events);
  for (const event of events) {
    eventsByIncident.add(event, now);
  }

  const buckets = new Map<
    string,
    {
      rawKey: string;
      label: string;
      groupKey: IncidentAttentionGroup["groupKey"];
      incidents: AttentionIncidentRow[];
    }
  >();

  for (const incident of incidents) {
    const seed = seedForIncident({
      tenantId: input.tenantId,
      incident,
      findingByIncidentId,
      groupedFingerprints
    });
    const existing = buckets.get(seed.rawKey);
    if (existing) {
      existing.incidents.push(incident);
    } else {
      buckets.set(seed.rawKey, {
        rawKey: seed.rawKey,
        label: seed.label,
        groupKey: seed.groupKey,
        incidents: [incident]
      });
    }
  }

  const groups = [...buckets.values()].map((bucket) => {
    const statusCounts = {
      open: bucket.incidents.filter((incident) => incident.status === "open").length,
      acked: bucket.incidents.filter((incident) => incident.status === "acked").length
    };
    const eventCounts = bucket.incidents.reduce(
      (totals, incident) => {
        const incidentCounts = eventsByIncident.get(incident.id);
        return {
          alertFailures: totals.alertFailures + incidentCounts.alertFailures,
          recentAlertFailures: totals.recentAlertFailures + incidentCounts.recentAlertFailures,
          repeatedSignals: totals.repeatedSignals + incidentCounts.repeatedSignals
        };
      },
      {
        alertFailures: 0,
        recentAlertFailures: 0,
        repeatedSignals: 0
      }
    );
    const highest = highestSeverity(bucket.incidents);
    return {
      id: stableId(bucket.rawKey),
      label: bucket.label,
      attention: deriveAttention({
        incidents: bucket.incidents,
        highestSeverity: highest,
        alertFailureCount: eventCounts.alertFailures,
        recentAlertFailureCount: eventCounts.recentAlertFailures,
        repeatedSignalCount: eventCounts.repeatedSignals
      }),
      incidentCount: bucket.incidents.length,
      highestSeverity: highest,
      lastSeenAt: maxDate(bucket.incidents.map((incident) => incident.last_seen_at))?.toISOString() ?? null,
      alertFailureCount: eventCounts.alertFailures,
      activeStatuses: statusCounts,
      groupKey: bucket.groupKey
    };
  });

  return {
    generatedAt: now.toISOString(),
    groups: groups.sort(compareGroups)
  };
}
