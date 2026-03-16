import { z } from "zod";

const nonEmpty = z.string().trim().min(1);
export const userRoleSchema = z.enum(["owner", "admin", "engineer", "viewer"]);

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

export const supportedCurrencySchema = z.enum(["USD", "PHP", "EUR", "GBP", "JPY", "AUD", "CAD"]);

export const moneyDisplaySchema = z.object({
  amount_usd: z.number().int().nonnegative(),
  amount: z.number().nonnegative(),
  currency: supportedCurrencySchema,
  conversion_rate: z.number().positive()
});

export const tenantSettingsSchema = z.object({
  tenant_id: nonEmpty,
  default_currency: supportedCurrencySchema
});

export const tenantSettingsUpdateSchema = z.object({
  default_currency: supportedCurrencySchema
});

export const reliabilityScanRangeSchema = z.enum(["24h", "7d", "30d"]);

export const scanRunRequestSchema = z.object({
  workflow_id: nonEmpty,
  range: reliabilityScanRangeSchema.optional()
});

export const reliabilityScanResultSchema = z.object({
  workflow_id: z.string().min(1),
  workflow_name: z.string().min(1).optional(),
  scan_window: z.object({
    from: z.string().datetime(),
    to: z.string().datetime()
  }),
  reliability_score: z.number().int().min(0).max(100),
  success_rate: z.number().min(0).max(1),
  duplicate_rate: z.number().min(0).max(1),
  retry_rate: z.number().min(0).max(1),
  latency_health_score: z.number().int().min(0).max(100),
  anomaly_flags: z.array(z.string().min(1)),
  estimated_monthly_risk_usd: z.number().int().nonnegative(),
  estimated_monthly_risk: z.number().nonnegative(),
  currency: supportedCurrencySchema,
  conversion_rate: z.number().positive(),
  recommendation: z.string().min(1),
  enough_data: z.boolean(),
  generated_by: z.literal("scan_rules_v1")
});

export const simulationScenarioSchema = z.enum([
  "webhook-failure",
  "retry-storm",
  "latency-spike",
  "duplicate-webhook"
]);

export const simulationRequestSchema = z.object({
  workflow_id: nonEmpty
});

export const simulationResultSchema = z.object({
  scenario: simulationScenarioSchema,
  workflow_id: z.string().min(1),
  batch_id: z.string().min(1),
  injected_events: z.number().int().positive(),
  queued_events: z.number().int().nonnegative(),
  direct_events: z.number().int().nonnegative(),
  recommendation: z.string().min(1)
});

export const incidentTypeSchema = z.enum([
  "duplicate_webhook",
  "retry_storm",
  "latency_spike",
  "failure_rate_spike",
  "missing_heartbeat",
  "cost_spike",
  "unknown"
]);

export const incidentConfidenceSchema = z.enum(["low", "medium", "high"]);

export const incidentGuidanceNarrationInputSchema = z.object({
  incident_type: incidentTypeSchema,
  likely_causes: z.array(z.string().min(1)),
  business_impact: z.string().min(1),
  recommended_actions: z.array(z.string().min(1)),
  confidence: incidentConfidenceSchema,
  evidence: z.array(z.string()),
  workflow_id: z.string().nullable(),
  environment: z.string().nullable()
});

export const incidentNarrationResultSchema = z.object({
  summary_text: z.string().min(1),
  generated_by: z.enum(["template_v1", "ai_stub_v1"])
});

export const incidentGuidanceSchema = z.object({
  incident_type: incidentTypeSchema,
  likely_causes: z.array(z.string().min(1)).min(1),
  business_impact: z.string().min(1),
  recommended_actions: z.array(z.string().min(1)).min(1),
  confidence: incidentConfidenceSchema,
  evidence: z.array(z.string()),
  generated_by: z.literal("rules_v1"),
  summary_text: z.string().min(1)
});

export const securityEventTypeSchema = z.enum([
  "REFRESH_REUSE_DETECTED",
  "LOGIN_FAILED",
  "LOGIN_LOCKED",
  "INVITE_RATE_LIMITED"
]);

export const securityEventsQuerySchema = z.object({
  type: securityEventTypeSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25)
});

export const loginSchema = z.object({
  tenant_id: z.string().trim().min(1).max(64).optional(),
  email: z.string().email(),
  password: z.string().min(8).max(200)
});

export const refreshTokenSchema = z.object({
  refresh_token: z.string().min(32).max(512)
});

export const inviteCreateSchema = z.object({
  email: z.string().email(),
  role: userRoleSchema
});

export const inviteAcceptSchema = z.object({
  full_name: z.string().trim().min(1).max(191),
  password: z.string().min(8).max(200)
});

export const teamUpdateRoleSchema = z.object({
  role: userRoleSchema
});

export const passwordChangeSchema = z.object({
  current_password: z.string().min(8).max(200),
  new_password: z.string().min(8).max(200)
});

export const emailVerifyConfirmSchema = z.object({
  token: z.string().min(32).max(512)
});

export const passwordResetRequestSchema = z.object({
  tenant_id: z.string().trim().min(1).max(64).optional(),
  email: z.string().email()
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(32).max(512),
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
