import { apiBaseUrl } from "./config";

export type SupportedCurrency = "USD" | "PHP" | "EUR" | "GBP" | "JPY" | "AUD" | "CAD";
export type IncidentGuidance = {
  incident_type: "duplicate_webhook" | "retry_storm" | "latency_spike" | "failure_rate_spike" | "missing_heartbeat" | "cost_spike" | "unknown";
  likely_causes: string[];
  business_impact: string;
  recommended_actions: string[];
  confidence: "low" | "medium" | "high";
  evidence: string[];
  generated_by: "rules_v1";
  summary_text: string;
};

type RequestOptions = {
  token?: string;
  method?: string;
  body?: unknown;
};

type ApiRequestFailureKind = "http" | "network" | "invalid_json";

export class ApiRequestError extends Error {
  readonly path: string;
  readonly status: number | null;
  readonly code: string | null;
  readonly requestId: string | null;
  readonly kind: ApiRequestFailureKind;

  constructor(input: {
    message: string;
    path: string;
    status: number | null;
    code?: string | null;
    requestId?: string | null;
    kind: ApiRequestFailureKind;
  }) {
    super(input.message);
    this.name = "ApiRequestError";
    this.path = input.path;
    this.status = input.status;
    this.code = input.code ?? null;
    this.requestId = input.requestId ?? null;
    this.kind = input.kind;
  }
}

export class ApiContractError extends Error {
  readonly path: string;
  readonly contract: string;

