import { z } from "zod";
import {
  emailVerifyConfirmSchema,
  executionStatusSchema,
  incidentsQuerySchema,
  ingestExecutionSchema,
  ingestHeartbeatSchema,
  inviteAcceptSchema,
  inviteCreateSchema,
  loginSchema,
  metricsOverviewQuerySchema,
  passwordChangeSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  pubSubPushEnvelopeSchema,
  refreshTokenSchema,
  teamUpdateRoleSchema,
  userRoleSchema,
  workflowRegisterSchema
} from "./schemas.js";

export type ExecutionStatus = z.infer<typeof executionStatusSchema>;
export type IngestExecutionInput = z.infer<typeof ingestExecutionSchema>;
export type IngestHeartbeatInput = z.infer<typeof ingestHeartbeatSchema>;
export type WorkflowRegisterInput = z.infer<typeof workflowRegisterSchema>;
export type MetricsOverviewQuery = z.infer<typeof metricsOverviewQuerySchema>;
export type IncidentsQuery = z.infer<typeof incidentsQuerySchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type UserRole = z.infer<typeof userRoleSchema>;
export type InviteCreateInput = z.infer<typeof inviteCreateSchema>;
export type InviteAcceptInput = z.infer<typeof inviteAcceptSchema>;
export type TeamUpdateRoleInput = z.infer<typeof teamUpdateRoleSchema>;
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
export type EmailVerifyConfirmInput = z.infer<typeof emailVerifyConfirmSchema>;
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;
export type PubSubPushEnvelope = z.infer<typeof pubSubPushEnvelopeSchema>;

export type MetricPoint = {
  bucket_ts: string;
  count_total: number;
  count_success: number;
  count_failed: number;
  count_timeout: number;
  avg_duration_ms: number | null;
  p95_duration_ms: number | null;
  retry_rate: number;
  duplicate_rate: number;
  avg_cost_usd: number | null;
  sum_cost_usd: number | null;
  sum_token_in: number | null;
  sum_token_out: number | null;
};

export type IncidentDTO = {
  id: string;
  tenant_id: string;
  workflow_id: string | null;
  environment: string | null;
  policy_id: string | null;
  status: "open" | "acked" | "resolved";
  severity: "warn" | "low" | "medium" | "high" | "critical";
  started_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  summary: string;
};
