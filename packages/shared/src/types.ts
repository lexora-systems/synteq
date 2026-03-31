import { z } from "zod";
import {
  alertChannelCreateSchema,
  alertChannelTypeSchema,
  alertChannelUpdateSchema,
  alertPolicyCreateSchema,
  alertPolicyMetricSchema,
  alertPolicyUpdateSchema,
  apiKeyCreateSchema,
  comparatorSchema,
  emailVerifyConfirmSchema,
  executionStatusSchema,
  githubIntegrationCreateSchema,
  incidentConfidenceSchema,
  incidentGuidanceNarrationInputSchema,
  incidentGuidanceSchema,
  incidentNarrationResultSchema,
  incidentTypeSchema,
  incidentsQuerySchema,
  ingestExecutionSchema,
  ingestHeartbeatSchema,
  ingestOperationalEventSchema,
  ingestOperationalEventsRequestSchema,
  inviteAcceptSchema,
  inviteCreateSchema,
  loginSchema,
  metricsOverviewQuerySchema,
  passwordChangeSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  pubSubPushEnvelopeSchema,
  refreshTokenSchema,
  reliabilityScanRangeSchema,
  reliabilityScanResultSchema,
  scanRunRequestSchema,
  supportedCurrencySchema,
  tenantSettingsSchema,
  tenantSettingsUpdateSchema,
  moneyDisplaySchema,
  simulationRequestSchema,
  simulationResultSchema,
  simulationScenarioSchema,
  securityEventsQuerySchema,
  securityEventTypeSchema,
  operationalEventSeveritySchema,
  teamUpdateRoleSchema,
  userRoleSchema,
  workflowRegisterSchema
} from "./schemas.js";

export type ExecutionStatus = z.infer<typeof executionStatusSchema>;
export type IngestExecutionInput = z.infer<typeof ingestExecutionSchema>;
export type IngestHeartbeatInput = z.infer<typeof ingestHeartbeatSchema>;
export type IngestOperationalEventInput = z.infer<typeof ingestOperationalEventSchema>;
export type IngestOperationalEventsRequest = z.infer<typeof ingestOperationalEventsRequestSchema>;
export type OperationalEventSeverity = z.infer<typeof operationalEventSeveritySchema>;
export type WorkflowRegisterInput = z.infer<typeof workflowRegisterSchema>;
export type MetricsOverviewQuery = z.infer<typeof metricsOverviewQuerySchema>;
export type IncidentsQuery = z.infer<typeof incidentsQuerySchema>;
export type ReliabilityScanRange = z.infer<typeof reliabilityScanRangeSchema>;
export type ScanRunRequest = z.infer<typeof scanRunRequestSchema>;
export type ReliabilityScanResult = z.infer<typeof reliabilityScanResultSchema>;
export type SupportedCurrency = z.infer<typeof supportedCurrencySchema>;
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;
export type TenantSettingsUpdate = z.infer<typeof tenantSettingsUpdateSchema>;
export type MoneyDisplay = z.infer<typeof moneyDisplaySchema>;
export type SimulationScenario = z.infer<typeof simulationScenarioSchema>;
export type SimulationRequest = z.infer<typeof simulationRequestSchema>;
export type SimulationResult = z.infer<typeof simulationResultSchema>;
export type IncidentType = z.infer<typeof incidentTypeSchema>;
export type IncidentConfidence = z.infer<typeof incidentConfidenceSchema>;
export type IncidentGuidance = z.infer<typeof incidentGuidanceSchema>;
export type IncidentGuidanceNarrationInput = z.infer<typeof incidentGuidanceNarrationInputSchema>;
export type IncidentNarrationResult = z.infer<typeof incidentNarrationResultSchema>;
export type SecurityEventType = z.infer<typeof securityEventTypeSchema>;
export type SecurityEventsQuery = z.infer<typeof securityEventsQuerySchema>;
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
export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateSchema>;
export type GitHubIntegrationCreateInput = z.infer<typeof githubIntegrationCreateSchema>;
export type AlertChannelType = z.infer<typeof alertChannelTypeSchema>;
export type AlertChannelCreateInput = z.infer<typeof alertChannelCreateSchema>;
export type AlertChannelUpdateInput = z.infer<typeof alertChannelUpdateSchema>;
export type AlertPolicyMetric = z.infer<typeof alertPolicyMetricSchema>;
export type Comparator = z.infer<typeof comparatorSchema>;
export type AlertPolicyCreateInput = z.infer<typeof alertPolicyCreateSchema>;
export type AlertPolicyUpdateInput = z.infer<typeof alertPolicyUpdateSchema>;

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
  guidance?: IncidentGuidance;
};

export type IncidentWithGuidanceDTO = IncidentDTO & {
  guidance: IncidentGuidance;
};
