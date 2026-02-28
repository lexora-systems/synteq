import type { FastifyPluginAsync } from "fastify";
import { incidentsQuerySchema } from "@synteq/shared";
import { parseWithSchema } from "../utils/validation.js";
import { ackIncident, listIncidents, resolveIncident } from "../services/incidents-service.js";

const incidentsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/incidents",
    {
      preHandler: app.requireDashboardAuth
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

      return {
        incidents: incidents.items,
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

  app.post(
    "/incidents/:id/ack",
    {
      preHandler: app.requireDashboardAuth
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Missing tenant context" });
      }

      const { id } = request.params as { id: string };
      const incident = await ackIncident(tenantId, id);
      if (!incident) {
        return reply.code(404).send({ error: "Incident not found" });
      }

      return { incident, request_id: request.id };
    }
  );

  app.post(
    "/incidents/:id/resolve",
    {
      preHandler: app.requireDashboardAuth
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Missing tenant context" });
      }

      const { id } = request.params as { id: string };
      const incident = await resolveIncident(tenantId, id);
      if (!incident) {
        return reply.code(404).send({ error: "Incident not found" });
      }

      return { incident, request_id: request.id };
    }
  );
};

export default incidentsRoutes;
