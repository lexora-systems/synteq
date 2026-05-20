import http from "node:http";

const PORT = Number(process.env.MOCK_API_PORT ?? 4010);

const USERS = {
  "nonactivated@synteq.local": { password: "Password123!", persona: "nonactivated" },
  "activated@synteq.local": { password: "Password123!", persona: "activated" },
  "invitee@synteq.local": { password: "Password123!", persona: "nonactivated" }
};

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function issueAccessToken(persona) {
  const header = encodeBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = encodeBase64Url(
    JSON.stringify({
      sub: `user-${persona}`,
      persona,
      role: "owner",
      exp: Math.floor(Date.now() / 1000) + 60 * 60
    })
  );
  return `${header}.${payload}.signature`;
}

function issueRefreshToken(persona) {
  return `refresh-${persona}`;
}

function parseJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function parseAuthPersona(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length);
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.persona === "string" ? payload.persona : null;
  } catch {
    return null;
  }
}

function ensureAuth(req, res) {
  const persona = parseAuthPersona(req);
  if (!persona) {
    sendJson(res, 401, { error: "Unauthorized", code: "AUTH_REQUIRED" });
    return null;
  }
  return persona;
}

function tenantSettings() {
  return {
    settings: {
      tenant_id: "tenant-e2e",
      default_currency: "USD",
      current_plan: "free",
      effective_plan: "free",
      trial: {
        status: "none",
        available: true,
        active: false,
        consumed: false,
        started_at: null,
        ends_at: null,
        source: null,
        days_remaining: 0
      }
    }
  };
}

function incidentGuidance() {
  return {
    incident_type: "failure_rate_spike",
    likely_causes: ["recent workflow failure"],
    business_impact: "Payment automation may be delayed until the workflow stabilizes.",
    recommended_actions: ["Review the failed run and retry after remediation."],
    confidence: "medium",
    evidence: ["workflow=wf_1", "severity=high"],
    generated_by: "rules_v1",
    summary_text: "Payments Daily is reporting elevated failures."
  };
}

function mockIncident() {
  return {
    id: "inc-e2e-1",
    tenant_id: "tenant-e2e",
    workflow_id: "wf_1",
    environment: "prod",
    policy_id: "policy-e2e",
    status: "open",
    severity: "high",
    started_at: "2026-05-01T09:45:00.000Z",
    last_seen_at: "2026-05-01T09:58:00.000Z",
    resolved_at: null,
    summary: "Payments Daily failure spike",
    details_json: {
      source: "generic_workflow_event_detection",
      workflowId: "wf_1",
      workflowName: "Payments Daily",
      environment: "prod"
    },
    guidance: incidentGuidance()
  };
}

function operationalDashboardPayload(activated) {
  return {
    generatedAt: "2026-05-01T10:00:00.000Z",
    globalState: activated ? "failing" : "unknown",
    activeIncidents: {
      total: activated ? 1 : 0,
      bySeverity: {
        critical: 0,
        high: activated ? 1 : 0,
        medium: 0,
        low: 0,
        unknown: 0
      }
    },
    recentlyResolved: {
      total: 0,
      windowHours: 24
    },
    sources: {
      total: activated ? 1 : 0,
      fresh: activated ? 1 : 0,
      stale: 0,
      unknown: 0,
      items: activated
        ? [
            {
              id: "wf_1",
              name: "Payments Daily",
              type: "workflow",
              state: "fresh",
              lastSignalAt: "2026-05-01T09:58:00.000Z"
            }
          ]
        : []
    },
    workflows: {
      total: activated ? 1 : 0,
      healthy: 0,
      degraded: 0,
      failing: activated ? 1 : 0,
      unknown: 0,
      items: activated
        ? [
            {
              id: "wf_1",
              name: "Payments Daily",
              sourceName: "workflow",
              environment: "prod",
              state: "failing",
              lastSignalAt: "2026-05-01T09:58:00.000Z",
              activeIncidentCount: 1
            }
          ]
        : []
    },
    pipeline: {
      state: activated ? "fresh" : "unknown",
      jobs: [
        {
          name: "aggregate",
          state: activated ? "fresh" : "unknown",
          lastSeenAt: activated ? "2026-05-01T09:59:00.000Z" : null
        },
        {
          name: "anomaly",
          state: activated ? "fresh" : "unknown",
          lastSeenAt: activated ? "2026-05-01T09:59:00.000Z" : null
        },
        {
          name: "alerts",
          state: activated ? "fresh" : "unknown",
          lastSeenAt: activated ? "2026-05-01T09:59:00.000Z" : null
        }
      ]
    },
    events: {
      windowHours: 1,
      succeeded: activated ? 11 : 0,
      failed: activated ? 1 : 0,
      timedOut: 0,
      unknown: 0
    }
  };
}

