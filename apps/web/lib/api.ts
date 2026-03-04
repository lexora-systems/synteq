import { apiBaseUrl } from "./config";

type RequestOptions = {
  token?: string;
  method?: string;
  body?: unknown;
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

export async function fetchIncidents(token: string, status?: string, page = 1, pageSize = 25) {
  const params = new URLSearchParams();
  if (status) {
    params.set("status", status);
  }
  params.set("page", String(page));
  params.set("page_size", String(pageSize));

  const query = params.toString();
  return request<{
    incidents: Array<Record<string, unknown>>;
    pagination: { page: number; page_size: number; total: number; has_next: boolean };
    last_updated: string;
  }>(
    `/v1/incidents${query ? `?${query}` : ""}`,
    { token }
  );
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

export async function requestPasswordReset(email: string) {
  return request<{ ok: boolean }>("/v1/auth/password-reset/request", {
    method: "POST",
    body: { email }
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
