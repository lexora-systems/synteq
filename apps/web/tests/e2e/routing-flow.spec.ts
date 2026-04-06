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

test("public landing page renders", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /risk/i,
      level: 1
    })
  ).toBeVisible();
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

test("non-activated user can access /overview", async ({ page }) => {
  await setSession(page, "nonactivated");
  await page.goto("/overview");
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole("heading", { name: /always-on risk detection and prevention/i, level: 2 })).toBeVisible();
});

test("activated user can access /overview", async ({ page }) => {
  await setSession(page, "activated");
  await page.goto("/overview");
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole("heading", { name: /risk/i, level: 2 })).toBeVisible();
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
