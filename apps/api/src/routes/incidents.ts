import type { FastifyPluginAsync } from "fastify";
import type { IncidentEvent } from "@prisma/client";
import { incidentsQuerySchema } from "@synteq/shared";
import { z } from "zod";
import { parseWithSchema } from "../utils/validation.js";
import {
  ackIncident,
  getIncidentById,
  listIncidentEvents,
  listIncidents,
  resolveIncident
} from "../services/incidents-service.js";
import { Permission } from "../auth/permissions.js";
import { generateIncidentGuidance } from "../services/incident-guidance-service.js";
import { getIncidentAttentionGroups } from "../services/incident-attention-service.js";
import { getIncidentTimeline } from "../services/incident-timeline-service.js";

const incidentIdParamSchema = z.object({
  id: z.string().min(1)
});

type SafeMetadataValue = string | number | boolean | null;

const safeMetadataKeys = new Set([
  "status",
  "severity",
  "source",
  "workflow",
  "workflow_id",
  "workflowId",
  "workflow_name",
  "workflowName",
  "environment",
  "env",
  "rule",
  "rule_key",
  "ruleKey",
  "metric"
]);

const sensitiveMetadataPattern =
  /(secret|token|api[_-]?key|authorization|password|webhook|url|email|channel|headers|payload|raw|config)/i;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function safePrimitive(value: unknown): SafeMetadataValue | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 160 || sensitiveMetadataPattern.test(trimmed)) {
      return undefined;
    }
    return trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function normalizedMetadataKey(key: string) {
  if (key === "workflowId" || key === "workflow_id" || key === "workflowName" || key === "workflow_name") {
    return "workflow";
  }
  if (key === "env") {
    return "environment";
  }
  if (key === "ruleKey" || key === "rule_key") {
    return "rule";
  }
  return key;
}

function safeEventMetadata(payload: unknown) {
  const metadata: Record<string, SafeMetadataValue> = {};
  for (const [key, value] of Object.entries(asRecord(payload))) {
    if (!safeMetadataKeys.has(key) || sensitiveMetadataPattern.test(key)) {
      continue;
    }
    const safeValue = safePrimitive(value);
    if (safeValue !== undefined) {
      metadata[normalizedMetadataKey(key)] = safeValue;
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function eventSummary(eventType: string, metadata?: Record<string, SafeMetadataValue>) {
  if (eventType === "ALERT_PENDING") {
    return "Alert dispatch was queued.";
  }
  if (eventType === "ALERT_SENT") {
    return "Alert dispatch completed.";
  }
  if (eventType === "ALERT_FAILED") {
    return "Alert dispatch failed.";
  }
  if (eventType === "ALERT_SKIPPED") {
    return "Alert dispatch was skipped.";
  }
  if (eventType === "ACKED") {
    return "Incident was acknowledged.";
  }
  if (eventType === "RESOLVED_MANUAL") {
    return "Incident was manually resolved.";
  }
  if (eventType === "RESOLVED_AUTO" || eventType === "BRIDGE_RESOLVED") {
    return "Incident resolution was recorded.";
  }
  if (eventType === "BRIDGE_REFRESHED" || eventType === "DETECTED") {
    const metric = typeof metadata?.metric === "string" ? ` Metric: ${metadata.metric}.` : "";
    return `Detection condition was observed again.${metric}`;
  }
  if (eventType === "BRIDGE_OPENED" || eventType === "BRIDGE_REOPENED" || eventType === "TRIGGERED") {
    const metric = typeof metadata?.metric === "string" ? ` Metric: ${metadata.metric}.` : "";
    return `Detection opened or confirmed this incident.${metric}`;
  }
  if (eventType === "SLA_BREACHED") {
    return "Incident passed its SLA due time.";
  }
  if (eventType === "SEVERITY_ESCALATED") {
    const severity = typeof metadata?.severity === "string" ? ` Severity: ${metadata.severity}.` : "";
    return `Incident severity changed.${severity}`;
  }
  return "Lifecycle event recorded.";
}

function safeRecentEvent(event: IncidentEvent) {
  const metadata = safeEventMetadata(event.payload_json);
  return {
    id: String(event.id),
    event_type: event.event_type,
    at_time: event.at_time.toISOString(),
    summary: eventSummary(event.event_type, metadata),
    ...(metadata ? { metadata } : {})
  };
}

const incidentsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/incidents",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.INCIDENTS_READ])]
    },
    async (request, reply) => {
      const query = parseWithSchema(incidentsQuerySchema, request.query);
      const tenantId = request.authUser?.tenant_id;

      if (!tenantId) {
        return reply.code(401).send({ error: "Missing tenant context" });
      }

      const incidents = await listIncidents({
        tenantId,
        status: query.status,
        workflowId: query.workflow_id,
        page: query.page,
        pageSize: query.page_size
      });
      const incidentsWithGuidance = await Promise.all(
        incidents.items.map(async (incident) => ({
          ...incident,
          guidance: await generateIncidentGuidance({
            incident
          })
        }))
      );

      return {
        incidents: incidentsWithGuidance,
        pagination: {
          page: incidents.page,
          page_size: incidents.page_size,
          total: incidents.total,
          has_next: incidents.has_next
        },
        last_updated: new Date().toISOString(),
        request_id: request.id
      };
    }
  );

  app.get(
    "/incidents/attention-groups",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.INCIDENTS_READ])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Missing tenant context" });
      }

      const attentionGroups = await getIncidentAttentionGroups({
        tenantId
      });

      return {
        ...attentionGroups,
        request_id: request.id
      };
    }
  );

  app.get(
    "/incidents/:id/timeline",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.INCIDENTS_READ])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Missing tenant context" });
      }

      const params = parseWithSchema(incidentIdParamSchema, request.params);
      const timeline = await getIncidentTimeline({
        tenantId,
        incidentId: params.id
      });

      if (!timeline) {
        return reply.code(404).send({ error: "Incident not found" });
      }

      return {
        incident_id: timeline.incident_id,
        timeline: timeline.entries,
        request_id: request.id
      };
    }
  );

  app.get(
    "/incidents/:id",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.INCIDENTS_READ])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Missing tenant context" });
      }

      const params = parseWithSchema(incidentIdParamSchema, request.params);
      const incident = await getIncidentById(tenantId, params.id);
      if (!incident) {
        return reply.code(404).send({ error: "Incident not found" });
      }

      const recentEvents = await listIncidentEvents(incident.id, 20);
      const guidance = await generateIncidentGuidance({
        incident,
        recentEvents
      });

      return {
        incident: {
          ...incident,
          guidance
        },
        recent_events: recentEvents.map(safeRecentEvent),
        request_id: request.id
      };
    }
  );

  app.post(
    "/incidents/:id/ack",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.INCIDENTS_WRITE])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Missing tenant context" });
      }

      const params = parseWithSchema(incidentIdParamSchema, request.params);
      const incident = await ackIncident(tenantId, params.id);
      if (!incident) {
        return reply.code(404).send({ error: "Incident not found" });
      }

      return { incident, request_id: request.id };
    }
  );

  app.post(
    "/incidents/:id/resolve",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.INCIDENTS_WRITE])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Missing tenant context" });
      }

      const params = parseWithSchema(incidentIdParamSchema, request.params);
      const incident = await resolveIncident(tenantId, params.id);
      if (!incident) {
        return reply.code(404).send({ error: "Incident not found" });
      }

      return { incident, request_id: request.id };
    }
  );
};

export default incidentsRoutes;
