import type { FastifyPluginAsync } from "fastify";
import { tenantSettingsUpdateSchema } from "@synteq/shared";
import { parseWithSchema } from "../utils/validation.js";
import { getTenantSettings, updateTenantSettings } from "../services/settings-service.js";

const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/settings/tenant",
    {
      preHandler: [app.requireDashboardAuth]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const settings = await getTenantSettings(tenantId);
      return {
        settings,
        request_id: request.id
      };
    }
  );

  app.patch(
    "/settings/tenant",
    {
      preHandler: [app.requireDashboardAuth, app.requireRoles(["owner", "admin"])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const body = parseWithSchema(tenantSettingsUpdateSchema, request.body);
      const settings = await updateTenantSettings({
        tenantId,
        defaultCurrency: body.default_currency
      });

      return {
        settings,
        request_id: request.id
      };
    }
  );
};

export default settingsRoutes;