  constructor(input: { message: string; path: string; contract: string }) {
    super(input.message);
    this.name = "ApiContractError";
    this.path = input.path;
    this.contract = input.contract;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toResponseSnippet(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) {
    return null;
  }
  return normalized.slice(0, 160);
}

async function readResponsePayload(response: Response): Promise<{ raw: string; json: unknown | null }> {
  const raw = await response.text();
  if (!raw) {
    return {
      raw: "",
      json: null
    };
  }

  try {
    return {
      raw,
      json: JSON.parse(raw) as unknown
    };
  } catch {
    return {
      raw,
      json: null
    };
  }
}

function toHttpApiError(input: { path: string; status: number; payload: { raw: string; json: unknown | null } }): ApiRequestError {
  const payloadObject = asRecord(input.payload.json);
  const code = toOptionalString(payloadObject?.code);
  const requestId = toOptionalString(payloadObject?.request_id);
  const messageValue = toOptionalString(payloadObject?.message) ?? toOptionalString(payloadObject?.error) ?? toResponseSnippet(input.payload.raw);
  const message = `API ${input.path} failed: ${input.status}${code ? ` ${code}` : ""}${messageValue ? ` ${messageValue}` : ""}`;

  return new ApiRequestError({
    message,
    path: input.path,
    status: input.status,
    code,
    requestId,
    kind: "http"
  });
}

function ensureNonEmptyStringField(input: {
  value: unknown;
  key: string;
  path: string;
  contract: string;
}): string {
  if (typeof input.value !== "string" || input.value.trim().length === 0) {
    throw new ApiContractError({
      path: input.path,
      contract: input.contract,
      message: `API ${input.path} returned malformed response: missing ${input.key}`
    });
  }
  return input.value;
}

function parseGitHubIntegrationRow(input: {
  value: unknown;
  path: string;
  contract: string;
}): GitHubIntegrationRow {
  const record = asRecord(input.value);
  if (!record) {
    throw new ApiContractError({
      path: input.path,
      contract: input.contract,
      message: `API ${input.path} returned malformed response: missing integration`
    });
  }

  if (typeof record.is_active !== "boolean") {
    throw new ApiContractError({
      path: input.path,
      contract: input.contract,
      message: `API ${input.path} returned malformed response: missing integration.is_active`
    });
  }
  if (record.last_delivery_id !== null && record.last_delivery_id !== undefined && typeof record.last_delivery_id !== "string") {
    throw new ApiContractError({
      path: input.path,
      contract: input.contract,
      message: `API ${input.path} returned malformed response: malformed integration.last_delivery_id`
    });
  }
  if (record.last_seen_at !== null && record.last_seen_at !== undefined && typeof record.last_seen_at !== "string") {
    throw new ApiContractError({
      path: input.path,
      contract: input.contract,
      message: `API ${input.path} returned malformed response: malformed integration.last_seen_at`
    });
  }

  return {
    id: ensureNonEmptyStringField({
      value: record.id,
      key: "integration.id",
      path: input.path,
      contract: input.contract
    }),
    webhook_id: ensureNonEmptyStringField({
      value: record.webhook_id,
      key: "integration.webhook_id",
      path: input.path,
      contract: input.contract
    }),
    repository_full_name: record.repository_full_name === null ? null : typeof record.repository_full_name === "string" ? record.repository_full_name : null,
    is_active: record.is_active,
    last_delivery_id: record.last_delivery_id === undefined ? null : (record.last_delivery_id as string | null),
    last_seen_at: record.last_seen_at === undefined ? null : (record.last_seen_at as string | null),
    created_at: ensureNonEmptyStringField({
      value: record.created_at,
      key: "integration.created_at",
      path: input.path,
      contract: input.contract
    }),
    updated_at: ensureNonEmptyStringField({
      value: record.updated_at,
      key: "integration.updated_at",
      path: input.path,
      contract: input.contract
    })
  };
}

type IncidentRow = {
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
  details_json: Record<string, unknown>;
  guidance: IncidentGuidance;
};

export type WorkflowRow = {
  id: string;
  slug: string;
  display_name: string;
  environment: string;
  system: string;
};

export type WorkflowRegisterInput = {
  slug: string;
  display_name: string;
  system: string;
  environment: string;
};

export type BillingPlan = "free" | "pro" | "enterprise";
export type TrialStatus = "none" | "active" | "expired";
export type TrialSource = "manual" | "auto_ingest" | "auto_real_scan" | "auto_workflow_connect";

export type TenantTrialState = {
  status: TrialStatus;
  available: boolean;
  active: boolean;
  consumed: boolean;
  started_at: string | null;
  ends_at: string | null;
  source: TrialSource | null;
  days_remaining: number;
};

export type TenantSettings = {
  tenant_id: string;
  default_currency: SupportedCurrency;
  current_plan: BillingPlan;
  effective_plan: BillingPlan;
  trial: TenantTrialState;
};

export type ApiKeyRow = {
  id: string;
  name: string;
  key_preview: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export type GitHubIntegrationRow = {
  id: string;
  webhook_id: string;
  repository_full_name: string | null;
  is_active: boolean;
  last_delivery_id: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AlertChannelRow = {
  id: string;
  name: string;
  type: "slack" | "webhook" | "email";
  is_enabled: boolean;
  created_at: string;
  config_preview: Record<string, unknown>;
};

export type AlertPolicyRow = {
  id: string;
  name: string;
  metric: string;
  window_sec: number;
  threshold: number;
  comparator: "gt" | "gte" | "lt" | "lte" | "eq";
  min_events: number;
  severity: "warn" | "low" | "medium" | "high" | "critical";
  is_enabled: boolean;
  filter_workflow_id: string | null;
  filter_env: string | null;
  created_at: string;
  channels: Array<{
    id: string;
    name: string;
    type: "slack" | "webhook" | "email";
    is_enabled: boolean;
  }>;
};

export type ConnectedSourceRow = {
  id: string;
  type: "workflow" | "github_integration";
  name: string;
  status: "active" | "inactive";
  powers: string;
  details: Record<string, unknown>;
  last_activity_at: string | null;
  connected_at: string;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store"
    });
  } catch {
    throw new ApiRequestError({
      message: `API ${path} failed: network request error`,
      path,
      status: null,
      kind: "network"
    });
  }

  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw toHttpApiError({
      path,
      status: response.status,
      payload
    });
  }

  if (payload.json === null) {
    throw new ApiRequestError({
      message: `API ${path} failed: invalid JSON response`,
      path,
      status: response.status,
      code: "API_RESPONSE_INVALID_JSON",
      kind: "invalid_json"
    });
  }

  return payload.json as T;
}

export function extractApiErrorCode(error: unknown): string | null {
  if (error instanceof ApiRequestError) {
    return error.code;
  }
  if (!(error instanceof Error)) {
    return null;
  }
  if (error.message.includes("UPGRADE_REQUIRED")) {
    return "UPGRADE_REQUIRED";
  }
  if (error.message.includes("FORBIDDEN_PERMISSION")) {
    return "FORBIDDEN_PERMISSION";
  }
  return null;
}

