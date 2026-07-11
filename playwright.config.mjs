import { defineConfig, devices } from '@playwright/test';

// Serves the repo root over HTTP (the app fetch()es pokemon_data.xlsx, so it
// cannot run from file://) and points the smoke test at it.
const PORT = process.env.PORT || 8000;

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    // Optional escape hatch for environments that ship a pre-installed browser
    // instead of running `playwright install`. Unset in CI, where the workflow
    // installs the matching browser.
    launchOptions: process.env.PW_EXECUTABLE_PATH
      ? { executablePath: process.env.PW_EXECUTABLE_PATH }
      : {},
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `python3 -m http.server ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
