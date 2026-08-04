import { defineConfig, devices } from '@playwright/test';

// Serves the repo root over HTTP (the app fetch()es pokemon_data.xlsx, so it
// cannot run from file://) and points the smoke test at it.
const PORT = process.env.PORT || 8000;

export default defineConfig({
  testDir: './tests',
  // Only the Playwright specs; the node --test unit suite lives in tests/unit.
  testMatch: '**/*.spec.mjs',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    // Block the service worker by default so its offline cache can't serve one
    // spec stale content from another, and so it never sits between the page and
    // Playwright's request routing. The dedicated PWA spec re-enables it with
    // `test.use({ serviceWorkers: 'allow' })`.
    serviceWorkers: 'block',
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
