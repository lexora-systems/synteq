import { defineConfig, devices } from "@playwright/test";

const reuseExistingServer = false;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: {
    timeout: 10_000
  },
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: [
    {
      command: "node tests/e2e/mock-api-server.mjs",
      url: "http://localhost:4010/health",
      reuseExistingServer,
      timeout: 120_000
    },
    {
      command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
      url: "http://localhost:3100",
      reuseExistingServer,
      timeout: 180_000,
      env: {
        SYNTEQ_WEB_API_BASE_URL: "http://localhost:4010",
        API_BASE_URL: "http://localhost:4010",
        NEXT_PUBLIC_API_BASE_URL: "http://localhost:4010"
      }
    }
  ]
});
