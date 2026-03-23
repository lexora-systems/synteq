const DEFAULT_TIMEOUT_MS = Number(process.env.STAGING_SMOKE_TIMEOUT_MS ?? 15_000);

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

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function logPass(message) {
  console.log(`[PASS] ${message}`);
}

async function checkLanding(webBaseUrl) {
  const response = await fetchWithTimeout(`${webBaseUrl}/`, {
    method: "GET",
    redirect: "follow"
  });
  assertCondition(response.ok, `Landing page failed (${response.status})`);
  logPass("Landing page responds successfully");
}

async function checkApiHealth(apiBaseUrl) {
  const response = await fetchWithTimeout(`${apiBaseUrl}/health`);
  const body = await readResponseBody(response);
  assertCondition(response.ok, `API /health failed (${response.status})`);
  assertCondition(typeof body === "object" && body?.ok === true, "API /health payload missing ok=true");
  logPass("API /health responds successfully");
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
  logPass("Auth login smoke passed");
  return token;
}

async function checkProtectedApiRoute(apiBaseUrl, token, email) {
  const response = await fetchWithTimeout(`${apiBaseUrl}/v1/auth/me`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  const body = await readResponseBody(response);
  assertCondition(response.ok, `Protected route /v1/auth/me failed (${response.status}): ${JSON.stringify(body)}`);
  assertCondition(typeof body?.user?.email === "string", "Protected route payload missing user.email");
  assertCondition(
    body.user.email.toLowerCase() === email.toLowerCase(),
    `Protected route returned unexpected user (${body.user.email})`
  );
  logPass("Protected route smoke passed (/v1/auth/me)");
}

async function main() {
  const webBaseUrl = normalizeBaseUrl(requiredEnv("STAGING_WEB_BASE_URL"));
  const apiBaseUrl = normalizeBaseUrl(requiredEnv("STAGING_API_BASE_URL"));
  const smokeEmail = requiredEnv("STAGING_SMOKE_EMAIL");
  const smokePassword = requiredEnv("STAGING_SMOKE_PASSWORD");
  const smokeTenantId = optionalEnv("STAGING_SMOKE_TENANT_ID");

  console.log("Synteq staging smoke check");
  console.log(`Web: ${webBaseUrl}`);
  console.log(`API: ${apiBaseUrl}`);

  await checkLanding(webBaseUrl);
  await checkApiHealth(apiBaseUrl);
  const token = await loginAndGetToken(apiBaseUrl, smokeEmail, smokePassword, smokeTenantId);
  await checkProtectedApiRoute(apiBaseUrl, token, smokeEmail);
}

main()
  .then(() => {
    console.log("Staging smoke checks passed.");
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Staging smoke checks failed: ${message}`);
    process.exitCode = 1;
  });
