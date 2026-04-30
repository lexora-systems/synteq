import type { Incident, IncidentEvent, OperationalFinding, Severity } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export type IncidentTimelineEntry = {
  id: string;
  at: string;
  type:
    | "incident_created"
    | "incident_refreshed"
    | "incident_acknowledged"
    | "incident_resolved"
    | "alert_pending"
    | "alert_sent"
    | "alert_failed"
    | "finding_linked"
    | "detection_event"
    | "status_change"
    | "unknown_event";
  title: string;
  description?: string;
  severity?: string;
  source?: string;
  workflow?: string;
  environment?: string;
  metadata?: Record<string, unknown>;
};

type IncidentTimeline = {
  incident_id: string;
  entries: IncidentTimelineEntry[];
};

type FindingLinkWithFinding = {
  id: number;
  tenant_id: string;
  finding_id: string;
  incident_id: string;
  bridge_key: string;
  last_bridged_at: Date;
  created_at: Date;
  updated_at: Date;
  finding: OperationalFinding;
};

const MAX_EVENT_ROWS = 200;
const MAX_FINDING_LINKS = 20;
const MAX_METADATA_KEYS = 10;
const MAX_ARRAY_ITEMS = 5;
const MAX_STRING_LENGTH = 240;
const SENSITIVE_KEY_PATTERN =
  /(secret|password|token|authorization|signature|api[_-]?key|credential|cookie|session|private[_-]?key|client[_-]?secret|webhook[_-]?secret)/i;

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  return null;
}

function normalizedEventTime(event: IncidentEvent): Date {
  const payload = asObject(event.payload_json);
  return asDate(payload.at) ?? asDate(payload.eventTime) ?? asDate(event.at_time) ?? new Date(0);
}