export function isApiRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError;
}

export function isApiContractError(error: unknown): error is ApiContractError {
  return error instanceof ApiContractError;
}

export async function fetchOverview(token: string, range: "15m" | "1h" | "6h" | "24h" | "7d", workflowId?: string) {
  const params = new URLSearchParams({ range });
  if (workflowId) {
    params.set("workflow_id", workflowId);
  }

  return request<{
    summary: Record<string, unknown>;
    series: Array<Record<string, unknown>>;
    windows: Record<string, unknown>;
    last_updated: string;
  }>(`/v1/metrics/overview?${params.toString()}`, { token });
}

export async function fetchWorkflows(token: string) {
  return request<{
    workflows: WorkflowRow[];
  }>("/v1/workflows", { token });
}

export async function registerWorkflow(token: string, input: WorkflowRegisterInput) {
  return request<{
    workflow: WorkflowRow;
  }>("/v1/workflows/register", {
    token,
    method: "POST",
    body: input
  });
}

export async function fetchTenantSettings(token: string) {
  return request<{
    settings: TenantSettings;
  }>("/v1/settings/tenant", { token });
}

export async function updateTenantSettings(token: string, defaultCurrency: SupportedCurrency) {
  return request<{
    settings: TenantSettings;
  }>("/v1/settings/tenant", {
    token,
    method: "PATCH",
    body: {
      default_currency: defaultCurrency
    }
  });
}

export async function startTenantTrial(token: string) {
  return request<{
    result: {
      code: "started" | "already_active" | "already_used" | "not_eligible";
      started: boolean;
      message: string;
    };
    settings: TenantSettings;
  }>("/v1/settings/tenant/trial/start", {
    token,
    method: "POST"
  });
}

export async function fetchIncidents(
  token: string,
  status?: string,
  page = 1,
  pageSize = 25,
  workflowId?: string
) {
  const params = new URLSearchParams();
  if (status) {
    params.set("status", status);
  }
  if (workflowId) {
    params.set("workflow_id", workflowId);
  }
  params.set("page", String(page));
  params.set("page_size", String(pageSize));

  const query = params.toString();
  return request<{
    incidents: IncidentRow[];
    pagination: { page: number; page_size: number; total: number; has_next: boolean };
    last_updated: string;
  }>(
    `/v1/incidents${query ? `?${query}` : ""}`,
    { token }
  );
}

export async function fetchIncidentById(token: string, incidentId: string) {
  return request<{
    incident: IncidentRow;
    recent_events: Array<{
      id: number;
      event_type: string;
      at_time: string;
      payload_json: Record<string, unknown>;
    }>;
  }>(`/v1/incidents/${incidentId}`, { token });
}

export async function postIncidentAction(token: string, incidentId: string, action: "ack" | "resolve") {
  return request(`/v1/incidents/${incidentId}/${action}`, {
    token,
    method: "POST"
  });
}

export async function fetchMe(token: string) {
  return request<{
    user: {
      user_id: string;
      email: string;
      full_name: string;
      tenant_id: string;
      role: "owner" | "admin" | "engineer" | "viewer";
      email_verified_at: string | null;
    };
  }>("/v1/auth/me", { token });
}

export async function changePassword(token: string, currentPassword: string, newPassword: string) {
  return request<{ ok: boolean }>("/v1/auth/change-password", {
    token,
    method: "POST",
    body: {
      current_password: currentPassword,
      new_password: newPassword
    }
  });
}

export async function requestEmailVerification(token: string) {
  return request<{ ok: boolean }>("/v1/auth/email/verification/request", {
    token,
    method: "POST"
  });
}

export async function confirmEmailVerification(token: string) {
  return request<{ ok: boolean }>("/v1/auth/email/verification/confirm", {
    method: "POST",
    body: { token }
  });
}

export async function requestPasswordReset(email: string, tenantId?: string) {
  return request<{ ok: boolean }>("/v1/auth/password-reset/request", {
    method: "POST",
    body: {
      email,
      tenant_id: tenantId
    }
  });
}

export async function confirmPasswordReset(token: string, password: string) {
  return request<{ ok: boolean }>("/v1/auth/password-reset/confirm", {
    method: "POST",
    body: { token, password }
  });
}

