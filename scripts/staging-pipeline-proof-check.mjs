const DEFAULT_TIMEOUT_MS = Number(process.env.STAGING_PIPELINE_PROOF_TIMEOUT_MS ?? 15_000);
const DEFAULT_SETTLE_MS = Number(process.env.STAGING_PIPELINE_PROOF_SETTLE_MS ?? 4_000);
const DEFAULT_SCENARIO = process.env.STAGING_SIMULATION_SCENARIO?.trim() || "webhook-failure";
const ALLOWED_SCENARIOS = new Set(["webhook-failure", "retry-storm", "latency-spike", "duplicate-webhook"]);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optionalEnv(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

function normalizeBaseUrl(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseBody(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function logPass(message) {
  console.log(`[PASS] ${message}`);
}

async function loginAndGetToken(apiBaseUrl, email, password, tenantId) {
  const payload = {
    email,
    password,
    ...(tenantId ? { tenant_id: tenantId } : {})
  };
  const response = await fetchWithTimeout(`${apiBaseUrl}/v1/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const body = await readResponseBody(response);
  assertCondition(response.ok, `Auth login failed (${response.status}): ${JSON.stringify(body)}`);
  const token = body?.access_token ?? body?.token;
  assertCondition(typeof token === "string" && token.length > 0, "Auth login response missing access token");
  logPass("Auth login passed for pipeline proof");
  return token;
}

async function listWorkflows(apiBaseUrl, token) {
  const response = await fetchWithTimeout(`${apiBaseUrl}/v1/workflows`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  const body = await readResponseBody(response);
  assertCondition(response.ok, `List workflows failed (${response.status}): ${JSON.stringify(body)}`);
  assertCondition(Array.isArray(body?.workflows), "List workflows response missing workflows array");
  return body.workflows;
}

function resolveWorkflowId(workflows, preferredWorkflowId) {
  if (preferredWorkflowId) {
    const found = workflows.find((workflow) => workflow.id === preferredWorkflowId);
    assertCondition(Boolean(found), `Configured STAGING_SMOKE_WORKFLOW_ID not found (${preferredWorkflowId})`);
    return preferredWorkflowId;
  }

  const first = workflows[0];
  assertCondition(Boolean(first?.id), "No active workflow available for pipeline proof");
  return first.id;
}

async function runSimulation(apiBaseUrl, token, scenario, workflowId) {
  const response = await fetchWithTimeout(`${apiBaseUrl}/v1/simulate/${scenario}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      workflow_id: workflowId
    })
  });
  const body = await readResponseBody(response);
  assertCondition(response.ok, `Simulation trigger failed (${response.status}): ${JSON.stringify(body)}`);
  assertCondition(body?.ok === true, "Simulation response missing ok=true");
  assertCondition(body?.result?.workflow_id === workflowId, "Simulation response returned unexpected workflow id");
  logPass(`Simulation scenario queued (${scenario})`);
}

async function triggerSchedulerTask(apiBaseUrl, schedulerSecret, task, triggerId) {
  const response = await fetchWithTimeout(`${apiBaseUrl}/v1/internal/scheduler/${task}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-synteq-scheduler-secret": schedulerSecret,
      "x-cloudscheduler": "true",
      Authorization: `Bearer ${schedulerSecret}`
    },
    body: JSON.stringify({
      trigger_id: triggerId
    })
  });
  const body = await readResponseBody(response);
  assertCondition(response.ok, `Scheduler task ${task} failed (${response.status}): ${JSON.stringify(body)}`);
  assertCondition(body?.ok === true, `Scheduler task ${task} response missing ok=true`);
  assertCondition(body?.task === task, `Scheduler task ${task} response mismatch`);
  logPass(`Scheduler task completed (${task})`);
}

async function checkIncidentsRoute(apiBaseUrl, token, workflowId) {
  const query = new URLSearchParams({
    page: "1",
    page_size: "5",
    workflow_id: workflowId
  });
  const response = await fetchWithTimeout(`${apiBaseUrl}/v1/incidents?${query.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  const body = await readResponseBody(response);
  assertCondition(response.ok, `Incidents route check failed (${response.status}): ${JSON.stringify(body)}`);
  assertCondition(Array.isArray(body?.incidents), "Incidents response missing incidents array");
  logPass("Incidents route responds after scheduler pipeline run");
}

async function main() {
  const apiBaseUrl = normalizeBaseUrl(requiredEnv("STAGING_API_BASE_URL"));
  const smokeEmail = requiredEnv("STAGING_SMOKE_EMAIL");
  const smokePassword = requiredEnv("STAGING_SMOKE_PASSWORD");
  const schedulerSecret = requiredEnv("STAGING_SCHEDULER_SHARED_SECRET");
  const smokeTenantId = optionalEnv("STAGING_SMOKE_TENANT_ID");
  const preferredWorkflowId = optionalEnv("STAGING_SMOKE_WORKFLOW_ID");
  const settleMs = Math.max(0, Number(process.env.STAGING_PIPELINE_PROOF_SETTLE_MS ?? DEFAULT_SETTLE_MS));
  const scenario = DEFAULT_SCENARIO;

  assertCondition(ALLOWED_SCENARIOS.has(scenario), `Unsupported STAGING_SIMULATION_SCENARIO: ${scenario}`);

  console.log("Synteq staging pipeline proof check");
  console.log(`API: ${apiBaseUrl}`);
  console.log(`Scenario: ${scenario}`);

  const token = await loginAndGetToken(apiBaseUrl, smokeEmail, smokePassword, smokeTenantId);
  const workflows = await listWorkflows(apiBaseUrl, token);
  const workflowId = resolveWorkflowId(workflows, preferredWorkflowId);
  console.log(`Using workflow: ${workflowId}`);

  await runSimulation(apiBaseUrl, token, scenario, workflowId);

  if (settleMs > 0) {
    await sleep(settleMs);
  }

  const triggerSuffix = Date.now();
  await triggerSchedulerTask(apiBaseUrl, schedulerSecret, "aggregate", `staging-proof-aggregate-${triggerSuffix}`);
  await triggerSchedulerTask(apiBaseUrl, schedulerSecret, "anomaly", `staging-proof-anomaly-${triggerSuffix}`);
  await triggerSchedulerTask(apiBaseUrl, schedulerSecret, "alerts", `staging-proof-alerts-${triggerSuffix}`);

  await checkIncidentsRoute(apiBaseUrl, token, workflowId);
}

main()
  .then(() => {
    console.log("Staging pipeline proof checks passed.");
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Staging pipeline proof checks failed: ${message}`);
    process.exitCode = 1;
  });
