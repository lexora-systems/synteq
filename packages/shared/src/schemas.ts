import { z } from "zod";

const nonEmpty = z.string().trim().min(1);

export const executionStatusSchema = z.enum(["success", "failed", "timeout", "running", "cancelled"]);

export const ingestExecutionSchema = z.object({
  event_ts: z.coerce.date(),
  tenant_id: nonEmpty,
  workflow_id: nonEmpty,
  workflow_slug: nonEmpty.optional(),
  environment: nonEmpty.default("prod"),
  execution_id: nonEmpty,
  run_id: nonEmpty.optional(),
  status: executionStatusSchema,
  duration_ms: z.number().int().nonnegative().max(86_400_000).optional(),
  retry_count: z.number().int().nonnegative().max(100).default(0),
  token_in: z.number().int().nonnegative().max(10_000_000).optional(),
  token_out: z.number().int().nonnegative().max(10_000_000).optional(),
  cost_estimate_usd: z.number().nonnegative().max(10_000).optional(),
  error_class: z.string().max(255).optional(),
  error_message: z.string().max(16_384).optional(),
  step_name: z.string().max(255).optional(),
  step_index: z.number().int().nonnegative().max(1_000_000).optional(),
  payload: z.union([z.string().max(100_000), z.record(z.any())]).optional()
});

export const ingestHeartbeatSchema = z.object({
  heartbeat_ts: z.coerce.date().optional(),
  tenant_id: nonEmpty,
  workflow_id: nonEmpty,
  workflow_slug: nonEmpty.optional(),
  environment: nonEmpty.default("prod"),
  expected_interval_sec: z.number().int().positive().max(86_400).optional(),
  payload: z.union([z.string(), z.record(z.any())]).optional()
});

export const workflowRegisterSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9\-]+$/),
  display_name: z.string().trim().min(1).max(255),
  system: z.string().trim().min(1).max(255),
  environment: z.string().trim().min(1).max(64)
});

export const metricsOverviewQuerySchema = z.object({
  workflow_id: z.string().trim().optional(),
  env: z.string().trim().optional(),
  range: z.enum(["15m", "1h", "6h", "24h", "7d"]).default("1h")
});

export const incidentsQuerySchema = z.object({
  status: z.enum(["open", "acked", "resolved"]).optional(),
  workflow_id: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(25)
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200)
});

export const pubSubPushEnvelopeSchema = z.object({
  message: z.object({
    data: z.string(),
    messageId: z.string().optional(),
    attributes: z.record(z.string()).optional()
  }),
  subscription: z.string().optional()
});
