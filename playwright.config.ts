import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const port = process.env.PORT ?? "3000";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const webServerCommand =
  process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ??
  `pnpm exec next dev --hostname 127.0.0.1 --port ${port}`;
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEB_SERVER === "1";
const useSystemChrome = process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === "true";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results/e2e",
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  reporter: isCI
    ? [["github"], ["list"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: skipWebServer
    ? undefined
    : {
        command: webServerCommand,
        env: {
          ...process.env,
          ELK46_FROM: process.env.ELK46_FROM ?? "Wedding",
          ELK46_MOCK_SEND: "1",
          ELK46_PASSWORD: process.env.ELK46_PASSWORD ?? "e2e-password",
          ELK46_USER: process.env.ELK46_USER ?? "e2e-user",
          VERCEL_URL: process.env.VERCEL_URL ?? "stale-vercel-deployment.example.com",
        },
        reuseExistingServer: !isCI,
        timeout: 120_000,
        url: baseURL,
      },
  projects: [
    {
      name: useSystemChrome ? "chrome" : "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(useSystemChrome ? { channel: "chrome" as const } : {}),
      },
    },
  ],
});
