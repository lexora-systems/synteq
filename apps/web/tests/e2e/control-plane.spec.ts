import { expect, test, type Page } from "@playwright/test";

function encodeBase64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function issueAccessToken() {
  const header = encodeBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = encodeBase64Url(
    JSON.stringify({
      sub: "user-activated",
      persona: "activated",
      role: "owner",
      exp: Math.floor(Date.now() / 1000) + 60 * 60
    })
  );
  return `${header}.${payload}.signature`;
}

async function setSession(page: Page) {
  await page.context().addCookies([
    {
      name: "synteq_token",
      value: issueAccessToken(),
      url: "http://localhost:3100"
    },
    {
      name: "synteq_refresh_token",
      value: "refresh-activated",
      url: "http://localhost:3100"
    }
  ]);
}

async function resetMockApi(request: { post: (url: string, options?: { data?: unknown }) => Promise<unknown> }) {
  await request.post("http://localhost:4010/__test/reset");
}

async function setMockApiBehavior(
  request: { post: (url: string, options?: { data?: unknown }) => Promise<unknown> },
  data: Record<string, unknown>
) {
  await request.post("http://localhost:4010/__test/config", { data });
}

async function createGitHubIntegration(page: Page, repository = "acme/demo-repo") {
  await page.goto("/settings/control-plane/github");
  await page.getByTestId("github-repository-input").fill(repository);
  await page.getByTestId("github-create-submit").click();
  await expect(page.getByTestId("github-secret-panel")).toBeVisible();
  await expect(page.getByTestId("github-secret-webhook-url")).toContainText("/v1/integrations/github/webhook");
  await expect(page.getByText("Copy this secret now. For security reasons it may not be shown again.")).toBeVisible();
}

async function expectGitHubSecretClearedAfterReloads(page: Page) {
  await page.reload();
  if ((await page.getByTestId("github-secret-value").count()) > 0) {
    await page.reload();
  }
  await expect(page.getByTestId("github-secret-value")).toHaveCount(0);
  await expect(page.getByTestId("github-secret-placeholder")).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await resetMockApi(request);
});

test("control plane redirects unauthenticated users to login", async ({ page }) => {
  await page.goto("/settings/control-plane");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in to Synteq risk detection" })).toBeVisible();
});

test("control plane lifecycle surfaces are usable", async ({ page }) => {
  await setSession(page);

  await page.goto("/settings/control-plane");
  await expect(page.getByRole("heading", { name: "Continuous signal and alert setup" })).toBeVisible();

  await page.goto("/settings/control-plane/api-keys");
  await page.getByTestId("api-key-name-input").fill("Playwright Key");
  await page.getByTestId("api-key-create-submit").click();
  await expect(page.getByTestId("api-key-secret-value")).toBeVisible();

  await page.goto("/settings/control-plane/github");
  await expect(page.getByTestId("github-secret-placeholder")).toBeVisible();
  await page.getByTestId("github-repository-input").fill("acme/demo-repo");
  await page.getByTestId("github-create-submit").click();
  await expect(page.getByTestId("github-secret-panel")).toBeVisible();
  await expect(page.getByTestId("github-operational-state")).toContainText("Waiting for webhook delivery");
  await expectGitHubSecretClearedAfterReloads(page);

  await page.goto("/settings/control-plane/alerts");
  await expect(page.getByTestId("alerts-readiness-state")).toContainText("Alert delivery not yet active");
  await expect(page.getByTestId("alerts-readiness-state")).toContainText("Alert delivery depends on configured scheduler/email infrastructure");
  await page.getByTestId("alerts-channel-name-input").fill("Ops Email");
  await page.getByTestId("alerts-channel-type-select").selectOption("email");
  await page.getByTestId("alerts-channel-target-input").fill("ops@synteq.local");
  await page.getByTestId("alerts-channel-create-submit").click();
  await expect(page.getByTestId("alerts-feedback")).toContainText("Delivery depends on configured scheduler and email/webhook infrastructure");
});

