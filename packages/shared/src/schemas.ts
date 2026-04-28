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

export const genericWorkflowSourceTypeSchema = z.enum(["webhook", "n8n", "make", "zapier"]);
export const workflowEventSourceTypeSchema = z.enum(["github", "webhook", "n8n", "make", "zapier"]);

export const workflowExecutionStatusSchema = z.enum([
  "started",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  // Accepted aliases normalized by API handlers.
  "success",
  "timeout",
  "canceled"
]);

export const ingestWorkflowEventSchema = z
  .object({
    source_type: workflowEventSourceTypeSchema,
    source_id: z.string().trim().min(1).max(191).optional(),
    source_key: z.string().trim().min(1).max(191).optional(),
    workflow_id: nonEmpty,
    workflow_name: nonEmpty.max(255),
    status: workflowExecutionStatusSchema,
    execution_id: nonEmpty.max(191),
    timestamp: z.coerce.date().optional(),
    started_at: z.coerce.date().optional(),
    finished_at: z.coerce.date().optional(),
    duration_ms: z.number().int().nonnegative().max(86_400_000).optional(),
    error_message: z.string().max(16_384).optional(),
    environment: z.string().trim().min(1).max(64).optional(),
    metadata: z.record(z.unknown()).optional()
  })
  .superRefine((value, ctx) => {
    if (!value.source_id && !value.source_key) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source_id"],
        message: "Provide source_id or source_key"
      });
    }

    if (!value.timestamp && !value.started_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["timestamp"],
        message: "Provide timestamp or started_at"
      });
    }
  });

export const operationalEventSeveritySchema = z.enum(["warn", "low", "medium", "high", "critical"]);

export const ingestOperationalEventSchema = z
  .object({
    source: z.string().trim().min(1).max(64),
    event_type: z.string().trim().min(1).max(128),
    service: z.string().trim().min(1).max(191).optional(),
    system: z.string().trim().min(1).max(191).optional(),
    environment: z.string().trim().min(1).max(64).optional(),
    timestamp: z.coerce.date(),
    severity: operationalEventSeveritySchema.optional(),
    correlation_key: z.string().trim().min(1).max(191).optional(),
    metadata: z.record(z.unknown()).optional(),
    attributes: z.record(z.unknown()).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.service && !value.system) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["service"],
        message: "Either service or system is required"
      });
    }
  });

const ingestOperationalEventsEnvelopeSchema = z
  .object({
    event: ingestOperationalEventSchema.optional(),
    events: z.array(ingestOperationalEventSchema).min(1).max(50).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.event && !value.events) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["event"],
        message: "Provide event or events"
      });
    }

    if (value.event && value.events) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["events"],
        message: "Provide either event or events, not both"
      });
    }
  });

export const ingestOperationalEventsRequestSchema = ingestOperationalEventsEnvelopeSchema.transform((value) => ({
  events: value.event ? [value.event] : value.events ?? []
}));

export const workflowRegisterSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9\-]+$/),
  display_name: z.string().trim().min(1).max(255),
  system: z.string().trim().min(1).max(255),
  environment: z.string().trim().min(1).max(64)
});

export const genericWorkflowSourceCreateSchema = z.object({
  display_name: z.string().trim().min(2).max(191),
  source_type: genericWorkflowSourceTypeSchema,
  environment: z.string().trim().min(1).max(64).default("production")
});

export const workflowSourceTestEventSchema = z.object({
  status: z.enum(["succeeded", "failed", "timed_out"])
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

export const signupSchema = z.object({
  workspace_name: z.string().trim().min(2).max(191),
  full_name: z.string().trim().min(2).max(191),
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

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(2).max(191)
});

export const githubIntegrationCreateSchema = z.object({
  repository_full_name: z
    .string()
    .trim()
    .min(3)
    .max(255)
    .regex(/^[^/\s]+\/[^/\s]+$/)
    .optional()
});

export const alertChannelTypeSchema = z.enum(["slack", "webhook", "email"]);

const alertChannelNameSchema = z.string().trim().min(1).max(191);

export const alertChannelCreateSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("slack"),
    name: alertChannelNameSchema,
    config: z.object({
      webhook_url: z.string().url()
    })
  }),
  z.object({
    type: z.literal("webhook"),
    name: alertChannelNameSchema,
    config: z.object({
      url: z.string().url()
    })
  }),
  z.object({
    type: z.literal("email"),
    name: alertChannelNameSchema,
    config: z.object({
      email: z.string().email()
    })
  })
]);

export const alertChannelUpdateSchema = z
  .object({
    name: alertChannelNameSchema.optional(),
    is_enabled: z.boolean().optional(),
    config: z.record(z.unknown()).optional()
  })
  .refine((value) => value.name !== undefined || value.is_enabled !== undefined || value.config !== undefined, {
    message: "Provide at least one field to update"
  });

export const alertPolicyMetricSchema = z.enum([
  "failure_rate",
  "latency_p95",
  "retry_rate",
  "duplicate_rate",
  "cost_spike",
  "latency_drift_ewma",
  "missing_heartbeat"
]);

export const comparatorSchema = z.enum(["gt", "gte", "lt", "lte", "eq"]);

const alertPolicyNameSchema = z.string().trim().min(1).max(191);

const alertPolicyBaseSchema = z.object({
  name: alertPolicyNameSchema,
  metric: alertPolicyMetricSchema,
  window_sec: z.number().int().positive().max(86_400).default(300),
  threshold: z.number(),
  comparator: comparatorSchema.default("gte"),
  min_events: z.number().int().nonnegative().max(1_000).default(20),
  severity: operationalEventSeveritySchema.default("medium"),
  is_enabled: z.boolean().default(true),
  filter_workflow_id: z.string().trim().min(1).max(36).optional(),
  filter_env: z.string().trim().min(1).max(64).optional(),
  channel_ids: z.array(z.string().trim().min(1).max(36)).max(25).default([])
});

export const alertPolicyCreateSchema = alertPolicyBaseSchema;

export const alertPolicyUpdateSchema = alertPolicyBaseSchema
  .partial()
  .extend({
    filter_workflow_id: z.string().trim().min(1).max(36).nullable().optional(),
    filter_env: z.string().trim().min(1).max(64).nullable().optional()
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.metric !== undefined ||
      value.window_sec !== undefined ||
      value.threshold !== undefined ||
      value.comparator !== undefined ||
      value.min_events !== undefined ||
      value.severity !== undefined ||
      value.is_enabled !== undefined ||
      value.filter_workflow_id !== undefined ||
      value.filter_env !== undefined ||
      value.channel_ids !== undefined,
    {
      message: "Provide at least one field to update"
    }
  );

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