function reliabilityWindowsPayload(activated) {
  return {
    generatedAt: "2026-05-01T10:00:00.000Z",
    scope: {
      tenantId: "tenant-e2e",
      workflowId: null,
      sourceId: null,
      sourceKey: null
    },
    windows: [
      {
        label: "1h",
        startAt: "2026-05-01T09:00:00.000Z",
        endAt: "2026-05-01T10:00:00.000Z",
        total: activated ? 12 : 0,
        succeeded: activated ? 11 : 0,
        failed: activated ? 1 : 0,
        timedOut: 0,
        unknown: 0,
        successRate: activated ? 0.9167 : null,
        failureRate: activated ? 0.0833 : null,
        timeoutRate: activated ? 0 : null,
        lastSignalAt: activated ? "2026-05-01T09:58:00.000Z" : null,
        state: activated ? "degraded" : "unknown"
      },
      {
        label: "24h",
        startAt: "2026-04-30T10:00:00.000Z",
        endAt: "2026-05-01T10:00:00.000Z",
        total: activated ? 24 : 0,
        succeeded: activated ? 23 : 0,
        failed: activated ? 1 : 0,
        timedOut: 0,
        unknown: 0,
        successRate: activated ? 0.9583 : null,
        failureRate: activated ? 0.0417 : null,
        timeoutRate: activated ? 0 : null,
        lastSignalAt: activated ? "2026-05-01T09:58:00.000Z" : null,
        state: activated ? "degraded" : "unknown"
      },
      {
        label: "7d",
        startAt: "2026-04-24T10:00:00.000Z",
        endAt: "2026-05-01T10:00:00.000Z",
        total: activated ? 50 : 0,
        succeeded: activated ? 49 : 0,
        failed: activated ? 1 : 0,
        timedOut: 0,
        unknown: 0,
        successRate: activated ? 0.98 : null,
        failureRate: activated ? 0.02 : null,
        timeoutRate: activated ? 0 : null,
        lastSignalAt: activated ? "2026-05-01T09:58:00.000Z" : null,
        state: activated ? "degraded" : "unknown"
      }
    ]
  };
}

function attentionGroupsPayload(activated) {
  return {
    generatedAt: "2026-05-01T10:00:00.000Z",
    groups: activated
      ? [
          {
            id: "attn_e2e_payments",
            label: "Payments Daily / prod",
            attention: "elevated",
            incidentCount: 1,
            highestSeverity: "high",
            lastSeenAt: "2026-05-01T09:58:00.000Z",
            alertFailureCount: 0,
            activeStatuses: {
              open: 1,
              acked: 0
            },
            groupKey: {
              workflowId: "wf_1",
              workflowName: "Payments Daily",
              environment: "prod"
            }
          }
        ]
      : []
  };
}

let apiKeyCounter = 1;
let githubCounter = 1;
let workflowSourceCounter = 1;
let alertChannelCounter = 1;
let alertPolicyCounter = 1;
let failNextGitHubIntegrationsList = false;
let failNextGitHubRotate = false;
let omitNextGitHubRotateSecret = false;
let failNextGitHubDeactivateAfterMutation = false;
let failNextControlPlaneSources = false;
let failControlPlaneSources = false;
let failNextSilentCheckUnsupported = false;
let nullControlPlaneSourceDetails = false;
let failAuthMe = false;
let failWorkflows = false;
let failMetricsOverview = false;
let failOperationalDashboard = false;
let failReliabilityWindows = false;
let failIncidentsList = false;
let malformedIncidentsList = false;
let failIncidentDetail = false;
let failIncidentTimeline = false;

const API_KEYS = [];

const WORKFLOW_SOURCES = [];
const GITHUB_INTEGRATIONS = [];
const ALERT_CHANNELS = [];
const ALERT_POLICIES = [];

function resetState() {
  apiKeyCounter = 1;
  githubCounter = 1;
  workflowSourceCounter = 1;
  alertChannelCounter = 1;
  alertPolicyCounter = 1;
  failNextGitHubIntegrationsList = false;
  failNextGitHubRotate = false;
  omitNextGitHubRotateSecret = false;
  failNextGitHubDeactivateAfterMutation = false;
  failNextControlPlaneSources = false;
  failControlPlaneSources = false;
  failNextSilentCheckUnsupported = false;
  nullControlPlaneSourceDetails = false;
  failAuthMe = false;
  failWorkflows = false;
  failMetricsOverview = false;
  failOperationalDashboard = false;
  failReliabilityWindows = false;
  failIncidentsList = false;
  malformedIncidentsList = false;
  failIncidentDetail = false;
  failIncidentTimeline = false;

  API_KEYS.length = 0;
  API_KEYS.push({
    id: `key-${apiKeyCounter}`,
    name: "Primary ingest key",
    key_preview: "synteq_****abcdef",
    created_at: new Date().toISOString(),
    last_used_at: null,
    revoked_at: null
  });
  WORKFLOW_SOURCES.length = 0;
  GITHUB_INTEGRATIONS.length = 0;
  ALERT_CHANNELS.length = 0;
  ALERT_POLICIES.length = 0;
}

