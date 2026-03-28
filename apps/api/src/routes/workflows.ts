import type { FastifyPluginAsync } from "fastify";
import { workflowRegisterSchema } from "@synteq/shared";
import { parseWithSchema } from "../utils/validation.js";
import { prisma } from "../lib/prisma.js";
import { Permission } from "../auth/permissions.js";
import { startTrialIfEligible } from "../services/tenant-trial-service.js";

const workflowRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/workflows",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.WORKFLOWS_READ])]
    },
    async (request, reply) => {
      const tenantId = request.authUser?.tenant_id;
      if (!tenantId) {
        return reply.code(401).send({ error: "Missing tenant context" });
      }

      const workflows = await prisma.workflow.findMany({
        where: {
          tenant_id: tenantId,
          is_active: true
        },
        orderBy: [{ display_name: "asc" }, { created_at: "asc" }],
        select: {
          id: true,
          slug: true,
          display_name: true,
          environment: true,
          system: true
        }
      });

      return {
        workflows,
        request_id: request.id
      };
    }
  );

  app.post(
    "/workflows/register",
    {
      preHandler: [app.requireDashboardAuth, app.requirePermissions([Permission.WORKFLOWS_WRITE])]
    },
    async (request, reply) => {
      const body = parseWithSchema(workflowRegisterSchema, request.body);
      const tenantId = request.authUser?.tenant_id;

      if (!tenantId) {
        return reply.code(401).send({ error: "Missing tenant context" });
      }

      const workflow = await prisma.workflow.upsert({
        where: {
          tenant_id_slug_environment: {
            tenant_id: tenantId,
            slug: body.slug,
            environment: body.environment
          }
        },
        create: {
          tenant_id: tenantId,
          slug: body.slug,
          display_name: body.display_name,
          system: body.system,
          environment: body.environment
        },
        update: {
          display_name: body.display_name,
          system: body.system,
          is_active: true
        }
      });

      const existingVersion = await prisma.workflowVersion.findFirst({
        where: { workflow_id: workflow.id },
        orderBy: { created_at: "desc" }
      });

      if (!existingVersion) {
        await prisma.workflowVersion.create({
          data: {
            workflow_id: workflow.id,
            version: "v1",
            config_json: {
              source: "register_endpoint",
              registered_at: new Date().toISOString()
            }
          }
        });
      }
      await startTrialIfEligible({
        tenantId,
        source: "auto_workflow_connect"
      }).catch((error) => {
        request.log.warn(
          { err: error, tenant_id: tenantId, workflow_id: workflow.id },
          "trial auto-start failed for workflow registration"
        );
      });

      return { workflow };
    }
  );
};

export default workflowRoutes;
