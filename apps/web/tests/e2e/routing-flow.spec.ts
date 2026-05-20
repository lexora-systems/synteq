import { expect, test, type Page } from "@playwright/test";

function encodeBase64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function issueAccessToken(persona: "activated" | "nonactivated") {
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

async function setSession(page: Page, persona: "activated" | "nonactivated") {
  await page.context().addCookies([
    {
      name: "synteq_token",
      value: issueAccessToken(persona),
      url: "http://localhost:3100"
    },
    {
      name: "synteq_refresh_token",
      value: `refresh-${persona}`,
      url: "http://localhost:3100"
    }
  ]);
}

async function login(page: Page, email: string, password = "Password123!") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
}

async function resetMockApi(request: { post: (url: string, options?: { data?: unknown }) => Promise<unknown> }) {
  await request.post("http://localhost:4010/__test/reset");
}

test.beforeEach(async ({ request }) => {
  await resetMockApi(request);
});

test("public landing page renders", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /monitor reliability across your workflow and automation signals/i,
      level: 1
    })
  ).toBeVisible();
});

test("public trust and legal pages render", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByTestId("privacy-page-title")).toHaveText("Privacy Policy");
  await expect(page.getByText("Designed to monitor systems - not access them")).toBeVisible();

  await page.goto("/terms");
  await expect(page.getByTestId("terms-page-title")).toHaveText("Terms of Service");
  await expect(page.getByText("Alert delivery depends on configured scheduler and email/webhook infrastructure.")).toBeVisible();

  await page.goto("/trust");
  await expect(page.getByTestId("trust-page-title")).toHaveText("Security and Trust");
  await expect(page.getByText("Do not send raw CRM/contact records")).toBeVisible();
});

test("/login renders and invalid login is handled", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to Synteq risk detection" })).toBeVisible();

  await page.getByLabel("Email").fill("activated@synteq.local");
  await page.getByLabel("Password").fill("WrongPassword123!");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page.getByText("Invalid credentials")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("successful login routes to /welcome", async ({ page }) => {
  await login(page, "nonactivated@synteq.local");
  await expect(page).toHaveURL(/\/welcome$/);
});

test("welcome shows activation next step for first-time user", async ({ page }) => {
  await setSession(page, "nonactivated");
  await page.goto("/welcome");
  await expect(page.getByTestId("welcome-activation-panel")).toBeVisible();
  await expect(page.getByTestId("welcome-primary-next-action")).toHaveText(/Connect GitHub|Complete webhook setup/);
});

test("non-activated user can access /overview", async ({ page }) => {
  await setSession(page, "nonactivated");
  await page.goto("/overview");
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole("heading", { name: /what is happening right now/i, level: 2 })).toBeVisible();
  await expect(page.getByTestId("overview-activation-banner")).toBeVisible();
});

test("activated user can access /overview", async ({ page }) => {
  await setSession(page, "activated");
  await page.goto("/overview");
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole("heading", { name: /what is happening right now/i, level: 2 })).toBeVisible();
});

test("phase 1 operational flow reaches incidents and timeline", async ({ page }) => {
  await setSession(page, "activated");
  await page.goto("/overview");

  await expect(page.getByRole("heading", { name: /what is happening right now/i, level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: /recent reliability/i })).toBeVisible();
  await expect(page.getByText(/scheduled synthetic checks are not enabled yet/i)).toBeVisible();

  await page.getByRole("link", { name: "Incidents", exact: true }).click();
  await expect(page).toHaveURL(/\/incidents$/);
  await expect(page.getByTestId("attention-groups-section")).toBeVisible();
  await expect(page.getByRole("heading", { name: /active operational context/i })).toBeVisible();

  await page.getByRole("link", { name: "Details" }).first().click();
  await expect(page).toHaveURL(/\/incidents\/inc-e2e-1$/);
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /sanitized lifecycle events/i })).toBeVisible();
  await expect(page.getByText("super-secret-should-not-render")).toHaveCount(0);
  await expect(page.getByText("webhook_secret")).toHaveCount(0);
});

test("activated user visiting /welcome is redirected to /overview", async ({ page }) => {
  await setSession(page, "activated");
  await page.goto("/welcome");
  await expect(page).toHaveURL(/\/overview$/);
});

test("invite accept flow routes to onboarding", async ({ page }) => {
  await page.goto("/invite/test-token");
  await page.getByLabel("Full name").fill("Invite User");
  await page.getByLabel("Password").fill("Password123!");
  await page.getByRole("button", { name: "Accept invite" }).click();

  await expect(page).toHaveURL(/\/welcome$/);
});
