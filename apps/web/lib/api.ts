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