export async function fetchTeamUsers(token: string) {
  return request<{
    users: Array<{
      id: string;
      email: string;
      full_name: string;
      role: "owner" | "admin" | "engineer" | "viewer";
      email_verified_at: string | null;
      created_at: string;
      updated_at: string;
      disabled_at: string | null;
    }>;
  }>("/v1/team/users", { token });
}

export async function fetchTeamInvites(token: string) {
  return request<{
    invites: Array<{
      id: string;
      email: string;
      role: "owner" | "admin" | "engineer" | "viewer";
      expires_at: string;
      accepted_at: string | null;
      created_at: string;
      invited_by_user: { id: string; email: string; full_name: string };
    }>;
  }>("/v1/team/invites", { token });
}

export async function inviteTeamUser(token: string, email: string, role: "owner" | "admin" | "engineer" | "viewer") {
  return request<{ invite: { id: string; email: string; role: string; expires_at: string } }>("/v1/team/invite", {
    token,
    method: "POST",
    body: {
      email,
      role
    }
  });
}

export async function updateTeamUserRole(
  token: string,
  userId: string,
  role: "owner" | "admin" | "engineer" | "viewer"
) {
  return request<{ user: Record<string, unknown> }>(`/v1/team/users/${userId}/role`, {
    token,
    method: "POST",
    body: { role }
  });
}

export async function disableTeamUser(token: string, userId: string) {
  return request<{ user: Record<string, unknown> }>(`/v1/team/users/${userId}/disable`, {
    token,
    method: "POST"
  });
}

export async function fetchSecurityEvents(
  token: string,
  options: {
    type?: "REFRESH_REUSE_DETECTED" | "LOGIN_FAILED" | "LOGIN_LOCKED" | "INVITE_RATE_LIMITED";
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  } = {}
) {
  const params = new URLSearchParams();
  if (options.type) {
    params.set("type", options.type);
  }
  if (options.from) {
    params.set("from", options.from);
  }
  if (options.to) {
    params.set("to", options.to);
  }
  params.set("page", String(options.page ?? 1));
  params.set("limit", String(options.limit ?? 25));

  return request<{
    events: Array<{
      id: string;
      type: string;
      created_at: string;
      ip: string | null;
      user_agent: string | null;
      metadata_json: Record<string, unknown>;
      actor: {
        id: string;
        email: string;
        full_name: string;
      } | null;
    }>;
    pagination: { page: number; limit: number; total: number; has_next: boolean };
  }>(`/v1/security-events?${params.toString()}`, { token });
}

export async function fetchApiKeys(token: string) {
  return request<{
    api_keys: ApiKeyRow[];
  }>("/v1/control-plane/api-keys?include_revoked=true", { token });
}

export async function createApiKey(token: string, name: string) {
  return request<{
    api_key: ApiKeyRow;
    secret: string;
  }>("/v1/control-plane/api-keys", {
    token,
    method: "POST",
    body: {
      name
    }
  });
}

export async function revokeApiKey(token: string, id: string) {
  return request<{
    ok: boolean;
    api_key_id: string;
  }>(`/v1/control-plane/api-keys/${id}/revoke`, {
    token,
    method: "POST"
  });
}

export async function rotateApiKey(token: string, id: string) {
  return request<{
    rotated_from_api_key_id: string;
    api_key: ApiKeyRow;
    secret: string;
  }>(`/v1/control-plane/api-keys/${id}/rotate`, {
    token,
    method: "POST"
  });
}

export async function fetchGitHubIntegrations(token: string) {
  return request<{
    webhook_url: string;
    integrations: GitHubIntegrationRow[];
  }>("/v1/control-plane/github-integrations", { token });
}

export async function createGitHubIntegration(token: string, repositoryFullName?: string) {
  return request<{
    webhook_url: string;
    integration: GitHubIntegrationRow;
    webhook_secret: string;
  }>("/v1/control-plane/github-integrations", {
    token,
    method: "POST",
    body: {
      repository_full_name: repositoryFullName || undefined
    }
  });
}

export async function deactivateGitHubIntegration(token: string, id: string) {
  return request<{
    integration: GitHubIntegrationRow;
  }>(`/v1/control-plane/github-integrations/${id}/deactivate`, {
    token,
    method: "POST"
  });
}

