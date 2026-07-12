import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  timeout: 30_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["json", { outputFile: "playwright-results.json" }],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4173/demo/",
    colorScheme: "dark",
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "on",
    video: "on",
  },
  webServer: {
    command: "pnpm exec vite --config vite.demo.config.ts --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/demo/",
    reuseExistingServer: !process.env.CI,
  },
});
