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

test("control plane lifecycle surfaces are usable", async ({ page }) => {
  await setSession(page);

  await page.goto("/settings/control-plane");
  await expect(page.getByRole("heading", { name: "Continuous signal and alert setup" })).toBeVisible();

  await page.goto("/settings/control-plane/api-keys");
  await page.getByTestId("api-key-name-input").fill("Playwright Key");
  await page.getByTestId("api-key-create-submit").click();
  await expect(page.getByTestId("api-key-secret-value")).toBeVisible();

  await page.goto("/settings/control-plane/github");
  await page.getByTestId("github-repository-input").fill("acme/demo-repo");
  await page.getByTestId("github-create-submit").click();
  await expect(page.getByTestId("github-secret-value")).toBeVisible();

  await page.goto("/settings/control-plane/alerts");
  await page.getByTestId("alerts-channel-name-input").fill("Ops Email");
  await page.getByTestId("alerts-channel-type-select").selectOption("email");
  await page.getByTestId("alerts-channel-target-input").fill("ops@synteq.local");
  await page.getByTestId("alerts-channel-create-submit").click();
  await expect(page.getByTestId("alerts-feedback")).toBeVisible();
});
