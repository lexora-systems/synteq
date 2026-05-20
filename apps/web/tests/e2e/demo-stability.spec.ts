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

test.beforeEach(async ({ request }) => {
  await resetMockApi(request);
});

test.afterEach(async ({ request }) => {
  await resetMockApi(request);
});

test("overview stays usable when live dashboard dependencies fail", async ({ page, request }) => {
  await setMockApiBehavior(request, {
    fail_operational_dashboard_get: true,
    fail_reliability_windows_get: true,
    fail_workflows_get: true
  });
  await setSession(page);

  await page.goto("/overview");

  await expect(page.getByRole("heading", { name: /what is happening right now/i, level: 2 })).toBeVisible();
  await expect(page.getByTestId("overview-load-warning")).toContainText("operational dashboard");
  await expect(page.getByTestId("overview-load-warning")).toContainText("workflows");
  await expect(page.getByText("Operational dashboard data is temporarily unavailable.")).toBeVisible();
  await expect(page.getByText("Something failed while loading this page")).toHaveCount(0);
});

test("incident queue renders fallback state when the incident API fails", async ({ page, request }) => {
  await setMockApiBehavior(request, {
    fail_incidents_get: true
  });
  await setSession(page);

  await page.goto("/incidents");

  await expect(page.getByRole("heading", { name: /incident queue/i })).toBeVisible();
  await expect(page.getByTestId("incidents-load-warning")).toBeVisible();
  await expect(page.getByText("No incidents match the current view.")).toBeVisible();
  await expect(page.getByText("Something failed while loading this page")).toHaveCount(0);
});

test("incident queue normalizes malformed incident rows", async ({ page, request }) => {
  await setMockApiBehavior(request, {
    malformed_incidents_get: true
  });
  await setSession(page);

  await page.goto("/incidents");

  await expect(page.getByRole("heading", { name: /incident queue/i })).toBeVisible();
  await expect(page.getByText("Untitled incident")).toBeVisible();
  await expect(page.getByText("unknown - confidence low")).toBeVisible();
  await expect(page.getByText("Something failed while loading this page")).toHaveCount(0);
});

test("incident detail renders a safe fallback when detail data fails", async ({ page, request }) => {
  await setMockApiBehavior(request, {
    fail_incident_detail_get: true
  });
  await setSession(page);

  await page.goto("/incidents/inc-e2e-1");

  await expect(page.getByTestId("incident-detail-load-warning")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Incident Queue" })).toBeVisible();
  await expect(page.getByText("Something failed while loading this page")).toHaveCount(0);
});

test("incident detail survives timeline and current-user fetch failures", async ({ page, request }) => {
  await setMockApiBehavior(request, {
    fail_incident_timeline_get: true,
    fail_auth_me_get: true
  });
  await setSession(page);

  await page.goto("/incidents/inc-e2e-1");

  await expect(page.getByRole("heading", { name: "Payments Daily failure spike" })).toBeVisible();
  await expect(page.getByText("Timeline is temporarily unavailable.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Acknowledge Incident" })).toBeVisible();
  await expect(page.getByText("Something failed while loading this page")).toHaveCount(0);
});

test("workflow detail shows unavailable charts when metrics fail", async ({ page, request }) => {
  await setMockApiBehavior(request, {
    fail_metrics_overview_get: true
  });
  await setSession(page);

  await page.goto("/workflows/wf_1");

  await expect(page.getByRole("heading", { name: "wf_1" })).toBeVisible();
  await expect(page.getByTestId("workflow-overview-warning")).toBeVisible();
  await expect(page.getByText("Monitoring data is temporarily unavailable.").first()).toBeVisible();
  await expect(page.getByText("Something failed while loading this page")).toHaveCount(0);
});
