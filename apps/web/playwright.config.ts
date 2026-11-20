import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm tsx e2e/stack-server.ts",
      url: "http://127.0.0.1:4101/ready",
      timeout: 240_000,
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      command: "pnpm next start --port 3100 --hostname 127.0.0.1",
      url: "http://127.0.0.1:3100/status",
      timeout: 120_000,
      reuseExistingServer: false,
      env: { BASTION_API_URL: "http://127.0.0.1:4100" },
    },
  ],
});
