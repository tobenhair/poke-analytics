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
//
// Chart.js and SheetJS come from node_modules for the same reason (see
// tests/local-cdn.mjs): the spec must not depend on cdnjs being reachable.
// ============================================================

import { test, expect } from '@playwright/test';
// forceStaticMode lives in local-cdn.mjs so the a11y spec can share it.
import { routeLocalLibs, forceStaticMode, expandBoard } from './local-cdn.mjs';

test('page loads and renders all tabs without runtime errors', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await routeLocalLibs(page);
  await forceStaticMode(page);

  // ?admin=1 reveals the Data Entry tab so we can smoke it too.
  await page.goto('/?admin=1');

  // ── Welcome (default tab) ──
  await expect(page.locator('#tab-welcome')).toBeVisible();

  // ── Analysis: data must have loaded from the workbook and rendered ──
  await page.locator('.tab-btn[data-tab="analysis"]').click();
  await expect(page.locator('#tab-analysis')).toBeVisible();

  // Board renders as the grouped Era overview (collapsed to era headline rows) —
  // empty if data failed to render.
  await expect.poll(
    () => page.locator('#product-tbody .grp-era').count(),
    { message: 'board should show era rows', timeout: 10_000 },
  ).toBeGreaterThan(0);

  // The "Where to start" shortlist populated.
  await expect(page.locator('#overview-deals .pick-item').first()).toBeVisible();

  // Expand the tree to reveal product rows, then check the derived columns. Fair
  // Price column derived: the header states the fit's confidence in words (the R²
  // itself lives in the drill-down) and at least one product row shows a computed
  // fair price in euros — together these guard recomputeFit() running before the
  // first render, and the age-fit → fair-price inversion.
  await expandBoard(page);
  await expect(page.locator('#fair-fit-note')).toHaveText(/strong fit|moderate fit|rough estimate/);
  await expect.poll(
    () => page.locator('#product-tbody tr.grp-product td:nth-child(4)')
            .filter({ hasText: '€' }).count(),
    { message: 'board should show at least one fair price', timeout: 10_000 },
  ).toBeGreaterThan(0);

  // Verdict line renders under product names, and board search narrows the table.
  await expect(page.locator('#product-tbody .verdict-line').first()).toBeVisible();
  const productRows = await page.locator('#product-tbody tr.grp-product').count();
  await page.fill('#board-search', 'zzzznomatch');
  await expect(page.locator('#product-tbody')).toContainText('No products match');
  await page.fill('#board-search', '');
  // Clearing restores the pre-search expanded state (the groups stay expanded).
  await expect.poll(() => page.locator('#product-tbody tr.grp-product').count()).toBe(productRows);

  // Drill-down opens from a product row, renders its stats and a real chart.
  await page.locator('#product-tbody tr.grp-product').first().click();
  await expect(page.locator('#drill-modal')).toHaveClass(/open/);
  await expect(page.locator('#drill-stats .drill-stat')).toHaveCount(7);
  // Set logo is best-effort: with the TCGdex API stubbed empty it stays hidden
  // (text title is the fallback) — the page must not show a broken image.
  await expect(page.locator('#drill-logo')).toBeHidden();
  // Poll: Chart.js sizes the canvas on a frame *after* the dialog becomes
  // visible, so a single boundingBox() here can catch it at zero width.
  await expect
    .poll(async () => (await page.locator('#drill-price-chart').boundingBox())?.width ?? 0,
          { message: 'drill price chart should render' })
    .toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#drill-modal')).not.toHaveClass(/open/);

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

  // A focused number input must not step its value on wheel (the 0.01 bug):
  // it blurs instead, leaving the value untouched.
  const priceInput = page.locator('#entry-tbody .entry-input[data-field="price"]').first();
  await priceInput.focus();
  const beforeWheel = await priceInput.inputValue();
  const ib = await priceInput.boundingBox();
  await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
  await page.mouse.wheel(0, 120);
  expect(await priceInput.inputValue(), 'wheel must not change a number input').toBe(beforeWheel);

  // The workbook loaded, so the sample-data banner must be gone.
  await expect(page.locator('#data-source-banner')).toBeHidden();

  // No uncaught exceptions anywhere along the way.
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

test('on a phone, an analytical chart expands to a full-screen dialog', async ({ page }) => {
  // The dense scatter / comparison charts are unreadable at phone width, so an
  // expand button (surfaced only ≤680px) opens a larger read-only copy. Proves
  // the affordance shows, opens the dialog, renders a real (tall) canvas, and
  // closes from the keyboard like every other overlay.
  await page.setViewportSize({ width: 390, height: 820 });
  await routeLocalLibs(page);
  await forceStaticMode(page);
  await page.goto('/');
  await page.locator('.tab-btn[data-tab="analysis"]').click();
  await expect(page.locator('#tab-analysis')).toBeVisible();

  const expand = page.locator('.chart-expand-btn[data-chart="scatter"]');
  // Centre it in the viewport first — scrollIntoViewIfNeeded can leave it under
  // the sticky tab-bar, which would swallow the click (a harness artifact, not a
  // real-user one: nobody taps a control tucked behind the sticky header).
  await expand.evaluate(el => el.scrollIntoView({ block: 'center' }));
  await expect(expand).toBeVisible();
  await expand.click();

  await expect(page.locator('#chart-zoom-modal')).toHaveClass(/open/);
  // The enlarged canvas fills the tall dialog body (it escapes the 220px cap).
  await expect
    .poll(async () => (await page.locator('#chart-zoom-canvas').boundingBox())?.height ?? 0,
          { message: 'zoomed chart should be tall' })
    .toBeGreaterThan(300);
  await page.keyboard.press('Escape');
  await expect(page.locator('#chart-zoom-modal')).not.toHaveClass(/open/);
});

test('a missing workbook says so instead of passing sample data off as real', async ({ page }) => {
  // The dangerous failure: the page boots with a small hardcoded dataset so
  // nothing is blank, and until now a 404 left those numbers on screen looking
  // exactly like tracked prices — the board, the P&L and every chart fiction,
  // silently.
  await routeLocalLibs(page);
  await forceStaticMode(page);
  await page.route('**/pokemon_data.xlsx', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('/?admin=1');

  const banner = page.locator('#data-source-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Sample data');
  await expect(banner).toContainText('404');          // says *why*, not just that

  // It is on every tab, not just the one that happened to be open — the
  // portfolio's P&L would be computed from these numbers too.
  await page.locator('.tab-bar .tab-btn[data-tab="analysis"]').click();
  await expect(banner).toBeVisible();
  await page.locator('.tab-bar .tab-btn[data-tab="entry"]').click();
  await expect(banner).toBeVisible();

  // And it does not scroll away — a warning you can lose is no warning.
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect(banner).toBeVisible();
});
