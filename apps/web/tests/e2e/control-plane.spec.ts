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
  data: Record<string, boolean>
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
  await page.getByTestId("alerts-channel-name-input").fill("Ops Email");
  await page.getByTestId("alerts-channel-type-select").selectOption("email");
  await page.getByTestId("alerts-channel-target-input").fill("ops@synteq.local");
  await page.getByTestId("alerts-channel-create-submit").click();
  await expect(page.getByTestId("alerts-feedback")).toBeVisible();
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