export async function rotateGitHubIntegrationSecret(token: string, id: string) {
  const path = `/v1/control-plane/github-integrations/${id}/rotate-secret`;
  const response = await request<unknown>(path, {
    token,
    method: "POST"
  });

  const payload = asRecord(response);
  if (!payload) {
    throw new ApiContractError({
      path,
      contract: "github_rotate_secret_response",
      message: `API ${path} returned malformed response: expected object body`
    });
  }

  return {
    webhook_url: ensureNonEmptyStringField({
      value: payload.webhook_url,
      key: "webhook_url",
      path,
      contract: "github_rotate_secret_response"
    }),
    integration: parseGitHubIntegrationRow({
      value: payload.integration,
      path,
      contract: "github_rotate_secret_response"
    }),
    webhook_secret: ensureNonEmptyStringField({
      value: payload.webhook_secret,
      key: "webhook_secret",
      path,
      contract: "github_rotate_secret_response"
    })
  };
}

export async function fetchAlertChannels(token: string) {
  return request<{
    channels: AlertChannelRow[];
  }>("/v1/control-plane/alert-channels", { token });
}

export async function createAlertChannel(
  token: string,
  input:
    | {
        type: "slack";
        name: string;
        config: { webhook_url: string };
      }
    | {
        type: "webhook";
        name: string;
        config: { url: string };
      }
    | {
        type: "email";
        name: string;
        config: { email: string };
      }
) {
  return request<{
    channel: AlertChannelRow;
  }>("/v1/control-plane/alert-channels", {
    token,
    method: "POST",
    body: input
  });
}

export async function updateAlertChannel(
  token: string,
  id: string,
  input: {
    name?: string;
    is_enabled?: boolean;
    config?: Record<string, unknown>;
  }
) {
  return request<{
    channel: AlertChannelRow;
  }>(`/v1/control-plane/alert-channels/${id}`, {
    token,
    method: "PATCH",
    body: input
  });
}

export async function deleteAlertChannel(token: string, id: string) {
  return request<{
    ok: boolean;
    channel_id: string;
  }>(`/v1/control-plane/alert-channels/${id}`, {
    token,
    method: "DELETE"
  });
}

export async function fetchAlertPolicies(token: string) {
  return request<{
    policies: AlertPolicyRow[];
  }>("/v1/control-plane/alert-policies", { token });
}

export async function createAlertPolicy(
  token: string,
  input: {
    name: string;
    metric: string;
    window_sec: number;
    threshold: number;
    comparator: "gt" | "gte" | "lt" | "lte" | "eq";
    min_events: number;
    severity: "warn" | "low" | "medium" | "high" | "critical";
    is_enabled: boolean;
    filter_workflow_id?: string;
    filter_env?: string;
    channel_ids: string[];
  }
) {
  return request<{
    policy: AlertPolicyRow;
  }>("/v1/control-plane/alert-policies", {
    token,
    method: "POST",
    body: input
  });
}

export async function updateAlertPolicy(
  token: string,
  id: string,
  input: Partial<{
    name: string;
    metric: string;
    window_sec: number;
    threshold: number;
    comparator: "gt" | "gte" | "lt" | "lte" | "eq";
    min_events: number;
    severity: "warn" | "low" | "medium" | "high" | "critical";
    is_enabled: boolean;
    filter_workflow_id: string | null;
    filter_env: string | null;
    channel_ids: string[];
  }>
) {
  return request<{
    policy: AlertPolicyRow;
  }>(`/v1/control-plane/alert-policies/${id}`, {
    token,
    method: "PATCH",
    body: input
  });
}

export async function deleteAlertPolicy(token: string, id: string) {
  return request<{
    ok: boolean;
    policy_id: string;
  }>(`/v1/control-plane/alert-policies/${id}`, {
    token,
    method: "DELETE"
  });
}

export async function fetchConnectedSources(token: string) {
  return request<{
    summary: {
      workflow_sources: number;
      github_sources: number;
      ingestion_keys_active: number;
      alert_channels_ready: number;
    };
    sources: ConnectedSourceRow[];
    readiness: {
      ingestion_api_keys_configured: boolean;
      alert_dispatch_ready: boolean;
    };
  }>("/v1/control-plane/sources", { token });
}
