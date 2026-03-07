import type { FastifyPluginAsync } from "fastify";
import { reliabilityScanRangeSchema, scanRunRequestSchema } from "@synteq/shared";
import { z } from "zod";
import { Permission, hasRequiredPermissions } from "../auth/permissions.js";
import { parseWithSchema } from "../utils/validation.js";
import { runReliabilityScan } from "../services/reliability-scan-service.js";
import { redisGetJson, redisKey, redisSetJson } from "../lib/redis.js";

const scanLatestParamsSchema = z.object({
  workflowId: z.string().min(1)
});

const scanLatestQuerySchema = z.object({
  range: reliabilityScanRangeSchema.optional()
});

const SCAN_CACHE_TTL_SEC = 180;

function canRunScan(role: "owner" | "admin" | "engineer" | "viewer") {
  return (
    hasRequiredPermissions(role, [Permission.WORKFLOWS_READ]) ||
    hasRequiredPermissions(role, [Permission.DASHBOARD_VIEW])
  );
}

function scanCacheKey(input: { tenantId: string; workflowId: string; range: "24h" | "7d" | "30d" }) {
  return redisKey("scan", "latest", input.tenantId, input.workflowId, input.range);
}

function buildTopRisks(flags: string[]) {
  const map: Record<string, string> = {
    duplicate_risk: "Duplicate webhook activity can trigger duplicate order/state changes.",
    retry_storm_risk: "Retry pressure can create cascading load and delay critical workflows.",
    latency_risk: "Latency degradation increases SLA breach risk and customer-facing delays.",
    failure_risk: "Failure rate degradation risks lost automations and incomplete operations.",
    cost_risk: "Cost pressure indicates rising run-time spend and margin erosion."
  };

  return flags.slice(0, 3).map((flag) => map[flag] ?? flag.replaceAll("_", " "));
}

function ensureRiskCurrencyFields<T extends {
  estimated_monthly_risk_usd: number;
  estimated_monthly_risk?: number;
  currency?: string;
  conversion_rate?: number;
}>(scan: T) {
  return {
    ...scan,
    estimated_monthly_risk:
      typeof scan.estimated_monthly_risk === "number" ? scan.estimated_monthly_risk : scan.estimated_monthly_risk_usd,
    currency: typeof scan.currency === "string" ? scan.currency : "USD",
    conversion_rate: typeof scan.conversion_rate === "number" ? scan.conversion_rate : 1
  };
}

function buildNextSteps(flags: string[], enoughData: boolean) {
  if (!enoughData) {
    return [
      "Trigger a controlled simulation to validate Synteq incident detection.",
      "Run aggregation and anomaly jobs, then inspect /incidents for guided remediation."
    ];
  }

  const steps: string[] = [];
  if (flags.includes("failure_risk")) {
    steps.push("Inspect dominant error_class and compare against recent deploy/config changes.");
  }
  if (flags.includes("retry_storm_risk")) {
    steps.push("Increase exponential backoff and cap max retries until downstream stabilizes.");
  }
  if (flags.includes("duplicate_risk")) {
    steps.push("Enforce idempotency key checks and short-TTL duplicate suppression.");
  }
  if (flags.includes("latency_risk")) {
    steps.push("Inspect p95 latency by step and scale workers or reduce hot-path load.");
  }
  if (flags.includes("cost_risk")) {
    steps.push("Review token/model config changes and correlate with retry/duplicate behavior.");
  }

  if (steps.length === 0) {
    return ["Maintain current controls and run periodic simulations to verify incident readiness."];
  }

  return steps.slice(0, 4);
}

const scanRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/scan/run",
    {
      preHandler: [app.requireDashboardAuth]
    },
    async (request, reply) => {
      const role = request.authUser?.role;
      if (!request.authUser || !role || !canRunScan(role)) {
        return reply.code(403).send({
          error: "Forbidden",
          code: "FORBIDDEN_PERMISSION"
        });
      }

      const tenantId = request.authUser.tenant_id;
      const body = parseWithSchema(scanRunRequestSchema, request.body);
      const scan = await runReliabilityScan({
        tenantId,
        workflowId: body.workflow_id,
        range: body.range
      });
      const normalizedScan = ensureRiskCurrencyFields(scan);

      const effectiveRange =
        body.range ??
        (() => {
          const from = new Date(scan.scan_window.from).getTime();
          const to = new Date(scan.scan_window.to).getTime();
          const hours = Math.round((to - from) / (60 * 60 * 1000));
          if (hours <= 24) return "24h";
          if (hours >= 24 * 30) return "30d";
          return "7d";
        })();

      await redisSetJson(
        scanCacheKey({
          tenantId,
          workflowId: body.workflow_id,
          range: effectiveRange
        }),
        normalizedScan,
        SCAN_CACHE_TTL_SEC
      );

      return {
        ...normalizedScan,
        top_risks: buildTopRisks(normalizedScan.anomaly_flags),
        next_steps: buildNextSteps(normalizedScan.anomaly_flags, normalizedScan.enough_data),
        request_id: request.id
      };
    }
  );

  app.get(
    "/scan/:workflowId/latest",
    {
      preHandler: [app.requireDashboardAuth]
    },
    async (request, reply) => {
      const role = request.authUser?.role;
      if (!request.authUser || !role || !canRunScan(role)) {
        return reply.code(403).send({
          error: "Forbidden",
          code: "FORBIDDEN_PERMISSION"
        });
      }

      const tenantId = request.authUser.tenant_id;
      const params = parseWithSchema(scanLatestParamsSchema, request.params);
      const query = parseWithSchema(scanLatestQuerySchema, request.query);
      const range = query.range ?? "7d";
      const key = scanCacheKey({
        tenantId,
        workflowId: params.workflowId,
        range
      });

      const cached = await redisGetJson<Awaited<ReturnType<typeof runReliabilityScan>>>(key);
      if (cached) {
        const normalizedCached = ensureRiskCurrencyFields(cached);
        return {
          ...normalizedCached,
          top_risks: buildTopRisks(normalizedCached.anomaly_flags),
          next_steps: buildNextSteps(normalizedCached.anomaly_flags, normalizedCached.enough_data),
          request_id: request.id,
          cached: true
        };
      }

      const scan = await runReliabilityScan({
        tenantId,
        workflowId: params.workflowId,
        range
      });
      const normalizedScan = ensureRiskCurrencyFields(scan);
      await redisSetJson(key, normalizedScan, SCAN_CACHE_TTL_SEC);

      return {
        ...normalizedScan,
        top_risks: buildTopRisks(normalizedScan.anomaly_flags),
        next_steps: buildNextSteps(normalizedScan.anomaly_flags, normalizedScan.enough_data),
        request_id: request.id,
        cached: false
      };
    }
  );
};

export default scanRoutes;
