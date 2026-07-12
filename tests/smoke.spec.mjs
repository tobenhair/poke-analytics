// ============================================================
// End-to-end smoke test
// ============================================================
// Loads the real page over HTTP against the real pokemon_data.xlsx and asserts
// it renders without throwing — the automated backstop for regressions like a
// broken render function or a missed recomputeScores() before first render.
//
// The app is normally configured for Supabase (see the SUPABASE_CONFIG block
// in index.html), which gates the full catalogue behind sign-in. CI has no
// credentials and shouldn't depend on an external service, so we blank that
// config at request time to force the plain static/xlsx path (SB_ENABLED =
// false → tryAutoLoad() → applyNewData() → every render function). That path
// is exactly where the rendering-regression risk lives.
// ============================================================

import { test, expect } from '@playwright/test';

// Rewrite the inline Supabase config to empty strings so the app boots in
// static mode. Resilient to future edits of the URL / key values.
async function forceStaticMode(page) {
  await page.route(/\/(index\.html)?(\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    let body = await response.text();
    body = body
      .replace(/url:\s*'[^']*'/, "url: ''")
      .replace(/anonKey:\s*'[^']*'/, "anonKey: ''");
    // Fulfill with an explicit content type rather than spreading the fetched
    // response — reusing its headers (Content-Length / encoding) would conflict
    // with the rewritten, shorter body and truncate the page.
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });
}

test('page loads and renders all tabs without runtime errors', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await forceStaticMode(page);

  // ?admin=1 reveals the Data Entry tab so we can smoke it too.
  await page.goto('/?admin=1');

  // ── Welcome (default tab) ──
  await expect(page.locator('#tab-welcome')).toBeVisible();

  // ── Analysis: data must have loaded from the workbook and rendered ──
  await page.locator('.tab-btn[data-tab="analysis"]').click();
  await expect(page.locator('#tab-analysis')).toBeVisible();

  // Product table populated (would be empty if data failed to render).
  await expect.poll(
    () => page.locator('#product-tbody tr').count(),
    { message: 'product table should have rows', timeout: 10_000 },
  ).toBeGreaterThan(0);

  // Top Picks populated.
  await expect(page.locator('#top-picks-list')).not.toBeEmpty();

  // Fair Price column derived: the header carries an R² fit note and at least
  // one board row shows a computed fair price in euros (guards recomputeFit()
  // running before first render and the age-fit → fair-price inversion).
  await expect(page.locator('#fair-fit-note')).toContainText('R²');
  await expect.poll(
    () => page.locator('#product-tbody td:nth-child(4)')
            .filter({ hasText: '€' }).count(),
    { message: 'board should show at least one fair price', timeout: 10_000 },
  ).toBeGreaterThan(0);

  // A Chart.js canvas actually drew (non-zero size).
  const svbBox = await page.locator('#svb-chart').boundingBox();
  expect(svbBox, 'value/booster chart should be rendered').not.toBeNull();
  expect(svbBox.width).toBeGreaterThan(0);
  expect(svbBox.height).toBeGreaterThan(0);

  // ── Data Entry ──
  await page.locator('.tab-btn[data-tab="entry"]').click();
  await expect(page.locator('#tab-entry')).toBeVisible();
  await expect.poll(
    () => page.locator('#entry-tbody tr').count(),
    { message: 'data-entry table should have rows', timeout: 10_000 },
  ).toBeGreaterThan(0);

  // No uncaught exceptions anywhere along the way.
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