resetState();

function currentWebhookUrl(req) {
  const host = req.headers.host ?? `127.0.0.1:${PORT}`;
  return `http://${host}/v1/integrations/github/webhook`;
}

function currentWorkflowEventIngestUrl(req) {
  const host = req.headers.host ?? `127.0.0.1:${PORT}`;
  return `http://${host}/v1/ingest/workflow-event`;
}

function slugify(value) {
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return slug || "workflow-source";
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && pathname === "/__test/reset") {
    resetState();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && pathname === "/__test/config") {
    const body = await parseJsonBody(req);
    if (typeof body.fail_next_github_integrations_get === "boolean") {
      failNextGitHubIntegrationsList = body.fail_next_github_integrations_get;
    }
    if (typeof body.fail_next_github_rotate_post === "boolean") {
      failNextGitHubRotate = body.fail_next_github_rotate_post;
    }
    if (typeof body.omit_next_github_rotate_secret === "boolean") {
      omitNextGitHubRotateSecret = body.omit_next_github_rotate_secret;
    }
    if (typeof body.fail_next_github_deactivate_after_mutation === "boolean") {
      failNextGitHubDeactivateAfterMutation = body.fail_next_github_deactivate_after_mutation;
    }
    if (typeof body.fail_next_control_plane_sources_get === "boolean") {
      failNextControlPlaneSources = body.fail_next_control_plane_sources_get;
    }
    if (typeof body.fail_control_plane_sources_get === "boolean") {
      failControlPlaneSources = body.fail_control_plane_sources_get;
    }
    if (typeof body.fail_next_silent_check_unsupported === "boolean") {
      failNextSilentCheckUnsupported = body.fail_next_silent_check_unsupported;
    }
    if (typeof body.null_control_plane_source_details === "boolean") {
      nullControlPlaneSourceDetails = body.null_control_plane_source_details;
    }
    if (typeof body.fail_auth_me_get === "boolean") {
      failAuthMe = body.fail_auth_me_get;
    }
    if (typeof body.fail_workflows_get === "boolean") {
      failWorkflows = body.fail_workflows_get;
    }
    if (typeof body.fail_metrics_overview_get === "boolean") {
      failMetricsOverview = body.fail_metrics_overview_get;
    }
    if (typeof body.fail_operational_dashboard_get === "boolean") {
      failOperationalDashboard = body.fail_operational_dashboard_get;
    }
    if (typeof body.fail_reliability_windows_get === "boolean") {
      failReliabilityWindows = body.fail_reliability_windows_get;
    }
    if (typeof body.fail_incidents_get === "boolean") {
      failIncidentsList = body.fail_incidents_get;
    }
    if (typeof body.malformed_incidents_get === "boolean") {
      malformedIncidentsList = body.malformed_incidents_get;
    }
    if (typeof body.fail_incident_detail_get === "boolean") {
      failIncidentDetail = body.fail_incident_detail_get;
    }
    if (typeof body.fail_incident_timeline_get === "boolean") {
      failIncidentTimeline = body.fail_incident_timeline_get;
    }
    sendJson(res, 200, {
      ok: true,
      fail_next_github_integrations_get: failNextGitHubIntegrationsList,
      fail_next_github_rotate_post: failNextGitHubRotate,
      omit_next_github_rotate_secret: omitNextGitHubRotateSecret,
      fail_next_github_deactivate_after_mutation: failNextGitHubDeactivateAfterMutation,
      fail_next_control_plane_sources_get: failNextControlPlaneSources,
      fail_control_plane_sources_get: failControlPlaneSources,
      fail_next_silent_check_unsupported: failNextSilentCheckUnsupported,
      null_control_plane_source_details: nullControlPlaneSourceDetails,
      fail_auth_me_get: failAuthMe,
      fail_workflows_get: failWorkflows,
      fail_metrics_overview_get: failMetricsOverview,
      fail_operational_dashboard_get: failOperationalDashboard,
      fail_reliability_windows_get: failReliabilityWindows,
      fail_incidents_get: failIncidentsList,
      malformed_incidents_get: malformedIncidentsList,
      fail_incident_detail_get: failIncidentDetail,
      fail_incident_timeline_get: failIncidentTimeline
    });
    return;
  }

  if (req.method === "POST" && pathname === "/v1/auth/login") {
    const body = await parseJsonBody(req);
    const email = typeof body.email === "string" ? body.email.toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const user = USERS[email];

    if (!user || user.password !== password) {
      sendJson(res, 401, {
        error: "Invalid credentials",
        code: "AUTH_INVALID_CREDENTIALS"
      });
      return;
    }

    sendJson(res, 200, {
      access_token: issueAccessToken(user.persona),
      refresh_token: issueRefreshToken(user.persona)
    });
    return;
  }

  if (req.method === "POST" && pathname === "/v1/auth/refresh") {
    const body = await parseJsonBody(req);
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
    const persona = refreshToken.startsWith("refresh-") ? refreshToken.slice("refresh-".length) : "";
    if (!persona) {
      sendJson(res, 401, { error: "Invalid refresh token", code: "AUTH_REFRESH_FAILED" });
      return;
    }
    sendJson(res, 200, {
      access_token: issueAccessToken(persona),
      refresh_token: issueRefreshToken(persona)
    });
    return;
  }

  if (req.method === "POST" && pathname.startsWith("/v1/team/invite/") && pathname.endsWith("/accept")) {
    const body = await parseJsonBody(req);
    if (!body.full_name || !body.password) {
      sendJson(res, 400, { error: "Missing fields" });
      return;
    }
    sendJson(res, 200, {
      access_token: issueAccessToken("nonactivated"),
      refresh_token: issueRefreshToken("nonactivated")
    });
    return;
  }

  if (req.method === "GET" && pathname === "/v1/workflows") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    if (failWorkflows) {
      sendJson(res, 500, { error: "mock workflows failure" });
      return;
    }
    if (persona === "activated") {
      sendJson(res, 200, {
        workflows: [
          {
            id: "wf_1",
            slug: "payments-daily",
            display_name: "Payments Daily",
            environment: "prod",
            system: "checkout-service"
          }
        ]
      });
      return;
    }
    sendJson(res, 200, { workflows: [] });
    return;
  }

  if (req.method === "GET" && pathname === "/v1/metrics/overview") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    if (failMetricsOverview) {
      sendJson(res, 500, { error: "mock metrics overview failure" });
      return;
    }
    const activated = persona === "activated";
    sendJson(res, 200, {
      summary: {
        count_total: activated ? 12 : 0,
        count_success: activated ? 11 : 0,
        count_failed: activated ? 1 : 0,
        p95_duration_ms: activated ? 950 : 0,
        retry_rate: activated ? 0.05 : 0,
        duplicate_rate: activated ? 0.01 : 0,
        avg_cost_usd: activated ? 0.13 : 0,
        sum_cost_usd: activated ? 1.56 : 0
      },
      series: activated
        ? [
            {
              bucket_ts: new Date().toISOString(),
              count_total: 12,
              count_success: 11,
              count_failed: 1,
              p95_duration_ms: 950,
              retry_rate: 0.05,
              duplicate_rate: 0.01,
              avg_cost_usd: 0.13
            }
          ]
        : [],
      windows: {
        "5m": { count_failed: activated ? 1 : 0 },
        "15m": { count_failed: activated ? 1 : 0 }
      },
      last_updated: new Date().toISOString()
    });
    return;
  }

  if (req.method === "GET" && pathname === "/v1/metrics/operational-dashboard") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    if (failOperationalDashboard) {
      sendJson(res, 500, { error: "mock operational dashboard failure" });
      return;
    }
    sendJson(res, 200, operationalDashboardPayload(persona === "activated"));
    return;
  }

  if (req.method === "GET" && pathname === "/v1/metrics/reliability-windows") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    if (failReliabilityWindows) {
      sendJson(res, 500, { error: "mock reliability windows failure" });
      return;
    }
    sendJson(res, 200, reliabilityWindowsPayload(persona === "activated"));
    return;
  }

  if (req.method === "GET" && pathname === "/v1/settings/tenant") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    sendJson(res, 200, tenantSettings());
    return;
  }

  if (req.method === "GET" && pathname === "/v1/auth/me") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    if (failAuthMe) {
      sendJson(res, 500, { error: "mock auth me failure" });
      return;
    }
    sendJson(res, 200, {
      user: {
        user_id: `user_${persona}`,
        email: `${persona}@synteq.local`,
        full_name: persona === "activated" ? "Activated Owner" : "New Owner",
        tenant_id: "tenant-e2e",
        role: "owner",
        email_verified_at: new Date().toISOString()
      }
    });
    return;
  }

  if (req.method === "GET" && pathname === "/v1/incidents") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    if (failIncidentsList) {
      sendJson(res, 500, { error: "mock incidents failure" });
      return;
    }
    if (malformedIncidentsList) {
      sendJson(res, 200, {
        incidents: [
          {
            id: "inc-malformed",
            details_json: null,
            guidance: null
          }
        ],
        pagination: null,
        last_updated: "not-a-date"
      });
      return;
    }
    const activated = persona === "activated";
    sendJson(res, 200, {
      incidents: activated ? [mockIncident()] : [],
      pagination: { page: 1, page_size: 25, total: activated ? 1 : 0, has_next: false },
      last_updated: new Date().toISOString()
    });
    return;
  }

  if (req.method === "GET" && pathname === "/v1/incidents/attention-groups") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    sendJson(res, 200, attentionGroupsPayload(persona === "activated"));
    return;
  }

  if (req.method === "GET" && pathname.match(/^\/v1\/incidents\/[^/]+\/timeline$/)) {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    if (failIncidentTimeline) {
      sendJson(res, 500, { error: "mock incident timeline failure" });
      return;
    }
    const id = pathname.split("/")[3];
    if (persona !== "activated" || id !== "inc-e2e-1") {
      sendJson(res, 404, { error: "Incident not found" });
      return;
    }
    sendJson(res, 200, {
      incident_id: id,
      timeline: [
        {
          id: "incident:inc-e2e-1:created",
          at: "2026-05-01T09:45:00.000Z",
          type: "incident_created",
          title: "Incident opened",
          description: "Payments Daily failure spike",
          severity: "high",
          workflow: "Payments Daily",
          environment: "prod"
        },
        {
          id: "incident_event:1",
          at: "2026-05-01T09:46:00.000Z",
          type: "alert_pending",
          title: "Alert queued",
          description: "An alert dispatch was queued for this incident.",
          severity: "high",
          workflow: "Payments Daily",
          environment: "prod"
        }
      ]
    });
    return;
  }

  if (req.method === "GET" && pathname.match(/^\/v1\/incidents\/[^/]+$/)) {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    if (failIncidentDetail) {
      sendJson(res, 500, { error: "mock incident detail failure" });
      return;
    }
    const id = pathname.split("/")[3];
    if (persona !== "activated" || id !== "inc-e2e-1") {
      sendJson(res, 404, { error: "Incident not found" });
      return;
    }
    sendJson(res, 200, {
      incident: mockIncident(),
      recent_events: [
        {
          id: 1,
          event_type: "ALERT_PENDING",
          at_time: "2026-05-01T09:46:00.000Z",
          summary: "Alert dispatch was queued.",
          metadata: {
            source: "generic_workflow_event_detection"
          }
        },
        {
          id: 2,
          event_type: "DETECTED",
          at_time: "2026-05-01T09:58:00.000Z",
          summary: "Detection condition was observed again.",
          metadata: {
            metric: "failure_rate",
            severity: "high"
          }
        }
      ]
    });
    return;
  }

  if (req.method === "GET" && pathname === "/v1/control-plane/api-keys") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    sendJson(res, 200, {
      api_keys: API_KEYS
    });
    return;
  }

  if (req.method === "POST" && pathname === "/v1/control-plane/api-keys") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    const body = await parseJsonBody(req);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      sendJson(res, 400, { error: "name required" });
      return;
    }
    apiKeyCounter += 1;
    const created = {
      id: `key-${apiKeyCounter}`,
      name,
      key_preview: `synteq_****${String(apiKeyCounter).padStart(6, "0")}`,
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked_at: null
    };
    API_KEYS.unshift(created);
    sendJson(res, 201, {
      api_key: created,
      secret: `synteq_mock_secret_${apiKeyCounter}`
    });
    return;
  }

  if (req.method === "POST" && pathname.match(/^\/v1\/control-plane\/api-keys\/[^/]+\/revoke$/)) {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    const id = pathname.split("/")[4];
    const found = API_KEYS.find((item) => item.id === id);
    if (!found) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    found.revoked_at = new Date().toISOString();
    sendJson(res, 200, {
      ok: true,
      api_key_id: id
    });
    return;
  }

  if (req.method === "POST" && pathname.match(/^\/v1\/control-plane\/api-keys\/[^/]+\/rotate$/)) {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    const id = pathname.split("/")[4];
    const found = API_KEYS.find((item) => item.id === id);
    if (!found) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    found.revoked_at = new Date().toISOString();
    apiKeyCounter += 1;
    const rotated = {
      id: `key-${apiKeyCounter}`,
      name: found.name,
      key_preview: `synteq_****${String(apiKeyCounter).padStart(6, "0")}`,
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked_at: null
    };
    API_KEYS.unshift(rotated);
    sendJson(res, 200, {
      rotated_from_api_key_id: id,
      api_key: rotated,
      secret: `synteq_mock_secret_${apiKeyCounter}`
    });
    return;
  }

  if (req.method === "GET" && pathname === "/v1/control-plane/github-integrations") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    if (failNextGitHubIntegrationsList) {
      failNextGitHubIntegrationsList = false;
      sendJson(res, 500, { error: "mock github list refresh failure" });
      return;
    }
    sendJson(res, 200, {
      webhook_url: currentWebhookUrl(req),
      integrations: GITHUB_INTEGRATIONS
    });
    return;
  }

  if (req.method === "POST" && pathname === "/v1/control-plane/github-integrations") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    const body = await parseJsonBody(req);
    const repositoryFullName =
      typeof body.repository_full_name === "string" && body.repository_full_name.trim().length > 0
        ? body.repository_full_name.trim()
        : null;

    githubCounter += 1;
    const integration = {
      id: `gh-${githubCounter}`,
      webhook_id: `hook-${githubCounter}`,
      repository_full_name: repositoryFullName,
      is_active: true,
      last_delivery_id: null,
      last_seen_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    GITHUB_INTEGRATIONS.unshift(integration);
    sendJson(res, 201, {
      webhook_url: currentWebhookUrl(req),
      integration,
      webhook_secret: `gh_mock_secret_${githubCounter}`
    });
    return;
  }

  if (req.method === "POST" && pathname.match(/^\/v1\/control-plane\/github-integrations\/[^/]+\/deactivate$/)) {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    const id = pathname.split("/")[4];
    const found = GITHUB_INTEGRATIONS.find((item) => item.id === id);
    if (!found) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    found.is_active = false;
    found.updated_at = new Date().toISOString();
    if (failNextGitHubDeactivateAfterMutation) {
      failNextGitHubDeactivateAfterMutation = false;
      sendJson(res, 500, { error: "mock github deactivate response failure after mutation" });
      return;
    }
    sendJson(res, 200, {
      integration: found
    });
    return;
  }

  if (req.method === "POST" && pathname.match(/^\/v1\/control-plane\/github-integrations\/[^/]+\/rotate-secret$/)) {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    if (failNextGitHubRotate) {
      failNextGitHubRotate = false;
      sendJson(res, 500, { error: "mock github rotate failure" });
      return;
    }
    const id = pathname.split("/")[4];
    const found = GITHUB_INTEGRATIONS.find((item) => item.id === id);
    if (!found) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    found.updated_at = new Date().toISOString();
    if (omitNextGitHubRotateSecret) {
      omitNextGitHubRotateSecret = false;
      sendJson(res, 200, {
        webhook_url: currentWebhookUrl(req),
        integration: found
      });
      return;
    }
    sendJson(res, 200, {
      webhook_url: currentWebhookUrl(req),
      integration: found,
      webhook_secret: `gh_mock_rotated_${Date.now()}`
    });
    return;
  }

  if (req.method === "GET" && pathname === "/v1/control-plane/alert-channels") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    sendJson(res, 200, {
      channels: ALERT_CHANNELS
    });
    return;
  }

  if (req.method === "POST" && pathname === "/v1/control-plane/alert-channels") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    const body = await parseJsonBody(req);
    const type = body.type;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!["slack", "webhook", "email"].includes(type) || !name) {
      sendJson(res, 400, { error: "invalid payload" });
      return;
    }
    alertChannelCounter += 1;
    const configPreview =
      type === "email"
        ? { email: body?.config?.email ?? "configured" }
        : type === "slack"
          ? { webhook_url: "https://hooks.slack.com/..." }
          : { url: "https://example.com/..." };
    const channel = {
      id: `channel-${alertChannelCounter}`,
      name,
      type,
      is_enabled: true,
      created_at: new Date().toISOString(),
      config_preview: configPreview
    };
    ALERT_CHANNELS.unshift(channel);
    sendJson(res, 201, { channel });
    return;
  }

  if (req.method === "PATCH" && pathname.match(/^\/v1\/control-plane\/alert-channels\/[^/]+$/)) {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    const id = pathname.split("/")[4];
    const body = await parseJsonBody(req);
    const channel = ALERT_CHANNELS.find((item) => item.id === id);
    if (!channel) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    if (typeof body.name === "string") {
      channel.name = body.name;
    }
    if (typeof body.is_enabled === "boolean") {
      channel.is_enabled = body.is_enabled;
    }
    sendJson(res, 200, { channel });
    return;
  }

  if (req.method === "DELETE" && pathname.match(/^\/v1\/control-plane\/alert-channels\/[^/]+$/)) {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    const id = pathname.split("/")[4];
    const channel = ALERT_CHANNELS.find((item) => item.id === id);
    if (!channel) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    channel.is_enabled = false;
    sendJson(res, 200, { ok: true, channel_id: id });
    return;
  }

  if (req.method === "GET" && pathname === "/v1/control-plane/alert-policies") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    sendJson(res, 200, {
      policies: ALERT_POLICIES
    });
    return;
  }

  if (req.method === "POST" && pathname === "/v1/control-plane/alert-policies") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    const body = await parseJsonBody(req);
    alertPolicyCounter += 1;
    const channels = Array.isArray(body.channel_ids)
      ? ALERT_CHANNELS.filter((channel) => body.channel_ids.includes(channel.id)).map((channel) => ({
          id: channel.id,
          name: channel.name,
          type: channel.type,
          is_enabled: channel.is_enabled
        }))
      : [];
    const policy = {
      id: `policy-${alertPolicyCounter}`,
      name: typeof body.name === "string" ? body.name : `Policy ${alertPolicyCounter}`,
      metric: typeof body.metric === "string" ? body.metric : "failure_rate",
      window_sec: Number(body.window_sec ?? 300),
      threshold: Number(body.threshold ?? 0.2),
      comparator: typeof body.comparator === "string" ? body.comparator : "gte",
      min_events: Number(body.min_events ?? 20),
      severity: typeof body.severity === "string" ? body.severity : "high",
      is_enabled: true,
      filter_workflow_id: typeof body.filter_workflow_id === "string" ? body.filter_workflow_id : null,
      filter_env: typeof body.filter_env === "string" ? body.filter_env : null,
      created_at: new Date().toISOString(),
      channels
    };
    ALERT_POLICIES.unshift(policy);
    sendJson(res, 201, { policy });
    return;
  }

  if (req.method === "PATCH" && pathname.match(/^\/v1\/control-plane\/alert-policies\/[^/]+$/)) {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    const id = pathname.split("/")[4];
    const body = await parseJsonBody(req);
    const policy = ALERT_POLICIES.find((item) => item.id === id);
    if (!policy) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    if (typeof body.is_enabled === "boolean") {
      policy.is_enabled = body.is_enabled;
    }
    sendJson(res, 200, { policy });
    return;
  }

  if (req.method === "DELETE" && pathname.match(/^\/v1\/control-plane\/alert-policies\/[^/]+$/)) {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    const id = pathname.split("/")[4];
    const index = ALERT_POLICIES.findIndex((item) => item.id === id);
    if (index < 0) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    ALERT_POLICIES.splice(index, 1);
    sendJson(res, 200, { ok: true, policy_id: id });
    return;
  }

  if (req.method === "POST" && pathname === "/v1/control-plane/workflow-sources") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    const body = await parseJsonBody(req);
    const sourceType = typeof body.source_type === "string" ? body.source_type : "webhook";
    const displayName = typeof body.display_name === "string" && body.display_name.trim() ? body.display_name.trim() : "Workflow Source";
    const environment = typeof body.environment === "string" && body.environment.trim() ? body.environment.trim() : "production";
    const id = `wf_generic_${workflowSourceCounter++}`;
    const sourceKey = `${sourceType}-${slugify(displayName)}`;
    const createdAt = new Date().toISOString();
    const apiKey = {
      id: `key-${++apiKeyCounter}`,
      name: `${displayName} workflow source`,
      key_preview: `synteq_****${String(apiKeyCounter).padStart(6, "0")}`,
      created_at: createdAt,
      last_used_at: null,
      revoked_at: null
    };
    const workflowSource = {
      id,
      display_name: displayName,
      source_type: sourceType,
      source_key: sourceKey,
      environment,
      created_at: createdAt,
      ingest_endpoint_path: "/v1/ingest/workflow-event",
      ingest_endpoint_url: currentWorkflowEventIngestUrl(req),
      api_key: apiKey
    };

    API_KEYS.push(apiKey);
    WORKFLOW_SOURCES.unshift(workflowSource);

    sendJson(res, 201, {
      workflow_source: workflowSource,
      source_id: id,
      source_key: sourceKey,
      ingestion_key: `synteq_mock_workflow_key_${id}`,
      ingest_endpoint_path: "/v1/ingest/workflow-event",
      ingest_endpoint_url: currentWorkflowEventIngestUrl(req)
    });
    return;
  }

  if (req.method === "POST" && pathname.match(/^\/v1\/control-plane\/sources\/[^/]+\/silent-check$/)) {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    const id = pathname.split("/")[4];
    const source = WORKFLOW_SOURCES.find((item) => item.id === id);

    if (failNextSilentCheckUnsupported) {
      failNextSilentCheckUnsupported = false;
      sendJson(res, 400, { error: "Silent checks are only supported for generic workflow sources" });
      return;
    }

    if (!source) {
      sendJson(res, id.startsWith("gh_") ? 400 : 404, {
        error: id.startsWith("gh_") ? "GitHub sources cannot use generic workflow silent checks" : "Workflow source not found"
      });
      return;
    }

    sendJson(res, 200, {
      sourceId: source.id,
      status: "ok",
      mode: "silent",
      writesPerformed: false,
      checkedAt: new Date().toISOString(),
      checks: [
        {
          key: "source_access",
          status: "ok",
          message: "Source belongs to this workspace and is readable."
        },
        {
          key: "source_activation",
          status: "ok",
          message: "Source is active for manual validation."
        },
        {
          key: "source_compatibility",
          status: "ok",
          message: "Source uses the generic workflow event contract."
        }
      ]
    });
    return;
  }

  if (req.method === "POST" && pathname.match(/^\/v1\/control-plane\/sources\/[^/]+\/test-workflow-event$/)) {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    const id = pathname.split("/")[4];
    const source = WORKFLOW_SOURCES.find((item) => item.id === id);
    if (!source) {
      sendJson(res, 404, { error: "Workflow source not found" });
      return;
    }

    const body = await parseJsonBody(req);
    const status = typeof body.status === "string" ? body.status : "succeeded";
    sendJson(res, 200, {
      ok: true,
      message: `Synthetic ${status} workflow event sent for ${source.display_name}.`,
      ingest: {
        accepted: 1,
        ingested: 1,
        duplicates: 0,
        skipped: 0,
        failed: 0,
        persisted: 1,
        normalized_status: status,
        source_type: source.source_type,
        analysis_handoff: {}
      },
      event: {
        source_id: source.id,
        source_key: source.source_key,
        workflow_id: `synteq-test-${source.source_type}`,
        workflow_name: `Synteq Test ${source.display_name}`,
        execution_id: `exec-${Date.now()}`,
        status,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: 1000,
        environment: source.environment,
        metadata: {
          synthetic: true,
          test: true,
          platform: source.source_type
        }
      }
    });
    return;
  }

  if (req.method === "GET" && pathname === "/v1/control-plane/sources") {
    const persona = ensureAuth(req, res);
    if (!persona) {
      return;
    }
    if (failNextControlPlaneSources || failControlPlaneSources) {
      failNextControlPlaneSources = false;
      sendJson(res, 500, { error: "mock control plane sources failure" });
      return;
    }

    const activatedWorkflows =
      persona === "activated"
        ? [
            {
              id: "wf_1",
              type: "workflow",
              name: "Payments Daily",
              status: "active",
              powers: "Execution and heartbeat telemetry",
              details: nullControlPlaneSourceDetails ? null : { slug: "payments-daily", system: "checkout-service", environment: "prod" },
              last_activity_at: new Date().toISOString(),
              connected_at: new Date().toISOString()
            }
          ]
        : [];

    const workflows = [
      ...activatedWorkflows,
      ...WORKFLOW_SOURCES.map((source) => ({
        id: source.id,
        type: "workflow",
        name: source.display_name,
        status: "active",
        powers: "Generic workflow execution events",
        details: {
          slug: source.source_key,
          source_type: source.source_type,
          environment: source.environment
        },
        last_activity_at: null,
        connected_at: source.created_at
      }))
    ];

    const githubSources = GITHUB_INTEGRATIONS.map((integration) => ({
      id: integration.id,
      type: "github_integration",
      name: integration.repository_full_name ?? `hook:${integration.webhook_id}`,
      status: integration.is_active ? "active" : "inactive",
      powers: "GitHub Actions operational events",
      details: {
        webhook_id: integration.webhook_id,
        repository_full_name: integration.repository_full_name
      },
      last_activity_at: integration.last_seen_at,
      connected_at: integration.created_at
    }));

    sendJson(res, 200, {
      summary: {
        workflow_sources: workflows.length,
        github_sources: githubSources.filter((item) => item.status === "active").length,
        ingestion_keys_active: API_KEYS.filter((item) => !item.revoked_at).length,
        alert_channels_ready: ALERT_CHANNELS.filter((item) => item.is_enabled).length
      },
      sources: [...workflows, ...githubSources],
      readiness: {
        ingestion_api_keys_configured: API_KEYS.some((item) => !item.revoked_at),
        alert_dispatch_ready: ALERT_CHANNELS.some((item) => item.is_enabled)
      }
    });
    return;
  }

  if (req.method === "POST" && pathname === "/v1/auth/logout") {
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: "Not found", path: pathname });
});

server.listen(PORT, "127.0.0.1", () => {
  // Keep output minimal; Playwright only needs the process alive.
  console.log(`Mock API listening on http://127.0.0.1:${PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
