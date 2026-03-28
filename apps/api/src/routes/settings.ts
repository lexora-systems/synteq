import type { FastifyPluginAsync } from "fastify";
import { tenantSettingsUpdateSchema } from "@synteq/shared";
import { parseWithSchema } from "../utils/validation.js";
import { getTenantSettings, updateTenantSettings } from "../services/settings-service.js";
import { startTrialIfEligible } from "../services/tenant-trial-service.js";

function trialStartMessage(code: "started" | "already_active" | "already_used" | "not_eligible") {
  if (code === "started") {
    return "Your 14-day Pro trial is now active.";
  }
  if (code === "already_active") {
    return "Pro trial is already active.";
  }
  if (code === "already_used") {
    return "Trial has already been used.";
  }
  return "Tenant is not eligible for a trial.";
}

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

  app.post(
    "/settings/tenant/trial/start",
    {
      preHandler: [app.requireDashboardAuth, app.requireRoles(["owner", "admin"])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const result = await startTrialIfEligible({
        tenantId,
        source: "manual"
      });
      const settings = await getTenantSettings(tenantId);

      return {
        result: {
          code: result.code,
          started: result.code === "started",
          message: trialStartMessage(result.code)
        },
        settings,
        request_id: request.id
      };
    }
  );
};

export default settingsRoutes;