function truncateString(value: string) {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_STRING_LENGTH)}...`;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return truncateString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    if (depth >= 2) {
      return `[${value.length} items]`;
    }
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === "object") {
    if (depth >= 2) {
      return "[object]";
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>).slice(0, MAX_METADATA_KEYS)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        continue;
      }
      sanitized[key] = sanitizeValue(nestedValue, depth + 1);
    }
    return sanitized;
  }

  return String(value);
}

function compactMetadata(value: unknown): Record<string, unknown> | undefined {
  const sanitized = sanitizeValue(value);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    return undefined;
  }

  const entries = Object.entries(sanitized as Record<string, unknown>)
    .filter(([, nestedValue]) => nestedValue !== undefined)
    .slice(0, MAX_METADATA_KEYS);
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function stringFromObject(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function contextFor(input: {
  incident: Incident;
  payload?: Record<string, unknown>;
  severity?: Severity | string | null;
}) {
  const incidentDetails = asObject(input.incident.details_json);
  const payload = input.payload ?? {};
  return {
    severity:
      (typeof input.severity === "string" && input.severity) ||
      stringFromObject(payload, ["severity"]) ||
      input.incident.severity,
    source: stringFromObject(payload, ["source", "sourceType", "source_type"]) ?? stringFromObject(incidentDetails, ["source", "sourceType", "source_type"]),
    workflow:
      stringFromObject(payload, ["workflow", "workflowId", "workflow_id", "workflowName", "workflow_name"]) ??
      stringFromObject(incidentDetails, ["workflow", "workflowId", "workflow_id", "workflowName", "workflow_name"]) ??
      input.incident.workflow_id ??
      undefined,
    environment:
      stringFromObject(payload, ["environment", "env"]) ??
      stringFromObject(incidentDetails, ["environment", "env"]) ??
      input.incident.environment ??
      undefined
  };
}

function statusDescription(payload: Record<string, unknown>, fallback: string) {
  const previous = typeof payload.previous_status === "string" ? payload.previous_status : null;
  const updated = typeof payload.updated_status === "string" ? payload.updated_status : null;
  if (previous && updated) {
    return `Status changed from ${previous} to ${updated}.`;
  }
  return fallback;
}

function eventPresentation(eventType: string, payload: Record<string, unknown>) {
  if (eventType === "ACKED") {
    return {
      type: "incident_acknowledged" as const,
      title: "Incident acknowledged",
      description: statusDescription(payload, "Incident was acknowledged.")
    };
  }

  if (eventType === "RESOLVED_MANUAL") {
    return {
      type: "incident_resolved" as const,
      title: "Incident resolved manually",
      description: statusDescription(payload, "Incident was manually marked resolved.")
    };
  }

  if (eventType === "RESOLVED_AUTO") {
    return {
      type: "incident_resolved" as const,
      title: "Incident auto-resolved",
      description: "Detection cleared for enough windows to resolve the incident."
    };
  }

  if (eventType === "BRIDGE_RESOLVED") {
    const reason = typeof payload.reason === "string" ? ` Reason: ${payload.reason}.` : "";
    return {
      type: "incident_resolved" as const,
      title: "Incident resolved by detection bridge",
      description: `Linked detection was resolved.${reason}`
    };
  }

  if (eventType === "BRIDGE_REFRESHED" || eventType === "DETECTED") {
    return {
      type: "incident_refreshed" as const,
      title: "Incident refreshed",
      description: "The detection condition was observed again."
    };
  }

  if (eventType === "TRIGGERED") {
    const metric = typeof payload.metric === "string" ? ` Metric: ${payload.metric}.` : "";
    return {
      type: "detection_event" as const,
      title: "Detection triggered",
      description: `Detection opened or confirmed this incident.${metric}`
    };
  }

  if (eventType === "BRIDGE_OPENED") {
    return {
      type: "detection_event" as const,
      title: "Detection bridge opened incident",
      description: "An operational finding was bridged into this incident."
    };
  }

  if (eventType === "BRIDGE_REOPENED") {
    return {
      type: "detection_event" as const,
      title: "Detection bridge reopened incident",
      description: "A resolved incident was reopened after the detection reappeared."
    };
  }

  if (eventType === "GENERIC_WORKFLOW_RECOVERY") {
    return {
      type: "detection_event" as const,
      title: "Workflow recovery observed",
      description: "A succeeded workflow event was observed for the affected workflow."
    };
  }

  if (eventType === "ALERT_PENDING") {
    return {
      type: "alert_pending" as const,
      title: "Alert queued",
      description: "An alert dispatch was queued for this incident."
    };
  }

  if (eventType === "ALERT_SENT") {
    return {
      type: "alert_sent" as const,
      title: "Alert sent",
      description: "Alert dispatch completed successfully."
    };
  }

  if (eventType === "ALERT_FAILED") {
    return {
      type: "alert_failed" as const,
      title: "Alert failed",
      description: "Alert dispatch failed and may be retried."
    };
  }

  if (eventType === "ALERT_SKIPPED") {
    return {
      type: "alert_failed" as const,
      title: "Alert skipped",
      description: "Alert dispatch was skipped for this incident."
    };
  }

  if (eventType === "SEVERITY_ESCALATED") {
    const previous = typeof payload.previous === "string" ? payload.previous : null;
    const next = typeof payload.next === "string" ? payload.next : null;
    return {
      type: "status_change" as const,
      title: "Severity escalated",
      description: previous && next ? `Severity changed from ${previous} to ${next}.` : "Incident severity was escalated."
    };
  }

  if (eventType === "SLA_BREACHED") {
    return {
      type: "status_change" as const,
      title: "SLA breached",
      description: "The incident passed its configured SLA due time."
    };
  }

  if (eventType === "CLEAR_WINDOW") {
    return {
      type: "status_change" as const,
      title: "Clear window observed",
      description: "A detection clear window was observed while evaluating auto-resolution."
    };
  }

  return {
    type: "unknown_event" as const,
    title: "Timeline event",
    description: `Recorded incident event: ${eventType}.`
  };
}

function eventTimelineEntry(input: { incident: Incident; event: IncidentEvent }): IncidentTimelineEntry {
  const payload = asObject(input.event.payload_json);
  const presentation = eventPresentation(input.event.event_type, payload);
  const context = contextFor({
    incident: input.incident,
    payload,
    severity: stringFromObject(payload, ["severity", "next"])
  });
  const metadata = compactMetadata({
    event_type: input.event.event_type,
    ...payload
  });

  return {
    id: `incident_event:${input.event.id}`,
    at: normalizedEventTime(input.event).toISOString(),
    type: presentation.type,
    title: presentation.title,
    description: presentation.description,
    severity: context.severity,
    source: context.source,
    workflow: context.workflow,
    environment: context.environment,
    metadata
  };
}

function incidentCreatedEntry(incident: Incident): IncidentTimelineEntry {
  const context = contextFor({ incident });
  return {
    id: `incident:${incident.id}:created`,
    at: incident.started_at.toISOString(),
    type: "incident_created",
    title: "Incident opened",
    description: incident.summary,
    severity: context.severity,
    source: context.source,
    workflow: context.workflow,
    environment: context.environment,
    metadata: compactMetadata({
      fingerprint: incident.fingerprint,
      policy_id: incident.policy_id,
      workflow_id: incident.workflow_id,
      status: incident.status,
      details: incident.details_json
    })
  };
}

function findingTimelineEntry(link: FindingLinkWithFinding): IncidentTimelineEntry {
  const finding = link.finding;
  return {
    id: `finding:${finding.id}`,
    at: finding.first_seen_at.toISOString(),
    type: "finding_linked",
    title: "Operational finding linked",
    description: `${finding.rule_key}: ${finding.summary}`,
    severity: finding.severity,
    source: finding.source,
    workflow: finding.system,
    metadata: compactMetadata({
      rule_key: finding.rule_key,
      system: finding.system,
      correlation_key: finding.correlation_key,
      event_count: finding.event_count,
      first_seen_at: finding.first_seen_at,
      last_seen_at: finding.last_seen_at,
      evidence: finding.evidence_json
    })
  };
}

function byTimelineTime(left: IncidentTimelineEntry, right: IncidentTimelineEntry) {
  const leftTime = new Date(left.at).getTime();
  const rightTime = new Date(right.at).getTime();
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.id.localeCompare(right.id);
}

export async function getIncidentTimeline(input: {
  tenantId: string;
  incidentId: string;
}): Promise<IncidentTimeline | null> {
  const incident = await prisma.incident.findFirst({
    where: {
      id: input.incidentId,
      tenant_id: input.tenantId
    }
  });

  if (!incident) {
    return null;
  }

  const [events, findingLinks] = await Promise.all([
    prisma.incidentEvent.findMany({
      where: {
        incident_id: incident.id
      },
      orderBy: {
        at_time: "asc"
      },
      take: MAX_EVENT_ROWS
    }),
    prisma.findingIncidentLink.findMany({
      where: {
        incident_id: incident.id,
        tenant_id: input.tenantId
      },
      include: {
        finding: true
      },
      orderBy: {
        created_at: "asc"
      },
      take: MAX_FINDING_LINKS
    }) as Promise<FindingLinkWithFinding[]>
  ]);

  const entries = [
    incidentCreatedEntry(incident),
    ...findingLinks.map(findingTimelineEntry),
    ...events.map((event) =>
      eventTimelineEntry({
        incident,
        event
      })
    )
  ].sort(byTimelineTime);

  return {
    incident_id: incident.id,
    entries
  };
}
