import type { FastifyPluginAsync } from "fastify";
import { metricsOverviewQuerySchema } from "@synteq/shared";
import { parseWithSchema } from "../utils/validation.js";
import { getOverviewMetrics } from "../services/metrics-service.js";
import { Permission } from "../auth/permissions.js";

const metricsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/metrics/overview",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.DASHBOARD_VIEW])]
    },
    async (request, reply) => {
      const query = parseWithSchema(metricsOverviewQuerySchema, request.query);
      const tenantId = request.authUser?.tenant_id;

      if (!tenantId) {
        return reply.code(401).send({ error: "Missing tenant context" });
      }

      const metrics = await getOverviewMetrics({
        tenantId,
        workflowId: query.workflow_id,
        env: query.env,
        range: query.range
      });

      return {
        ...metrics,
        last_updated: new Date().toISOString(),
        request_id: request.id
      };
    }
  );
};

export default metricsRoutes;