test("generic workflow source onboarding separates silent checks from mutative test events", async ({ page, request }) => {
  await setSession(page);

  await page.goto("/sources");
  await expect(page.getByTestId("sources-source-choice-section")).toContainText("Choose how Synteq receives workflow signals");
  await expect(page.getByTestId("sources-github-path")).toContainText("GitHub Actions webhook");
  await expect(page.getByTestId("sources-github-path")).toContainText("Use GitHub webhook events to send workflow/job status and timing signals.");
  await expect(page.getByTestId("sources-generic-path")).toContainText("Generic workflow webhook");
  await expect(page.getByTestId("sources-generic-path")).toContainText(
    "Create an API-key protected source for workflow execution events from tools that can send HTTP requests."
  );
  await expect(page.getByText(/GitHub is required/i)).toHaveCount(0);
  await expect(page.getByTestId("sources-first-event-guidance")).toContainText("Copy endpoint/key or webhook secret");
  await expect(page.getByTestId("sources-first-event-guidance")).toContainText("first signal milestone completes");
  await expect(page.getByTestId("generic-source-silent-check-submit")).toHaveCount(0);
  await expect(page.getByTestId("generic-workflow-source-create-form")).toContainText(
    "This creates the API-key protected endpoint and source identity needed for workflow execution event ingestion."
  );
  await expect(page.getByTestId("generic-workflow-source-create-form")).toContainText("not native account integrations");
  await expect(page.getByTestId("gohighlevel-webhook-guidance")).toContainText("send outbound webhooks through the generic Webhook source");
  await expect(page.getByTestId("gohighlevel-webhook-guidance")).toContainText("not a native CRM integration");
  await expect(page.getByTestId("gohighlevel-webhook-guidance")).toContainText("X-Synteq-Key: <your_ingestion_key>");
  await expect(page.getByTestId("gohighlevel-webhook-guidance")).toContainText("Content-Type: application/json");
  await expect(page.getByTestId("synthetic-readiness-note")).toContainText(
    "Run silent check validates source readiness without writing operational records"
  );

  await page.getByTestId("generic-source-name-input").fill("Customer Onboarding");
  await page.getByTestId("generic-source-type-select").selectOption("n8n");
  await page.getByTestId("generic-source-environment-input").fill("production");
  await page.getByTestId("generic-source-create-submit").click();

  await expect(page.getByTestId("generic-source-setup-card")).toBeVisible();
  await expect(page.getByTestId("generic-source-setup-card")).toContainText("Configure your workflow tool to POST execution events");
  await expect(page.getByTestId("generic-source-setup-card")).toContainText("Successful delivery appears in source activity");
  await expect(page.getByTestId("generic-source-silent-check-submit")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send test failure event" })).toBeVisible();
  await expect(page.getByText("Run silent check is dry-run validation only.")).toBeVisible();
  await expect(page.getByText("Send test event uses the live ingestion lifecycle")).toBeVisible();

  await page.getByTestId("generic-source-silent-check-submit").click();
  const result = page.getByTestId("generic-source-silent-check-result");
  await expect(result).toContainText("Silent check ok");
  await expect(result).toContainText("No operational writes were performed");
  await expect(result).not.toContainText("synteq_mock_workflow_key");
  await expect(result).not.toContainText("raw_payload");

  await setMockApiBehavior(request, { fail_next_silent_check_unsupported: true });
  await page.getByTestId("generic-source-silent-check-submit").click();
  await expect(page.getByTestId("generic-workflow-source-feedback")).toContainText(
    "Silent checks are only available for generic workflow sources."
  );
});

test("GoHighLevel webhook onboarding shows a safe operational sample", async ({ page }) => {
  await setSession(page);

  await page.goto("/sources");
  await expect(page.getByTestId("generic-workflow-source-create-form")).toBeVisible();
  await expect(page.getByTestId("gohighlevel-webhook-guidance")).toContainText("The Synteq source type remains webhook");
  await expect(page.getByTestId("gohighlevel-webhook-guidance")).toContainText("not a native CRM integration");
  await expect(page.getByTestId("gohighlevel-webhook-guidance")).toContainText(
    "Send workflow execution signals, not customer records"
  );
  await expect(page.getByTestId("gohighlevel-webhook-guidance")).toContainText("Designed to monitor systems - not access them");

  await page.getByTestId("generic-source-name-input").fill("GHL Follow Up");
  await page.getByTestId("generic-source-type-select").selectOption("webhook");
  await page.getByTestId("generic-source-environment-input").fill("production");
  await page.getByTestId("generic-source-create-submit").click();

  await expect(page.getByTestId("generic-source-setup-card")).toBeVisible();
  await expect(page.getByTestId("gohighlevel-sample-section")).toBeVisible();
  const sampleText = (await page.getByTestId("gohighlevel-sample-payload").textContent()) ?? "";
  const sample = JSON.parse(sampleText) as Record<string, unknown>;

  expect(sample.provider).toBe("gohighlevel");
  expect(sample.source_key).toBe("webhook-ghl-follow-up");
  expect(sample.workflowId).toBe("ghl_workflow_123");
  expect(sample.deliveryId).toBe("ghl_delivery_123");
  expect(sample.locationId).toBe("ghl_location_123");
  expect(sample.actionId).toBe("ghl_action_123");
  expect(sample.objectId).toBe("opp_123");
  expect(sample.pipelineId).toBe("pipeline_123");
  expect(sample.opportunityId).toBe("opp_123");

  const keys = new Set(Object.keys(sample).map((key) => key.toLowerCase()));
  for (const field of ["name", "email", "phone", "address", "notes", "message", "raw_payload", "rawpayload"]) {
    expect(keys.has(field)).toBe(false);
  }
});

test("control plane index stays usable when setup status fails to load", async ({ page, request }) => {
  await setSession(page);
  await setMockApiBehavior(request, { fail_next_control_plane_sources_get: true });

  await page.goto("/settings/control-plane");

  await expect(page.getByRole("heading", { name: "Continuous signal and alert setup" })).toBeVisible();
  await expect(page.getByTestId("control-plane-status-warning")).toContainText("Setup status is temporarily unavailable");
  await expect(page.getByText("Active workflow sources:")).toContainText("Unavailable");
  await expect(page.getByRole("link", { name: "API keys" })).toBeVisible();
  await expect(page.getByRole("link", { name: "GitHub integrations" })).toBeVisible();
});

test("sources page stays usable when source status fails to load", async ({ page, request }) => {
  await setSession(page);
  await setMockApiBehavior(request, { fail_control_plane_sources_get: true });

  await page.goto("/sources");

  await expect(page.getByRole("heading", { name: "Operational signal connectivity" })).toBeVisible();
  await expect(page.getByTestId("sources-load-warning")).toContainText("Source inventory is temporarily unavailable");
  await expect(page.getByTestId("sources-operational-state")).toContainText("Source status temporarily unavailable");
  await expect(page.getByText("Workflow sources")).toBeVisible();
  await expect(page.getByText("Unavailable").first()).toBeVisible();
  await expect(page.getByTestId("connected-sources-table")).toContainText("Source inventory is temporarily unavailable");
  await expect(page.getByTestId("generic-workflow-source-create-form")).toBeVisible();
});

test("sources page renders workflow rows when details are null", async ({ page, request }) => {
  await setSession(page);
  await setMockApiBehavior(request, { null_control_plane_source_details: true });

  await page.goto("/sources");

  await expect(page.getByRole("heading", { name: "Operational signal connectivity" })).toBeVisible();
  await expect(page.getByTestId("sources-load-warning")).toHaveCount(0);
  const row = page.locator("tr", { hasText: "Payments Daily" }).first();
  await expect(row).toContainText("Workflow");
  await expect(row).toContainText("Signal-level event ingestion");
});

test("sources page renders workflow rows when source_type is missing", async ({ page }) => {
  await setSession(page);

  await page.goto("/sources");

  await expect(page.getByRole("heading", { name: "Operational signal connectivity" })).toBeVisible();
  const row = page.locator("tr", { hasText: "Payments Daily" }).first();
  await expect(row).toContainText("Workflow");
  await expect(row).toContainText("Execution status, retries, latency, heartbeat");
});

test("sources page stays usable when current user lookup fails", async ({ page, request }) => {
  await setSession(page);
  await setMockApiBehavior(request, { fail_auth_me_get: true });

  await page.goto("/sources");

  await expect(page.getByRole("heading", { name: "Operational signal connectivity" })).toBeVisible();
  await expect(page.getByTestId("sources-load-warning")).toContainText("User role details are temporarily unavailable");
  await expect(page.getByTestId("generic-workflow-source-create-form")).toBeVisible();
});

test("rotate succeeds and refresh succeeds keeps secret visible", async ({ page }) => {
  await setSession(page);
  await createGitHubIntegration(page, "acme/rotate-success");

  await page.getByRole("button", { name: "Rotate secret" }).first().click();

  await expect(page.getByTestId("github-feedback")).toContainText("Webhook secret rotated.");
  await expect(page.getByTestId("github-secret-panel")).toBeVisible();
  await expect(page.getByTestId("github-secret-webhook-url")).toContainText("/v1/integrations/github/webhook");
  await expect(page.getByTestId("github-secret-value")).toContainText("gh_mock_rotated_");
  await expectGitHubSecretClearedAfterReloads(page);
});

test("rotate succeeds but refresh fails still shows rotated secret", async ({ page, request }) => {
  await setSession(page);
  await createGitHubIntegration(page, "acme/rotate-refresh-fail");

  await setMockApiBehavior(request, { fail_next_github_integrations_get: true });
  await page.getByRole("button", { name: "Rotate secret" }).first().click();

  await expect(page.getByTestId("github-feedback")).toContainText("Secret rotated successfully. Copy it now.");
  await expect(page.getByTestId("github-secret-panel")).toBeVisible();
  await expect(page.getByTestId("github-secret-webhook-url")).toContainText("/v1/integrations/github/webhook");
  await expect(page.getByTestId("github-secret-value")).toContainText("gh_mock_rotated_");
});

test("rotate failure does not show secret", async ({ page, request }) => {
  await setSession(page);
  await createGitHubIntegration(page, "acme/rotate-failure");

  await page.reload();
  await setMockApiBehavior(request, { fail_next_github_rotate_post: true });
  await page.getByRole("button", { name: "Rotate secret" }).first().click();

  await expect(page.getByTestId("github-feedback")).toContainText(
    "Rotate secret failed because API returned a server error. No new one-time secret was displayed."
  );
  await expect(page.getByTestId("github-secret-value")).toHaveCount(0);
  await expect(page.getByTestId("github-secret-rotate-error")).toBeVisible();
  await expect(page.getByTestId("github-feedback")).not.toContainText("gh_mock_rotated_");
});

test("rotate success response missing webhook_secret fails loudly instead of empty success", async ({ page, request }) => {
  await setSession(page);
  await createGitHubIntegration(page, "acme/rotate-missing-secret");

  await page.reload();
  await setMockApiBehavior(request, { omit_next_github_rotate_secret: true });
  await page.getByRole("button", { name: "Rotate secret" }).first().click();

  await expect(page.getByTestId("github-feedback")).toContainText(
    "Rotate secret failed because API response did not include a usable one-time webhook secret."
  );
  await expect(page.getByTestId("github-secret-value")).toHaveCount(0);
  await expect(page.getByTestId("github-copy-secret")).toHaveCount(0);
  await expect(page.getByTestId("github-secret-rotate-error")).toBeVisible();
  await expect(page.getByTestId("github-feedback")).not.toContainText("gh_mock_rotated_");
});

test("deactivate succeeds but refresh fails still marks integration inactive", async ({ page, request }) => {
  await setSession(page);
  await createGitHubIntegration(page, "acme/deactivate-refresh-fail");

  await setMockApiBehavior(request, { fail_next_github_integrations_get: true });
  await page.getByRole("button", { name: "Deactivate" }).first().click();

  await expect(page.getByTestId("github-feedback")).toContainText(
    "GitHub integration deactivated successfully. Integration list refresh failed"
  );
  const row = page.locator("tr", { hasText: "acme/deactivate-refresh-fail" }).first();
  await expect(row).toContainText("inactive");
  await expect(row.getByRole("button", { name: "Deactivate" })).toBeDisabled();
});

test("deactivate response failure after mutation still reconciles to inactive", async ({ page, request }) => {
  await setSession(page);
  await createGitHubIntegration(page, "acme/deactivate-recover");

  await setMockApiBehavior(request, { fail_next_github_deactivate_after_mutation: true });
  await page.getByRole("button", { name: "Deactivate" }).first().click();

  await expect(page.getByTestId("github-feedback")).toContainText(
    "GitHub integration deactivated. Synteq will stop watching events from this webhook."
  );
  const row = page.locator("tr", { hasText: "acme/deactivate-recover" }).first();
  await expect(row).toContainText("inactive");
  await expect(row.getByRole("button", { name: "Deactivate" })).toBeDisabled();
});
