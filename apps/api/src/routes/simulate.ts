import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { simulationRequestSchema, simulationScenarioSchema, type SimulationScenario } from "@synteq/shared";
import { Permission, hasRequiredPermissions } from "../auth/permissions.js";
import { parseWithSchema } from "../utils/validation.js";
import { runSimulationScenario } from "../services/simulation-service.js";
import { hasFeature, resolveTenantAccess } from "../services/entitlement-guard-service.js";

function canRunSimulation(role: "owner" | "admin" | "engineer" | "viewer") {
  return (
    hasRequiredPermissions(role, [Permission.WORKFLOWS_WRITE]) ||
    hasRequiredPermissions(role, [Permission.SETTINGS_MANAGE])
  );
}

function registerScenarioRoute(app: FastifyInstance, scenario: SimulationScenario) {
  app.post(
    `/simulate/${scenario}`,
    {
      preHandler: [app.requireDashboardAuth]
    },
    async (request, reply) => {
      if (!request.authUser || !canRunSimulation(request.authUser.role)) {
        return reply.code(403).send({
          error: "Forbidden",
          code: "FORBIDDEN_PERMISSION"
        });
      }

      const body = parseWithSchema(simulationRequestSchema, request.body);
      const parsedScenario = parseWithSchema(simulationScenarioSchema, scenario);
      const access = await resolveTenantAccess({
        tenantId: request.authUser.tenant_id
      });
      const simulationAllowed = access.simulationAllowed !== false;
      if (!simulationAllowed) {
        return reply.code(403).send({
          error: "Upgrade required",
          code: "UPGRADE_REQUIRED",
          feature: "simulation"
        });
      }
      const premiumIntelligence = hasFeature(access, "premium_intelligence");
      request.log.info(
        {
          request_id: request.id,
          tenant_id: request.authUser.tenant_id,
          simulation_allowed: simulationAllowed,
          feature: "premium_intelligence",
          entitled: premiumIntelligence,
          outcome: "simulation_allowed"
        },
        "simulation.entitlement.decision"
      );

      try {
        const result = await runSimulationScenario({
          tenantId: request.authUser.tenant_id,
          workflowId: body.workflow_id,
          scenario: parsedScenario,
          requestId: request.id
        });

        return {
          ok: true,
          result,
          request_id: request.id
        };
      } catch (error) {
        if (error instanceof Error && error.name === "NotFoundError") {
          return reply.code(404).send({ error: "Workflow not found" });
        }
        throw error;
      }
    }
  );
}

const simulateRoutes: FastifyPluginAsync = async (app) => {
  registerScenarioRoute(app, "webhook-failure");
  registerScenarioRoute(app, "retry-storm");
  registerScenarioRoute(app, "latency-spike");
  registerScenarioRoute(app, "duplicate-webhook");
};

export default simulateRoutes;
