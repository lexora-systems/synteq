import type { FastifyPluginAsync } from "fastify";
import { workflowRegisterSchema } from "@synteq/shared";
import { parseWithSchema } from "../utils/validation.js";
import { prisma } from "../lib/prisma.js";
import { Permission } from "../auth/permissions.js";

const workflowRoutes: FastifyPluginAsync = async (app) => {
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

      return { workflow };
    }
  );
};

export default workflowRoutes;
