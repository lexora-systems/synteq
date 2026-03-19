import { apiBaseUrl } from "./config";
import type { IncidentGuidance, SupportedCurrency } from "@synteq/shared";

type RequestOptions = {
  token?: string;
  method?: string;
  body?: unknown;
};

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

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store"
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${path} failed: ${response.status} ${text}`);
  }

  return (await response.json()) as T;
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
