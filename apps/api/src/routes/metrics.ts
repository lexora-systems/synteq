import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { metricsOverviewQuerySchema } from "@synteq/shared";
import { parseWithSchema } from "../utils/validation.js";
import { getOverviewMetrics } from "../services/metrics-service.js";
import { getOperationalDashboard } from "../services/operational-dashboard-service.js";
import { getReliabilityWindows } from "../services/reliability-windows-service.js";
import { Permission } from "../auth/permissions.js";
import {
  replyIfEntitlementError,
  requireHistoryAccess,
  resolveTenantAccess
} from "../services/entitlement-guard-service.js";

const metricsRangeHours = {
  "15m": 0.25,
  "1h": 1,
  "6h": 6,
  "24h": 24,
  "7d": 24 * 7
} as const;

const reliabilityWindowsQuerySchema = z.object({
  workflowId: z.string().trim().min(1).optional(),
  workflow_id: z.string().trim().min(1).optional(),
  sourceId: z.string().trim().min(1).optional(),
  source_id: z.string().trim().min(1).optional(),
  sourceKey: z.string().trim().min(1).optional(),
  source_key: z.string().trim().min(1).optional()
});

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
      let resolvedRange = query.range;
      try {
        const access = await resolveTenantAccess({
          tenantId
        });
        const historyAccess = requireHistoryAccess({
          access,
          requestedRange: query.range,
          defaultRange: "1h",
          rangeToHours: metricsRangeHours
        });
        resolvedRange = historyAccess.range;
      } catch (error) {
        if (replyIfEntitlementError(reply, request.id, error)) {
          return;
        }
        throw error;
      }

      const metrics = await getOverviewMetrics({
        tenantId,
        workflowId: query.workflow_id,
        env: query.env,
        range: resolvedRange
      });

      return {
        ...metrics,
        last_updated: new Date().toISOString(),
        request_id: request.id
      };
    }
  );

  app.get(
    "/metrics/operational-dashboard",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.DASHBOARD_VIEW])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;

      if (!tenantId) {
        return reply.code(401).send({ error: "Missing tenant context" });
      }

      const dashboard = await getOperationalDashboard({
        tenantId
      });

      return {
        ...dashboard,
        request_id: request.id
      };
    }
  );

  app.get(
    "/metrics/reliability-windows",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.DASHBOARD_VIEW])]
    },
    async (request, reply) => {
      const query = parseWithSchema(reliabilityWindowsQuerySchema, request.query);
      const tenantId = request.authUser?.tenant_id;

      if (!tenantId) {
        return reply.code(401).send({ error: "Missing tenant context" });
      }

      const reliability = await getReliabilityWindows({
        tenantId,
        workflowId: query.workflowId ?? query.workflow_id,
        sourceId: query.sourceId ?? query.source_id,
        sourceKey: query.sourceKey ?? query.source_key
      });

      return {
        ...reliability,
        request_id: request.id
      };
    }
  );
};

export default metricsRoutes;
