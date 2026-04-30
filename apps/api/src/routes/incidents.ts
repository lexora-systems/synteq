import type { FastifyPluginAsync } from "fastify";
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
import { getIncidentTimeline } from "../services/incident-timeline-service.js";

const incidentIdParamSchema = z.object({
  id: z.string().min(1)
});

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
        recent_events: recentEvents,
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
